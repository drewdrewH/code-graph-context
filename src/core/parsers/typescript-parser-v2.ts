/* eslint-disable @typescript-eslint/no-explicit-any */
import path from 'node:path';

import { Project, SourceFile, Node } from 'ts-morph';
import { v4 as uuidv4 } from 'uuid';

import {
  CoreNodeType,
  SemanticNodeType,
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
  NESTJS_FRAMEWORK_SCHEMA,
  PropertyDefinition,
  CoreEdgeType,
  SemanticEdgeType,
} from '../config/graph-v2.js';

export interface ParsedNode {
  id: string;
  coreType: CoreNodeType;
  semanticType?: SemanticNodeType; // ✅ Single semantic type
  labels: string[];
  properties: Neo4jNodeProperties; // ✅ Neo4j properties
  sourceNode?: Node;
  skipEmbedding?: boolean; // Skip embedding for certain nodes
}

export interface ParsedEdge {
  id: string;
  relationshipType: string;
  sourceNodeId: string;
  targetNodeId: string;
  properties: Neo4jEdgeProperties; // ✅ Neo4j properties
}

export interface ParseResult {
  nodes: Map<string, ParsedNode>;
  edges: Map<string, ParsedEdge>;
}

export class TypeScriptParser {
  private project: Project;
  private coreSchema: CoreTypeScriptSchema;
  private parseConfig: ParseOptions;
  private frameworkSchemas: FrameworkSchema[];
  private parsedNodes: Map<string, ParsedNode> = new Map();
  private parsedEdges: Map<string, ParsedEdge> = new Map();

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

    // Initialize with proper compiler options for NestJS
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

  async parseWorkspace(): Promise<{ nodes: Neo4jNode[]; edges: Neo4jEdge[] }> {
    console.log('added', this.project.getSourceFiles().length, 'files to project');
    console.log('🚀 Starting workspace parsing v2...');

    const sourceFiles = this.project.getSourceFiles();
    console.log(`📁 Found ${sourceFiles.length} TypeScript files`);

    // Phase 1: Core parsing for ALL files
    for (const sourceFile of sourceFiles) {
      if (this.shouldSkipFile(sourceFile)) continue;

      console.log(`📄 Parsing file: ${sourceFile.getFilePath()}`);
      await this.parseCoreTypeScript(sourceFile);
    }

    // Phase 2: Apply context extractors
    console.log('🔧 Applying context extractors...');
    await this.applyContextExtractors();

    // Phase 3: Framework enhancements
    if (this.frameworkSchemas.length > 0) {
      console.log('🎯 Applying framework enhancements...');
      await this.applyFrameworkEnhancements();
    }

    // Phase 4: Edge enhancements
    console.log('🔗 Applying edge enhancements...');
    await this.applyEdgeEnhancements();

    console.log(`✅ Parsing complete: ${this.parsedNodes.size} nodes, ${this.parsedEdges.size} edges`);

    // Convert to Neo4j format
    const neo4jNodes = Array.from(this.parsedNodes.values()).map(this.toNeo4jNode);
    const neo4jEdges = Array.from(this.parsedEdges.values()).map(this.toNeo4jEdge);

    return { nodes: neo4jNodes, edges: neo4jEdges };
  }

