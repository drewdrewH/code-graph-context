/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'node:path';

import { minimatch } from 'minimatch';
import { Project, SourceFile, Node } from 'ts-morph';

/**
 * Generate a deterministic node ID based on stable properties.
 * This ensures the same node gets the same ID across reparses.
 *
 * Identity is based on: coreType + filePath + name (+ parentId for nested nodes)
 * This is stable because when it matters (one side of edge not reparsed),
 * names are guaranteed unchanged (or imports would break, triggering reparse).
 */
const generateDeterministicId = (coreType: string, filePath: string, name: string, parentId?: string): string => {
  const parts = parentId ? [coreType, filePath, parentId, name] : [coreType, filePath, name];
  const identity = parts.join('::');
  const hash = crypto.createHash('sha256').update(identity).digest('hex').substring(0, 16);

  return `${coreType}:${hash}`;
};

import { hashFile } from '../../utils/file-utils.js';
import { NESTJS_FRAMEWORK_SCHEMA } from '../config/nestjs-framework-schema.js';
import {
  CoreNodeType,
  Neo4jNodeProperties,
  Neo4jEdgeProperties,
  Neo4jNode,
  Neo4jEdge,
  CORE_TYPESCRIPT_SCHEMA,
  CoreTypeScriptSchema,
  DetectionPattern,
  FrameworkSchema,
  FrameworkEnhancement,
  EdgeEnhancement,
  ContextExtractor,
  ParseOptions,
  DEFAULT_PARSE_OPTIONS,
  PropertyDefinition,
  CoreEdgeType,
  ParsingContext,
  ParsedNode,
  CoreNode,
} from '../config/schema.js';

// Re-export ParsedNode for convenience
export type { ParsedNode };

export interface ParsedEdge {
  id: string;
  relationshipType: string;
  sourceNodeId: string;
  targetNodeId: string;
  properties: Neo4jEdgeProperties;
}

export interface ParseResult {
  nodes: Map<string, ParsedNode>;
  edges: Map<string, ParsedEdge>;
}

/**
 * Minimal node info from Neo4j for edge target matching during incremental parsing.
 * These nodes don't have AST (sourceNode) but have enough properties for edge detection.
 */
export interface ExistingNode {
  id: string;
  name: string;
  coreType: string;
  semanticType?: string;
  labels: string[];
  filePath: string;
}

export class TypeScriptParser {
  private project: Project;
  private coreSchema: CoreTypeScriptSchema;
  private parseConfig: ParseOptions;
  private frameworkSchemas: FrameworkSchema[];
  private parsedNodes: Map<string, ParsedNode> = new Map();
  private parsedEdges: Map<string, ParsedEdge> = new Map();
  private existingNodes: Map<string, ParsedNode> = new Map(); // Nodes from Neo4j for edge target matching
  private deferredEdges: Array<{
    edgeType: CoreEdgeType;
    sourceNodeId: string;
    targetName: string;
    targetType: CoreNodeType;
  }> = [];
  private sharedContext: ParsingContext = new Map(); // Shared context for custom data

