/* eslint-disable @typescript-eslint/no-explicit-any */
import path from 'node:path';

import { Project, SourceFile, Node } from 'ts-morph';
import { v4 as uuidv4 } from 'uuid';

import {
  CoreNodeType,
  SemanticNodeType,
  BaseNodeProperties,
  CORE_TYPESCRIPT_SCHEMA,
  CoreTypeScriptSchema,
  DetectionPattern,
  FrameworkSchema,
  NodeEnhancement,
  EdgeEnhancement,
  ParseOptions,
  DEFAULT_PARSE_OPTIONS,
  NESTJS_FRAMEWORK_SCHEMA,
  PropertyDefinition,
  CoreEdgeType,
  SemanticEdgeType,
} from '../types';

export interface ParsedNode {
  id: string;
  coreType: CoreNodeType;
  semanticTypes: SemanticNodeType[];
  labels: string[];
  properties: BaseNodeProperties & Record<string, any>;
  sourceNode?: Node;
}

export interface ParsedEdge {
  id: string;
  relationshipType: string;
  sourceNodeId: string;
  targetNodeId: string;
  properties: Record<string, any>;
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
    frameworkSchemas: FrameworkSchema[] = [NESTJS_FRAMEWORK_SCHEMA], // Pass NESTJS_FRAMEWORK_SCHEMA here
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
        experimentalDecorators: true, // ⚠️ CRITICAL for NestJS
        emitDecoratorMetadata: true, // ⚠️ CRITICAL for NestJS
        target: 7,
        module: 1,
        esModuleInterop: true,
      },
    });
    this.project.addSourceFilesAtPaths(path.join(workspacePath, '**/*.ts'));
  }

  async parseWorkspace(): Promise<{ nodes: ParsedNode[]; edges: ParsedEdge[] }> {
    console.log('added', this.project.getSourceFiles().length, 'files to project');

    console.log('🚀 Starting workspace parsing...');

    const sourceFiles = this.project.getSourceFiles();
    console.log(`📁 Found ${sourceFiles.length} TypeScript files`);

    // Phase 1: Core parsing for ALL files
    for (const sourceFile of sourceFiles) {
      if (this.shouldSkipFile(sourceFile)) continue;

      console.log(`📄 Parsing file: ${sourceFile.getFilePath()}`);
      await this.parseCoreTypeScript(sourceFile); // ✅ Core only
    }

    // Phase 2: Framework enhancements for ALL parsed nodes
    if (this.frameworkSchemas.length > 0) {
      console.log('🔧 Applying framework enhancements...');
      await this.applyFrameworkEnhancements(); // ✅ Framework only
    }

    console.log(`✅ Parsing complete: ${this.parsedNodes.size} nodes, ${this.parsedEdges.size} edges`);

    return {
      nodes: Array.from(this.parsedNodes.values()),
      edges: Array.from(this.parsedEdges.values()),
    };
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

        // ✅ ADD: Parse class decorators
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

          // ✅ ADD: Parse method decorators
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

            // ✅ ADD: Parse parameter decorators
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

          // ✅ ADD: Parse property decorators
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

    // Extract base properties
    const properties: BaseNodeProperties = {
      id: nodeId,
      name: this.extractNodeName(astNode, coreType),
      filePath: astNode.getSourceFile().getFilePath(),
      startLine: astNode.getStartLineNumber(),
      endLine: astNode.getEndLineNumber(),
      sourceCode: astNode.getText(),
      createdAt: new Date().toISOString(),
    };

    const coreNodeDef = this.coreSchema.nodeTypes[coreType];
    if (coreNodeDef) {
      for (const propDef of coreNodeDef.properties) {
        try {
          const value = this.extractProperty(astNode, propDef);
          if (value !== undefined) {
            properties[propDef.name] = value;
          }
        } catch (error) {
          console.warn(`Failed to extract core property ${propDef.name}:`, error);
        }
      }
    }

    return {
      id: nodeId,
      coreType,
      semanticTypes: [],
      labels: [...coreNodeDef.neo4j.labels],
      properties,
      sourceNode: astNode,
    };
  }
  private extractPropertiesFromSchema(astNode: Node, propertyDefs: PropertyDefinition[]): Record<string, any> {
    const extractedProperties: Record<string, any> = {};

    for (const propDef of propertyDefs) {
      try {
        const value = this.extractProperty(astNode, propDef);
        if (value !== undefined) {
          extractedProperties[propDef.name] = value;
        }
      } catch (error) {
        console.warn(`Failed to extract property ${propDef.name}:`, error);
        if (propDef.extraction.defaultValue !== undefined) {
          extractedProperties[propDef.name] = propDef.extraction.defaultValue;
        }
      }
    }

    return extractedProperties;
  }

  private extractProperty(astNode: Node, propDef: PropertyDefinition, edgeContext?: any): any {
    const { method, source, defaultValue } = propDef.extraction;

    try {
      switch (method) {
        case 'ast':
          // ✅ Core schema - simple string method calls
          if (typeof source === 'string') {
            const fn = (astNode as any)[source];
            return typeof fn === 'function' ? fn.call(astNode) : defaultValue;
          }
          return defaultValue;

        case 'computed':
          // ✅ Core schema - simple path execution
          if (typeof source === 'string') {
            return this.executeComputedPath(astNode, source, defaultValue);
          }
          return defaultValue;

        case 'function':
          // ✅ Framework schema - function execution
          if (typeof source === 'function') {
            // Edge property function - pass edge context
            // Node property function - pass node
            return source(astNode);
          }
          return defaultValue;

        case 'pattern':
          if (typeof source === 'string') {
            return this.testPattern(astNode, source, defaultValue);
          }
          return defaultValue;

        case 'static':
          return defaultValue;

        default:
          return defaultValue;
      }
    } catch (error) {
      console.warn(`Failed to extract property ${propDef.name}:`, error);
      return defaultValue;
    }
  }

  private executeComputedPath(astNode: Node, path: string, defaultValue?: any): any {
    const parts = path.split('.');
    let current: any = astNode;

    try {
      for (const part of parts) {
        if (current[part] !== undefined) {
          current = current[part];
        } else {
          return defaultValue; // Path not found
        }
      }
      return current; // Return the final value
    } catch (error) {
      console.warn(`Failed to execute computed path ${path}:`, error);
      return defaultValue;
    }
  }

  private testPattern(astNode: Node, pattern: string, defaultValue?: any): boolean {
    const filePath = astNode.getSourceFile().getFilePath();

    try {
      const regex = new RegExp(pattern);
      return regex.test(filePath);
    } catch (error) {
      console.warn(`Failed to test pattern ${pattern}:`, error);
      return defaultValue ?? false;
    }
  }

  private createCoreEdge(relationshipType: CoreEdgeType, sourceNodeId: string, targetNodeId: string): ParsedEdge {
    return {
      id: `${relationshipType}:${uuidv4()}`,
      relationshipType,
      sourceNodeId,
      targetNodeId,
      properties: {
        createdAt: new Date().toISOString(),
        coreType: relationshipType,
        semanticTypes: [],
        confidence: 1.0,
        source: 'ast',
        filePath: '',
      },
    };
  }

  private async applyFrameworkEnhancements(): Promise<void> {
    console.log('🔧 Starting framework enhancements...');

    // Apply each framework schema in order
    for (const frameworkSchema of this.frameworkSchemas) {
      console.log(`📦 Applying framework schema: ${frameworkSchema.name}`);
      await this.applyFrameworkSchema(frameworkSchema);
    }

    console.log('✅ Framework enhancements complete');
  }

  private async applyFrameworkSchema(schema: FrameworkSchema): Promise<void> {
    // Sort enhancements by priority (highest first)
    const sortedEnhancements = Object.values(schema.nodeEnhancements).sort((a, b) => b.priority - a.priority);

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

    // Apply edge enhancements
    await this.applyEdgeEnhancements(schema);
  }

  private matchesDetectionPatterns(node: ParsedNode, patterns: DetectionPattern[]): boolean {
    return patterns.some((pattern) => {
      try {
        switch (pattern.type) {
          case 'decorator':
            console.log(`Checking decorator pattern: ${pattern.pattern}`);
            console.log(`Node decorators: ${node.properties.decoratorNames}`);
            const matching = this.hasMatchingDecorator(node, pattern.pattern as string);
            console.log(`Decorator match result: ${matching}`);
            return matching;
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
      const decoratorNames = (node.properties.decoratorNames as string[]) || [];
      return decoratorNames.includes(decoratorName);
    } catch (error) {
      console.warn(`Error checking decorator ${decoratorName}:`, error);
      return false;
    }
  }

  private enhanceNode(coreNode: ParsedNode, enhancement: NodeEnhancement): void {
    try {
      // Add semantic type
      if (!coreNode.semanticTypes.includes(enhancement.semanticType)) {
        coreNode.semanticTypes.push(enhancement.semanticType);
      }

      // Add framework labels
      enhancement.neo4j.additionalLabels.forEach((label) => {
        if (!coreNode.labels.includes(label)) {
          coreNode.labels.unshift(label);
        }
      });

      // Override primary label if specified
      if (enhancement.neo4j.primaryLabel) {
        // Remove old primary label and add new one at the front
        const oldPrimaryIndex = coreNode.labels.findIndex((label) => label === enhancement.neo4j.primaryLabel);
        if (oldPrimaryIndex > -1) {
          coreNode.labels.splice(oldPrimaryIndex, 1);
        }
        coreNode.labels.unshift(enhancement.neo4j.primaryLabel);
      }

      for (const propDef of enhancement.additionalProperties) {
        try {
          const value = this.extractProperty(coreNode.sourceNode!, propDef);
          if (value !== undefined) {
            coreNode.properties[propDef.name] = value;
          }
        } catch (error) {
          console.warn(`Failed to extract enhancement property ${propDef.name}:`, error);
          if (propDef.extraction.defaultValue !== undefined) {
            coreNode.properties[propDef.name] = propDef.extraction.defaultValue;
          }
        }
      }
    } catch (error) {
      console.error(`Error enhancing node ${coreNode.id}:`, error);
    }
  }

  private evaluateEdgeProperties(
    propDefs: PropertyDefinition[],
    context: { sourceNode: ParsedNode; targetNode: ParsedNode; parameterNode?: Node },
  ): Record<string, any> {
    const out: Record<string, any> = {};
    for (const def of propDefs) {
      try {
        if (def.extraction.method === 'function' && typeof def.extraction.source === 'function') {
          out[def.name] = def.extraction.source(context);
        } else {
          out[def.name] = def.extraction.defaultValue;
        }
      } catch {
        out[def.name] = def.extraction.defaultValue;
      }
    }
    return out;
  }

  private async applyEdgeEnhancements(schema: FrameworkSchema): Promise<void> {
    for (const edgeEnhancement of Object.values(schema.edgeEnhancements)) {
      await this.applyEdgeEnhancement(edgeEnhancement);
    }
  }

  private async applyEdgeEnhancement(edgeEnhancement: EdgeEnhancement): Promise<void> {
    try {
      for (const [sourceId, sourceNode] of this.parsedNodes) {
        for (const [targetId, targetNode] of this.parsedNodes) {
          if (sourceId === targetId) continue;

          let matches = false;

          if (typeof edgeEnhancement.detectionPattern === 'function') {
            matches = edgeEnhancement.detectionPattern(sourceNode, targetNode);
          } else if (typeof edgeEnhancement.detectionPattern === 'string') {
            // Simple string-based pattern matching
            // This could be extended with more sophisticated logic
            matches = false; // Default for now
          }

          if (matches) {
            const evaluatedProps = this.evaluateEdgeProperties(edgeEnhancement.additionalProperties, {
              sourceNode,
              targetNode,
            });

            const edge = this.createFrameworkEdge(
              edgeEnhancement.semanticType,
              edgeEnhancement.neo4j.relationshipType as CoreEdgeType,
              sourceId,
              targetId,
              evaluatedProps,
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
    coreType: CoreEdgeType = CoreEdgeType.REFERENCES,
    sourceNodeId: string,
    targetNodeId: string,
    additionalProperties: Record<string, any> = {},
  ): ParsedEdge {
    const edgeId = `${semanticType}:${uuidv4()}`;

    const properties: Record<string, any> = {
      createdAt: new Date().toISOString(),
      semanticTypes: [semanticType],
      confidence: 0.8,
      source: 'pattern',
      filePath: '',
      coreType,
      ...additionalProperties,
    };

    return {
      id: edgeId,
      relationshipType: semanticType,
      sourceNodeId,
      targetNodeId,
      properties,
    };
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

      for (const semanticType of node.semanticTypes) {
        nodesBySemanticType[semanticType] = (nodesBySemanticType[semanticType] || 0) + 1;
      }
    }

    return {
      totalNodes: this.parsedNodes.size,
      totalEdges: this.parsedEdges.size,
      nodesByType,
      nodesBySemanticType,
    };
  }

  public exportToJson(): { nodes: ParsedNode[]; edges: ParsedEdge[] } {
    return {
      nodes: Array.from(this.parsedNodes.values()).map((node) => ({
        ...node,
        sourceNode: undefined, // Remove circular references
      })),
      edges: Array.from(this.parsedEdges.values()),
    };
  }
}