  private async parseCoreTypeScript(sourceFile: SourceFile): Promise<void> {
    try {
      // Create source file node
      const sourceFileNode = this.createCoreNode(sourceFile, CoreNodeType.SOURCE_FILE);
      this.addNode(sourceFileNode);

      // Parse classes
      for (const classDecl of sourceFile.getClasses()) {
        const classNode = this.createCoreNode(classDecl, CoreNodeType.CLASS_DECLARATION);
        this.addNode(classNode);

        // File contains class relationship
        const containsEdge = this.createCoreEdge(CoreEdgeType.CONTAINS, sourceFileNode.id, classNode.id);
        this.addEdge(containsEdge);

        // Parse class decorators
        for (const decorator of classDecl.getDecorators()) {
          const decoratorNode = this.createCoreNode(decorator, CoreNodeType.DECORATOR);
          this.addNode(decoratorNode);

          // Class decorated with decorator relationship
          const decoratedEdge = this.createCoreEdge(CoreEdgeType.DECORATED_WITH, classNode.id, decoratorNode.id);
          this.addEdge(decoratedEdge);
        }

        // Parse methods
        for (const method of classDecl.getMethods()) {
          const methodNode = this.createCoreNode(method, CoreNodeType.METHOD_DECLARATION);
          this.addNode(methodNode);

          // Class has method relationship
          const hasMethodEdge = this.createCoreEdge(CoreEdgeType.HAS_MEMBER, classNode.id, methodNode.id);
          this.addEdge(hasMethodEdge);

          // Parse method decorators
          for (const decorator of method.getDecorators()) {
            const decoratorNode = this.createCoreNode(decorator, CoreNodeType.DECORATOR);
            this.addNode(decoratorNode);

            // Method decorated with decorator relationship
            const decoratedEdge = this.createCoreEdge(CoreEdgeType.DECORATED_WITH, methodNode.id, decoratorNode.id);
            this.addEdge(decoratedEdge);
          }

          // Parse method parameters
          for (const param of method.getParameters()) {
            const paramNode = this.createCoreNode(param, CoreNodeType.PARAMETER_DECLARATION);
            this.addNode(paramNode);

            // Method has parameter relationship
            const hasParamEdge = this.createCoreEdge(CoreEdgeType.HAS_PARAMETER, methodNode.id, paramNode.id);
            this.addEdge(hasParamEdge);

            // Parse parameter decorators
            for (const decorator of param.getDecorators()) {
              const decoratorNode = this.createCoreNode(decorator, CoreNodeType.DECORATOR);
              this.addNode(decoratorNode);

              // Parameter decorated with decorator relationship
              const decoratedEdge = this.createCoreEdge(CoreEdgeType.DECORATED_WITH, paramNode.id, decoratorNode.id);
              this.addEdge(decoratedEdge);
            }
          }
        }

        // Parse properties
        for (const property of classDecl.getProperties()) {
          const propertyNode = this.createCoreNode(property, CoreNodeType.PROPERTY_DECLARATION);
          this.addNode(propertyNode);

          // Class has property relationship
          const hasPropertyEdge = this.createCoreEdge(CoreEdgeType.HAS_MEMBER, classNode.id, propertyNode.id);
          this.addEdge(hasPropertyEdge);

          // Parse property decorators
          for (const decorator of property.getDecorators()) {
            const decoratorNode = this.createCoreNode(decorator, CoreNodeType.DECORATOR);
            this.addNode(decoratorNode);

            // Property decorated with decorator relationship
            const decoratedEdge = this.createCoreEdge(CoreEdgeType.DECORATED_WITH, propertyNode.id, decoratorNode.id);
            this.addEdge(decoratedEdge);
          }
        }
      }

      // Parse interfaces
      for (const interfaceDecl of sourceFile.getInterfaces()) {
        const interfaceNode = this.createCoreNode(interfaceDecl, CoreNodeType.INTERFACE_DECLARATION);
        this.addNode(interfaceNode);

        // File contains interface relationship
        const containsEdge = this.createCoreEdge(CoreEdgeType.CONTAINS, sourceFileNode.id, interfaceNode.id);
        this.addEdge(containsEdge);
      }

      // Parse functions
      for (const funcDecl of sourceFile.getFunctions()) {
        const functionNode = this.createCoreNode(funcDecl, CoreNodeType.FUNCTION_DECLARATION);
        this.addNode(functionNode);

        // File contains function relationship
        const containsEdge = this.createCoreEdge(CoreEdgeType.CONTAINS, sourceFileNode.id, functionNode.id);
        this.addEdge(containsEdge);

        // Parse function parameters
        for (const param of funcDecl.getParameters()) {
          const paramNode = this.createCoreNode(param, CoreNodeType.PARAMETER_DECLARATION);
          this.addNode(paramNode);

          // Function has parameter relationship
          const hasParamEdge = this.createCoreEdge(CoreEdgeType.HAS_PARAMETER, functionNode.id, paramNode.id);
          this.addEdge(hasParamEdge);
        }
      }

      // Parse imports
      for (const importDecl of sourceFile.getImportDeclarations()) {
        const importNode = this.createCoreNode(importDecl, CoreNodeType.IMPORT_DECLARATION);
        this.addNode(importNode);

        // File contains import relationship
        const containsEdge = this.createCoreEdge(CoreEdgeType.CONTAINS, sourceFileNode.id, importNode.id);
        this.addEdge(containsEdge);
      }
    } catch (error) {
      console.error(`Error parsing file ${sourceFile.getFilePath()}:`, error);
    }
  }