  constructor(
    private workspacePath: string,
    private tsConfigPath: string = 'tsconfig.json',
    coreSchema: CoreTypeScriptSchema = CORE_TYPESCRIPT_SCHEMA,
    frameworkSchemas: FrameworkSchema[] = [NESTJS_FRAMEWORK_SCHEMA],
    parseConfig: ParseOptions = DEFAULT_PARSE_OPTIONS,
  ) {
    this.coreSchema = coreSchema;
    this.frameworkSchemas = frameworkSchemas;
    this.parseConfig = parseConfig;

    this.project = new Project({
      tsConfigFilePath: tsConfigPath,
      skipAddingFilesFromTsConfig: false,
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        target: 7,
        module: 1,
        esModuleInterop: true,
      },
    });
    this.project.addSourceFilesAtPaths(path.join(workspacePath, '**/*.ts'));
  }

  /**
   * Set existing nodes from Neo4j for edge target matching during incremental parsing.
   * These nodes will be available as targets for edge detection but won't be exported.
   */
  setExistingNodes(nodes: ExistingNode[]): void {
    this.existingNodes.clear();
    for (const node of nodes) {
      // Convert to ParsedNode format (without AST)
      const parsedNode: ParsedNode = {
        id: node.id,
        coreType: node.coreType as CoreNodeType,
        semanticType: node.semanticType,
        labels: node.labels,
        properties: {
          id: node.id,
          name: node.name,
          coreType: node.coreType as CoreNodeType,
          filePath: node.filePath,
          semanticType: node.semanticType,
        } as Neo4jNodeProperties,
        // No sourceNode - these are from Neo4j, not parsed
      };
      this.existingNodes.set(node.id, parsedNode);
    }
    console.log(`📦 Loaded ${nodes.length} existing nodes for edge detection`);
  }

  async parseWorkspace(filesToParse?: string[]): Promise<{ nodes: Neo4jNode[]; edges: Neo4jEdge[] }> {
    let sourceFiles: SourceFile[];

    if (filesToParse && filesToParse.length > 0) {
      sourceFiles = filesToParse
        .map((filePath) => this.project.getSourceFile(filePath))
        .filter((sf): sf is SourceFile => sf !== undefined);
    } else {
      sourceFiles = this.project.getSourceFiles();
    }

    for (const sourceFile of sourceFiles) {
      if (this.shouldSkipFile(sourceFile)) continue;
      await this.parseCoreTypeScriptV2(sourceFile);
    }

    this.resolveDeferredEdges();

    await this.applyContextExtractors();

    if (this.frameworkSchemas.length > 0) {
      await this.applyFrameworkEnhancements();
    }

    await this.applyEdgeEnhancements();

    const neo4jNodes = Array.from(this.parsedNodes.values()).map(this.toNeo4jNode);
    const neo4jEdges = Array.from(this.parsedEdges.values()).map(this.toNeo4jEdge);

    return { nodes: neo4jNodes, edges: neo4jEdges };
  }

  /**
   * Check if variable declarations should be parsed for this file
   * based on framework schema configurations
   */
  private shouldParseVariables(filePath: string): boolean {
    for (const schema of this.frameworkSchemas) {
      const parsePatterns = schema.metadata.parseVariablesFrom;
      if (parsePatterns) {
        for (const pattern of parsePatterns) {
          if (minimatch(filePath, pattern)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private async parseCoreTypeScriptV2(sourceFile: SourceFile): Promise<void> {
    const filePath = sourceFile.getFilePath();
    const stats = await fs.stat(filePath);
    const fileTrackingProperties: Partial<Neo4jNodeProperties> = {
      size: stats.size,
      mtime: stats.mtimeMs,
      contentHash: await hashFile(filePath),
    };

    const sourceFileNode = this.createCoreNode(sourceFile, CoreNodeType.SOURCE_FILE, fileTrackingProperties);
    this.addNode(sourceFileNode);

    await this.parseChildNodes(this.coreSchema.nodeTypes[CoreNodeType.SOURCE_FILE], sourceFileNode, sourceFile);

    if (this.shouldParseVariables(sourceFile.getFilePath())) {
      for (const varStatement of sourceFile.getVariableStatements()) {
        for (const varDecl of varStatement.getDeclarations()) {
          if (this.shouldSkipChildNode(varDecl)) continue;

          const variableNode = this.createCoreNode(varDecl, CoreNodeType.VARIABLE_DECLARATION, {}, sourceFileNode.id);
          this.addNode(variableNode);

          const containsEdge = this.createCoreEdge(CoreEdgeType.CONTAINS, sourceFileNode.id, variableNode.id);
          this.addEdge(containsEdge);
        }
      }
    }
  }

  private async parseChildNodes(parentNodeConfig: CoreNode, parentNode: ParsedNode, astNode: Node): Promise<void> {
    if (!parentNodeConfig.children) return;

    for (const [childType, edgeType] of Object.entries(parentNodeConfig.children)) {
      const type = childType as CoreNodeType;
      const astGetterName = this.coreSchema.astGetters[type];
      if (!astGetterName) {
        console.warn(`No AST getter defined for child type ${type}`);
        continue;
      }

      const astGetter = astNode[astGetterName];

      if (typeof astGetter !== 'function') {
        console.warn(`AST getter for child type ${type} is not a function`);
        continue;
      }

      const children = astGetter.call(astNode);

      if (!Array.isArray(children)) {
        console.warn(`AST getter ${astGetterName} did not return an array for ${type}`);
        continue;
      }

      for (const child of children) {
        if (this.shouldSkipChildNode(child)) continue;

        const coreNode = this.createCoreNode(child, type, {}, parentNode.id);
        this.addNode(coreNode);
        const coreEdge = this.createCoreEdge(edgeType as CoreEdgeType, parentNode.id, coreNode.id);
        this.addEdge(coreEdge);

        const SKELETONIZE_TYPES = new Set([
          CoreNodeType.METHOD_DECLARATION,
          CoreNodeType.FUNCTION_DECLARATION,
          CoreNodeType.PROPERTY_DECLARATION,
        ]);

        if (SKELETONIZE_TYPES.has(type)) {
          this.skeletonizeChildInParent(parentNode, coreNode);
        }

        const childNodeConfig = this.coreSchema.nodeTypes[type];
        if (childNodeConfig) {
          this.queueRelationshipNodes(childNodeConfig, coreNode, child);
          await this.parseChildNodes(childNodeConfig, coreNode, child);
        }
      }
    }
  }

  private skeletonizeChildInParent(parent: ParsedNode, child: ParsedNode): void {
    const childText = child.properties.sourceCode;
    const bodyStart = childText.indexOf('{');
    if (bodyStart > -1) {
      const signature = childText.substring(0, bodyStart).trim();
      const placeholder = `${signature} { /* NodeID: ${child.id} */ }`;
      parent.properties.sourceCode = parent.properties.sourceCode.replace(childText, placeholder);
    }
  }

  /**
   * Queue relationship edges for deferred processing
   * These are resolved after all nodes are parsed since the target may not exist yet
   */
  private queueRelationshipNodes(nodeConfig: CoreNode, parsedNode: ParsedNode, astNode: Node): void {
    if (!nodeConfig.relationships || nodeConfig.relationships.length === 0) return;

    for (const relationship of nodeConfig.relationships) {
      const { edgeType, method, cardinality, targetNodeType } = relationship;
      const astGetter = (astNode as any)[method];

      if (typeof astGetter !== 'function') continue;

      const result = astGetter.call(astNode);
      if (!result) continue;

      const targets = cardinality === 'single' ? [result] : result;

      for (const target of targets) {
        if (!target) continue;

        const targetName = this.extractRelationshipTargetName(target);
        if (!targetName) continue;

        this.deferredEdges.push({
          edgeType: edgeType as CoreEdgeType,
          sourceNodeId: parsedNode.id,
          targetName,
          targetType: targetNodeType,
        });
      }
    }
  }

  /**
   * Extract the target name from an AST node returned by relationship methods
   */
  private extractRelationshipTargetName(target: Node): string | undefined {
    if (Node.isClassDeclaration(target)) return target.getName();
    if (Node.isInterfaceDeclaration(target)) return target.getName();
    if (Node.isExpressionWithTypeArguments(target)) {
      const expression = target.getExpression();
      const text = expression.getText();
      const genericIndex = text.indexOf('<');
      return genericIndex > 0 ? text.substring(0, genericIndex) : text;
    }
    return undefined;
  }

  /**
   * Find a parsed node by name and core type
   */
  private findNodeByNameAndType(name: string, coreType: CoreNodeType): ParsedNode | undefined {
    for (const node of this.parsedNodes.values()) {
      if (node.coreType === coreType && node.properties.name === name) {
        return node;
      }
    }

    for (const node of this.existingNodes.values()) {
      if (node.coreType === coreType && node.properties.name === name) {
        return node;
      }
    }
    return undefined;
  }

  /**
   * Resolve deferred edges after all nodes have been parsed
   */
  private resolveDeferredEdges(): void {
    for (const deferred of this.deferredEdges) {
      const targetNode = this.findNodeByNameAndType(deferred.targetName, deferred.targetType);
      if (targetNode) {
        const edge = this.createCoreEdge(deferred.edgeType, deferred.sourceNodeId, targetNode.id);
        this.addEdge(edge);
      }
      // If not found, it's likely an external type (from node_modules) - skip silently
    }
    this.deferredEdges = [];
  }

  private async parseCoreTypeScript(sourceFile: SourceFile): Promise<void> {
    try {
      // Create source file node
      const sourceFileNode = this.createCoreNode(sourceFile, CoreNodeType.SOURCE_FILE);
      this.addNode(sourceFileNode);

      // Parse classes
      for (const classDecl of sourceFile.getClasses()) {
        const classNode = this.createCoreNode(classDecl, CoreNodeType.CLASS_DECLARATION, {}, sourceFileNode.id);
        this.addNode(classNode);

        // File contains class relationship
        const containsEdge = this.createCoreEdge(CoreEdgeType.CONTAINS, sourceFileNode.id, classNode.id);
        this.addEdge(containsEdge);

        // Parse class decorators
        for (const decorator of classDecl.getDecorators()) {
          const decoratorNode = this.createCoreNode(decorator, CoreNodeType.DECORATOR, {}, classNode.id);
          this.addNode(decoratorNode);

          // Class decorated with decorator relationship
          const decoratedEdge = this.createCoreEdge(CoreEdgeType.DECORATED_WITH, classNode.id, decoratorNode.id);
          this.addEdge(decoratedEdge);
        }

        // Parse methods
        for (const method of classDecl.getMethods()) {
          const methodNode = this.createCoreNode(method, CoreNodeType.METHOD_DECLARATION, {}, classNode.id);
          this.addNode(methodNode);

          // Class has method relationship
          const hasMethodEdge = this.createCoreEdge(CoreEdgeType.HAS_MEMBER, classNode.id, methodNode.id);
          this.addEdge(hasMethodEdge);

          // Parse method decorators
          for (const decorator of method.getDecorators()) {
            const decoratorNode = this.createCoreNode(decorator, CoreNodeType.DECORATOR, {}, methodNode.id);
            this.addNode(decoratorNode);

            // Method decorated with decorator relationship
            const decoratedEdge = this.createCoreEdge(CoreEdgeType.DECORATED_WITH, methodNode.id, decoratorNode.id);
            this.addEdge(decoratedEdge);
          }

          // Parse method parameters
          for (const param of method.getParameters()) {
            const paramNode = this.createCoreNode(param, CoreNodeType.PARAMETER_DECLARATION, {}, methodNode.id);
            this.addNode(paramNode);

            // Method has parameter relationship
            const hasParamEdge = this.createCoreEdge(CoreEdgeType.HAS_PARAMETER, methodNode.id, paramNode.id);
            this.addEdge(hasParamEdge);

            // Parse parameter decorators
            for (const decorator of param.getDecorators()) {
              const decoratorNode = this.createCoreNode(decorator, CoreNodeType.DECORATOR, {}, paramNode.id);
              this.addNode(decoratorNode);

              // Parameter decorated with decorator relationship
              const decoratedEdge = this.createCoreEdge(CoreEdgeType.DECORATED_WITH, paramNode.id, decoratorNode.id);
              this.addEdge(decoratedEdge);
            }
          }
        }

        // Parse properties
        for (const property of classDecl.getProperties()) {
          const propertyNode = this.createCoreNode(property, CoreNodeType.PROPERTY_DECLARATION, {}, classNode.id);
          this.addNode(propertyNode);

          // Class has property relationship
          const hasPropertyEdge = this.createCoreEdge(CoreEdgeType.HAS_MEMBER, classNode.id, propertyNode.id);
          this.addEdge(hasPropertyEdge);

          // Parse property decorators
          for (const decorator of property.getDecorators()) {
            const decoratorNode = this.createCoreNode(decorator, CoreNodeType.DECORATOR, {}, propertyNode.id);
            this.addNode(decoratorNode);

            // Property decorated with decorator relationship
            const decoratedEdge = this.createCoreEdge(CoreEdgeType.DECORATED_WITH, propertyNode.id, decoratorNode.id);
            this.addEdge(decoratedEdge);
          }
        }
      }

      // Parse interfaces
      for (const interfaceDecl of sourceFile.getInterfaces()) {
        const interfaceNode = this.createCoreNode(
          interfaceDecl,
          CoreNodeType.INTERFACE_DECLARATION,
          {},
          sourceFileNode.id,
        );
        this.addNode(interfaceNode);

        // File contains interface relationship
        const containsEdge = this.createCoreEdge(CoreEdgeType.CONTAINS, sourceFileNode.id, interfaceNode.id);
        this.addEdge(containsEdge);
      }

      // Parse functions
      for (const funcDecl of sourceFile.getFunctions()) {
        const functionNode = this.createCoreNode(funcDecl, CoreNodeType.FUNCTION_DECLARATION, {}, sourceFileNode.id);
        this.addNode(functionNode);

        // File contains function relationship
        const containsEdge = this.createCoreEdge(CoreEdgeType.CONTAINS, sourceFileNode.id, functionNode.id);
        this.addEdge(containsEdge);

        // Parse function parameters
        for (const param of funcDecl.getParameters()) {
          const paramNode = this.createCoreNode(param, CoreNodeType.PARAMETER_DECLARATION, {}, functionNode.id);
          this.addNode(paramNode);

          // Function has parameter relationship
          const hasParamEdge = this.createCoreEdge(CoreEdgeType.HAS_PARAMETER, functionNode.id, paramNode.id);
          this.addEdge(hasParamEdge);
        }
      }

      // Parse imports
      for (const importDecl of sourceFile.getImportDeclarations()) {
        const importNode = this.createCoreNode(importDecl, CoreNodeType.IMPORT_DECLARATION, {}, sourceFileNode.id);
        this.addNode(importNode);

        // File contains import relationship
        const containsEdge = this.createCoreEdge(CoreEdgeType.CONTAINS, sourceFileNode.id, importNode.id);
        this.addEdge(containsEdge);
      }

      // Parse variable declarations if framework schema specifies this file should have them parsed
      if (this.shouldParseVariables(sourceFile.getFilePath())) {
        for (const varStatement of sourceFile.getVariableStatements()) {
          for (const varDecl of varStatement.getDeclarations()) {
            const variableNode = this.createCoreNode(varDecl, CoreNodeType.VARIABLE_DECLARATION, {}, sourceFileNode.id);
            this.addNode(variableNode);

            // File contains variable relationship
            const containsEdge = this.createCoreEdge(CoreEdgeType.CONTAINS, sourceFileNode.id, variableNode.id);
            this.addEdge(containsEdge);
          }
        }
      }
    } catch (error) {
      console.error(`Error parsing file ${sourceFile.getFilePath()}:`, error);
    }
  }

  private createCoreNode(
    astNode: Node,
    coreType: CoreNodeType,
    baseProperties: Partial<Neo4jNodeProperties> = {},
    parentId?: string,
  ): ParsedNode {
    const name = this.extractNodeName(astNode, coreType);
    const filePath = astNode.getSourceFile().getFilePath();
    const nodeId = generateDeterministicId(coreType, filePath, name, parentId);

    // Extract base properties using schema
    const properties: Neo4jNodeProperties = {
      id: nodeId,
      name,
      coreType,
      filePath,
      startLine: astNode.getStartLineNumber(),
      endLine: astNode.getEndLineNumber(),
      sourceCode: astNode.getText(),
      createdAt: new Date().toISOString(),
      ...baseProperties,
    };

    // Extract schema-defined properties
    const coreNodeDef = this.coreSchema.nodeTypes[coreType];
    if (coreNodeDef) {
      for (const propDef of coreNodeDef.properties) {
        try {
          const value = this.extractProperty(astNode, propDef);
          if (value !== undefined && propDef.name !== 'context') {
            (properties as any)[propDef.name] = value;
          }
        } catch (error) {
          console.warn(`Failed to extract core property ${propDef.name}:`, error);
        }
      }
    }

    return {
      id: nodeId,
      coreType,
      labels: [...(coreNodeDef?.neo4j.labels || [])],
      properties,
      sourceNode: astNode,
      skipEmbedding: coreNodeDef?.neo4j.skipEmbedding ?? false,
    };
  }

  private async applyContextExtractors(): Promise<void> {
    console.log('🔧 Applying context extractors...');

    // Apply global context extractors from framework schemas
    for (const frameworkSchema of this.frameworkSchemas) {
      for (const extractor of frameworkSchema.contextExtractors) {
        await this.applyContextExtractor(extractor);
      }
    }
  }

  private async applyContextExtractor(extractor: ContextExtractor): Promise<void> {
    for (const [nodeId, node] of this.parsedNodes) {
      // Check if this extractor applies to this node
      if (node.coreType !== extractor.nodeType) continue;
      if (extractor.semanticType && node.semanticType !== extractor.semanticType) continue;

      try {
        const context = extractor.extractor(node, this.parsedNodes as any, this.sharedContext);
        if (context && Object.keys(context).length > 0) {
          // Merge context into node properties
          node.properties.context ??= {};
          Object.assign(node.properties.context, context);
        }
      } catch (error) {
        console.warn(`Failed to apply context extractor for ${nodeId}:`, error);
      }
    }
  }

  private createCoreEdge(relationshipType: CoreEdgeType, sourceNodeId: string, targetNodeId: string): ParsedEdge {
    // Get the weight from the core schema
    const coreEdgeSchema = CORE_TYPESCRIPT_SCHEMA.edgeTypes[relationshipType];
    const relationshipWeight = coreEdgeSchema?.relationshipWeight ?? 0.5;

    // Generate deterministic edge ID based on type + source + target
    const edgeIdentity = `${relationshipType}::${sourceNodeId}::${targetNodeId}`;
    const edgeHash = crypto.createHash('sha256').update(edgeIdentity).digest('hex').substring(0, 16);
    const edgeId = `${relationshipType}:${edgeHash}`;

    return {
      id: edgeId,
      relationshipType,
      sourceNodeId,
      targetNodeId,
      properties: {
        coreType: relationshipType,
        source: 'ast',
        confidence: 1.0,
        relationshipWeight,
        filePath: '',
        createdAt: new Date().toISOString(),
      },
    };
  }

  private async applyFrameworkEnhancements(): Promise<void> {
    console.log('🎯 Starting framework enhancements...');

    for (const frameworkSchema of this.frameworkSchemas) {
      console.log(`📦 Applying framework schema: ${frameworkSchema.name}`);
      await this.applyFrameworkSchema(frameworkSchema);
    }

    console.log('✅ Framework enhancements complete');
  }

  private async applyFrameworkSchema(schema: FrameworkSchema): Promise<void> {
    // Sort enhancements by priority (highest first)
    const sortedEnhancements = Object.values(schema.enhancements).sort((a, b) => b.priority - a.priority);

    for (const [nodeId, coreNode] of this.parsedNodes) {
      // Find applicable enhancements for this core node type
      const applicableEnhancements = sortedEnhancements.filter(
        (enhancement) => enhancement.targetCoreType === coreNode.coreType,
      );

      for (const enhancement of applicableEnhancements) {
        if (this.matchesDetectionPatterns(coreNode, enhancement.detectionPatterns)) {
          // Enhance the node!
          this.enhanceNode(coreNode, enhancement);
          break; // First match wins (highest priority)
        }
      }
    }
  }

  private matchesDetectionPatterns(node: ParsedNode, patterns: DetectionPattern[]): boolean {
    return patterns.some((pattern) => {
      try {
        switch (pattern.type) {
          case 'decorator':
            return this.hasMatchingDecorator(node, pattern.pattern as string);
          case 'filename':
            if (pattern.pattern instanceof RegExp) {
              return pattern.pattern.test(node.properties.filePath);
            } else {
              return node.properties.filePath.includes(pattern.pattern as string);
            }
          case 'function':
            if (typeof pattern.pattern === 'function') {
              return pattern.pattern(node);
            }
            return false;
          case 'classname':
            if (pattern.pattern instanceof RegExp) {
              return pattern.pattern.test(node.properties.name);
            } else {
              return node.properties.name.includes(pattern.pattern as string);
            }
          default:
            return false;
        }
      } catch (error) {
        console.warn(`Error matching detection pattern:`, error);
        return false;
      }
    });
  }

  private hasMatchingDecorator(node: ParsedNode, decoratorName: string): boolean {
    try {
      const context = node.properties.context;
      const decoratorNames = context?.decoratorNames as string[];
      return decoratorNames?.includes(decoratorName) || false;
    } catch (error) {
      console.warn(`Error checking decorator ${decoratorName}:`, error);
      return false;
    }
  }

  private enhanceNode(coreNode: ParsedNode, enhancement: FrameworkEnhancement): void {
    try {
      // Set semantic type (single, not array)
      coreNode.semanticType = enhancement.semanticType;
      coreNode.properties.semanticType = enhancement.semanticType;

      // Add framework labels
      enhancement.neo4j.additionalLabels.forEach((label) => {
        if (!coreNode.labels.includes(label)) {
          coreNode.labels.unshift(label);
        }
      });

      // Override primary label if specified
      if (enhancement.neo4j.primaryLabel) {
        const oldPrimaryIndex = coreNode.labels.findIndex((label) => label === enhancement.neo4j.primaryLabel);
        if (oldPrimaryIndex > -1) {
          coreNode.labels.splice(oldPrimaryIndex, 1);
        }
        coreNode.labels.unshift(enhancement.neo4j.primaryLabel);
      }

      // Apply context extractors specific to this enhancement
      for (const extractor of enhancement.contextExtractors) {
        try {
          const context = extractor.extractor(coreNode, this.parsedNodes as any, this.sharedContext);
          if (context && Object.keys(context).length > 0) {
            coreNode.properties.context ??= {};
            Object.assign(coreNode.properties.context, context);
          }
        } catch (error) {
          console.warn(`Failed to apply enhancement context extractor:`, error);
        }
      }
    } catch (error) {
      console.error(`Error enhancing node ${coreNode.id}:`, error);
    }
  }

  private async applyEdgeEnhancements(): Promise<void> {
    console.log('🔗 Applying edge enhancements...');

    for (const frameworkSchema of this.frameworkSchemas) {
      for (const edgeEnhancement of Object.values(frameworkSchema.edgeEnhancements)) {
        await this.applyEdgeEnhancement(edgeEnhancement);
      }
    }
  }

  private async applyEdgeEnhancement(edgeEnhancement: EdgeEnhancement): Promise<void> {
    try {
      // Combine parsed nodes and existing nodes for target matching
      // Sources must be parsed (have AST), targets can be either
      const allTargetNodes = new Map([...this.parsedNodes, ...this.existingNodes]);

      for (const [sourceId, sourceNode] of this.parsedNodes) {
        // Skip if source doesn't have AST (shouldn't happen for parsedNodes, but be safe)
        if (!sourceNode.sourceNode) continue;

        for (const [targetId, targetNode] of allTargetNodes) {
          if (sourceId === targetId) continue;

          if (edgeEnhancement.detectionPattern(sourceNode, targetNode, this.parsedNodes as any, this.sharedContext)) {
            // Extract context for this edge
            let context = {};
            if (edgeEnhancement.contextExtractor) {
              context = edgeEnhancement.contextExtractor(
                sourceNode,
                targetNode,
                this.parsedNodes as any,
                this.sharedContext,
              );
            }

            const edge = this.createFrameworkEdge(
              edgeEnhancement.semanticType,
              edgeEnhancement.neo4j.relationshipType,
              sourceId,
              targetId,
              context,
              edgeEnhancement.relationshipWeight,
            );
            this.addEdge(edge);
          }
        }
      }
    } catch (error) {
      console.error(`Error applying edge enhancement ${edgeEnhancement.name}:`, error);
    }
  }

  private createFrameworkEdge(
    semanticType: string,
    relationshipType: string,
    sourceNodeId: string,
    targetNodeId: string,
    context: Record<string, any> = {},
    relationshipWeight: number = 0.5,
  ): ParsedEdge {
    // Generate deterministic edge ID based on type + source + target
    const edgeIdentity = `${semanticType}::${sourceNodeId}::${targetNodeId}`;
    const edgeHash = crypto.createHash('sha256').update(edgeIdentity).digest('hex').substring(0, 16);
    const edgeId = `${semanticType}:${edgeHash}`;

    const properties: Neo4jEdgeProperties = {
      coreType: semanticType as any, // This might need adjustment based on schema
      semanticType,
      source: 'pattern',
      confidence: 0.8,
      relationshipWeight,
      filePath: '',
      createdAt: new Date().toISOString(),
      context,
    };

    return {
      id: edgeId,
      relationshipType,
      sourceNodeId,
      targetNodeId,
      properties,
    };
  }

  private extractProperty(astNode: Node, propDef: PropertyDefinition): any {
    const { method, source, defaultValue } = propDef.extraction;

    try {
      switch (method) {
        case 'ast':
          if (typeof source === 'string') {
            const fn = (astNode as any)[source];
            return typeof fn === 'function' ? fn.call(astNode) : defaultValue;
          }
          return defaultValue;

        case 'function':
          if (typeof source === 'function') {
            return source(astNode);
          }
          return defaultValue;

        case 'static':
          return defaultValue;

        case 'context':
          // Context properties are handled by context extractors
          return undefined;

        default:
          return defaultValue;
      }
    } catch (error) {
      console.warn(`Failed to extract property ${propDef.name}:`, error);
      return defaultValue;
    }
  }

  private extractNodeName(astNode: Node, coreType: CoreNodeType): string {
    try {
      switch (coreType) {
        case CoreNodeType.SOURCE_FILE:
          if (Node.isSourceFile(astNode)) {
            return astNode.getBaseName();
          }
          break;

        case CoreNodeType.CLASS_DECLARATION:
          if (Node.isClassDeclaration(astNode)) {
            return astNode.getName() ?? 'AnonymousClass';
          }
          break;

        case CoreNodeType.METHOD_DECLARATION:
          if (Node.isMethodDeclaration(astNode)) {
            return astNode.getName();
          }
          break;

        case CoreNodeType.FUNCTION_DECLARATION:
          if (Node.isFunctionDeclaration(astNode)) {
            return astNode.getName() ?? 'AnonymousFunction';
          }
          break;

        case CoreNodeType.INTERFACE_DECLARATION:
          if (Node.isInterfaceDeclaration(astNode)) {
            return astNode.getName();
          }
          break;

        case CoreNodeType.PROPERTY_DECLARATION:
          if (Node.isPropertyDeclaration(astNode)) {
            return astNode.getName();
          }
          break;

        case CoreNodeType.PARAMETER_DECLARATION:
          if (Node.isParameterDeclaration(astNode)) {
            return astNode.getName();
          }
          break;

        case CoreNodeType.IMPORT_DECLARATION:
          if (Node.isImportDeclaration(astNode)) {
            return astNode.getModuleSpecifierValue();
          }
          break;

        case CoreNodeType.DECORATOR:
          if (Node.isDecorator(astNode)) {
            return astNode.getName();
          }
          break;

        default:
          return astNode.getKindName();
      }
    } catch (error) {
      console.warn(`Error extracting name for ${coreType}:`, error);
    }

    return 'Unknown';
  }

  private shouldSkipChildNode(node: Node): boolean {
    const excludedNodeTypes = this.parseConfig.excludedNodeTypes ?? [];
    return excludedNodeTypes.includes(node.getKindName() as CoreNodeType);
  }

  private shouldSkipFile(sourceFile: SourceFile): boolean {
    const filePath = sourceFile.getFilePath();
    const excludedPatterns = this.parseConfig.excludePatterns ?? [];

    for (const pattern of excludedPatterns) {
      if (filePath.includes(pattern) || filePath.match(new RegExp(pattern))) {
        return true;
      }
    }

    return false;
  }

  private toNeo4jNode(parsedNode: ParsedNode): Neo4jNode {
    return {
      id: parsedNode.id,
      labels: parsedNode.labels,
      properties: parsedNode.properties,
      skipEmbedding: parsedNode.skipEmbedding ?? false,
    };
  }

  private toNeo4jEdge(parsedEdge: ParsedEdge): Neo4jEdge {
    return {
      id: parsedEdge.id,
      type: parsedEdge.relationshipType,
      startNodeId: parsedEdge.sourceNodeId,
      endNodeId: parsedEdge.targetNodeId,
      properties: parsedEdge.properties,
    };
  }

  private addNode(node: ParsedNode): void {
    this.parsedNodes.set(node.id, node);
  }

  private addEdge(edge: ParsedEdge): void {
    this.parsedEdges.set(edge.id, edge);
  }

  // Helper methods for statistics and debugging
  public getStats(): {
    totalNodes: number;
    totalEdges: number;
    nodesByType: Record<string, number>;
    nodesBySemanticType: Record<string, number>;
  } {
    const nodesByType: Record<string, number> = {};
    const nodesBySemanticType: Record<string, number> = {};

    for (const node of this.parsedNodes.values()) {
      nodesByType[node.coreType] = (nodesByType[node.coreType] || 0) + 1;

      if (node.semanticType) {
        nodesBySemanticType[node.semanticType] = (nodesBySemanticType[node.semanticType] || 0) + 1;
      }
    }

    return {
      totalNodes: this.parsedNodes.size,
      totalEdges: this.parsedEdges.size,
      nodesByType,
      nodesBySemanticType,
    };
  }

  public exportToJson(): { nodes: Neo4jNode[]; edges: Neo4jEdge[] } {
    const nodes = Array.from(this.parsedNodes.values()).map((node) => ({
      id: node.id,
      labels: node.labels,
      properties: node.properties,
      skipEmbedding: node.skipEmbedding ?? false,
    }));

    const edges = Array.from(this.parsedEdges.values()).map((edge) => ({
      id: edge.id,
      type: edge.relationshipType,
      startNodeId: edge.sourceNodeId,
      endNodeId: edge.targetNodeId,
      properties: edge.properties,
    }));

    return { nodes, edges };
  }
}