  private createCoreNode(astNode: Node, coreType: CoreNodeType): ParsedNode {
    const nodeId = `${coreType}:${uuidv4()}`;

    // Extract base properties using schema
    const properties: Neo4jNodeProperties = {
      id: nodeId,
      name: this.extractNodeName(astNode, coreType),
      coreType,
      filePath: astNode.getSourceFile().getFilePath(),
      startLine: astNode.getStartLineNumber(),
      endLine: astNode.getEndLineNumber(),
      sourceCode: astNode.getText(),
      createdAt: new Date().toISOString(),
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
        const context = extractor.extractor(node.sourceNode);
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
    return {
      id: `${relationshipType}:${uuidv4()}`,
      relationshipType,
      sourceNodeId,
      targetNodeId,
      properties: {
        coreType: relationshipType,
        source: 'ast',
        confidence: 1.0,
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
              return pattern.pattern(node.sourceNode);
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
          const context = extractor.extractor(coreNode.sourceNode!);
          if (context && Object.keys(context).length > 0) {
            if (!coreNode.properties.context) {
              coreNode.properties.context = {};
            }
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
      for (const [sourceId, sourceNode] of this.parsedNodes) {
        for (const [targetId, targetNode] of this.parsedNodes) {
          if (sourceId === targetId) continue;

          if (edgeEnhancement.detectionPattern(sourceNode, targetNode)) {
            // Extract context for this edge
            let context = {};
            if (edgeEnhancement.contextExtractor) {
              context = edgeEnhancement.contextExtractor(sourceNode, targetNode);
            }

            const edge = this.createFrameworkEdge(
              edgeEnhancement.semanticType,
              edgeEnhancement.neo4j.relationshipType,
              sourceId,
              targetId,
              context,
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
    semanticType: SemanticEdgeType,
    relationshipType: string,
    sourceNodeId: string,
    targetNodeId: string,
    context: Record<string, any> = {},
  ): ParsedEdge {
    const edgeId = `${semanticType}:${uuidv4()}`;

    const properties: Neo4jEdgeProperties = {
      coreType: semanticType as any, // This might need adjustment based on schema
      semanticType,
      source: 'pattern',
      confidence: 0.8,
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
            return astNode.getName() || 'AnonymousClass';
          }
          break;

        case CoreNodeType.METHOD_DECLARATION:
          if (Node.isMethodDeclaration(astNode)) {
            return astNode.getName();
          }
          break;

        case CoreNodeType.FUNCTION_DECLARATION:
          if (Node.isFunctionDeclaration(astNode)) {
            return astNode.getName() || 'AnonymousFunction';
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

  private shouldSkipFile(sourceFile: SourceFile): boolean {
    const filePath = sourceFile.getFilePath();
    const excludedPatterns = this.parseConfig.excludePatterns || [];

    for (const pattern of excludedPatterns) {
      if (filePath.includes(pattern) || filePath.match(new RegExp(pattern))) {
        console.log(`⏭️ Skipping excluded file: ${filePath}`);
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
