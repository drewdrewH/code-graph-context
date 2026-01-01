/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'node:path';

import { glob } from 'glob';
import { minimatch } from 'minimatch';
import { Project, SourceFile, Node } from 'ts-morph';

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
import { normalizeCode } from '../utils/code-normalizer.js';
import { createFrameworkEdgeData } from '../utils/edge-factory.js';
import { debugLog, hashFile } from '../utils/file-utils.js';
import { resolveProjectId } from '../utils/project-id.js';

// Built-in function names to skip when extracting CALLS edges
const BUILT_IN_FUNCTIONS = new Set([
  'console',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURI',
  'decodeURI',
  'encodeURIComponent',
  'decodeURIComponent',
  'JSON',
  'Math',
  'Date',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Symbol',
  'BigInt',
  'Promise',
  'require',
  'eval',
]);

// Built-in method names to skip when extracting CALLS edges
const BUILT_IN_METHODS = new Set([
  // Array methods
  'push',
  'pop',
  'shift',
  'unshift',
  'slice',
  'splice',
  'concat',
  'join',
  'reverse',
  'sort',
  'indexOf',
  'lastIndexOf',
  'includes',
  'find',
  'findIndex',
  'filter',
  'map',
  'reduce',
  'reduceRight',
  'every',
  'some',
  'forEach',
  'flat',
  'flatMap',
  'fill',
  'entries',
  'keys',
  'values',
  // String methods
  'charAt',
  'charCodeAt',
  'substring',
  'substr',
  'split',
  'trim',
  'trimStart',
  'trimEnd',
  'toLowerCase',
  'toUpperCase',
  'replace',
  'replaceAll',
  'match',
  'search',
  'startsWith',
  'endsWith',
  'padStart',
  'padEnd',
  'repeat',
  // Object methods
  'hasOwnProperty',
  'toString',
  'valueOf',
  'toJSON',
  // Promise methods
  'then',
  'catch',
  'finally',
  // Console methods
  'log',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'dir',
  'table',
  // Common utilities
  'bind',
  'call',
  'apply',
]);

// Built-in class names to skip when extracting constructor calls
const BUILT_IN_CLASSES = new Set([
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Date',
  'RegExp',
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Proxy',
  'Reflect',
  'Symbol',
  'BigInt',
  'ArrayBuffer',
  'DataView',
  'Int8Array',
  'Uint8Array',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  'Buffer',
  'EventEmitter',
]);

/**
 * Generate a deterministic node ID based on stable properties.
 * This ensures the same node gets the same ID across reparses.
 *
 * Identity is based on: projectId + coreType + filePath + name (+ parentId for nested nodes)
 * This is stable because when it matters (one side of edge not reparsed),
 * names are guaranteed unchanged (or imports would break, triggering reparse).
 *
 * Including projectId ensures nodes from different projects have unique IDs
 * even if they have identical file paths and names.
 */
const generateDeterministicId = (
  projectId: string,
  coreType: string,
  filePath: string,
  name: string,
  parentId?: string,
): string => {
  const parts = parentId ? [projectId, coreType, filePath, parentId, name] : [projectId, coreType, filePath, name];
  const identity = parts.join('::');
  const hash = crypto.createHash('sha256').update(identity).digest('hex').substring(0, 16);

  return `${projectId}:${coreType}:${hash}`;
};

// Re-export ParsedNode for convenience
export type { ParsedNode };

/**
 * Common interface for parsers that support streaming import.
 * Both TypeScriptParser and WorkspaceParser implement this.
 */
export interface StreamingParser {
  getProjectId(): string;
  discoverSourceFiles(): Promise<string[]>;
  parseChunk(filePaths: string[], skipEdgeResolution?: boolean): Promise<{ nodes: Neo4jNode[]; edges: Neo4jEdge[] }>;
  addExistingNodesFromChunk(nodes: Neo4jNode[]): void;
  clearParsedData(): void;
  resolveDeferredEdgesManually(): Promise<Neo4jEdge[]>;
  applyEdgeEnhancementsManually(): Promise<Neo4jEdge[]>;
  getCurrentCounts(): { nodes: number; edges: number; deferredEdges: number };
}

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
    targetFilePath?: string; // File path of target for precise matching (used for EXTENDS/IMPLEMENTS)
    // CALLS edge specific properties
    callContext?: {
      receiverExpression?: string; // 'this', 'this.userService', variable name
      receiverType?: string; // Resolved type of receiver (e.g., 'UserService')
      receiverPropertyName?: string; // Property name if this.xxx (e.g., 'userService')
      lineNumber: number;
      isAsync: boolean;
      argumentCount: number;
    };
  }> = [];
  private sharedContext: ParsingContext = new Map(); // Shared context for custom data
  private projectId: string; // Project identifier for multi-project isolation
  private lazyLoad: boolean; // Whether to use lazy file loading for large projects
  private discoveredFiles: string[] | null = null; // Cached file discovery results
  private deferEdgeEnhancements: boolean = false; // When true, skip edge enhancements (parent will handle)
  // Lookup indexes for efficient CALLS edge resolution
  private methodsByClass: Map<string, Map<string, ParsedNode>> = new Map(); // className -> methodName -> node
  private functionsByName: Map<string, ParsedNode> = new Map(); // functionName -> node
  private constructorsByClass: Map<string, ParsedNode> = new Map(); // className -> constructor node

  constructor(
    private workspacePath: string,
    private tsConfigPath: string = 'tsconfig.json',
    coreSchema: CoreTypeScriptSchema = CORE_TYPESCRIPT_SCHEMA,
    frameworkSchemas: FrameworkSchema[] = [NESTJS_FRAMEWORK_SCHEMA],
    parseConfig: ParseOptions = DEFAULT_PARSE_OPTIONS,
    projectId?: string, // Optional - derived from workspacePath if not provided
    lazyLoad: boolean = false, // Set to true for large projects to avoid OOM
  ) {
    this.coreSchema = coreSchema;
    this.frameworkSchemas = frameworkSchemas;
    this.parseConfig = parseConfig;
    this.projectId = resolveProjectId(workspacePath, projectId);
    this.lazyLoad = lazyLoad;

    console.log(`🆔 Project ID: ${this.projectId}`);
    console.log(`📂 Lazy loading: ${lazyLoad ? 'enabled' : 'disabled'}`);

    if (lazyLoad) {
      // Lazy mode: create Project without loading any files
      // Files will be added just-in-time during parseChunk()
      this.project = new Project({
        tsConfigFilePath: tsConfigPath,
        skipAddingFilesFromTsConfig: true, // Don't load files from tsconfig
        skipFileDependencyResolution: true, // Don't load node_modules types
        compilerOptions: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          target: 7,
          module: 1,
          esModuleInterop: true,
          skipLibCheck: true,
        },
      });
    } else {
      // Eager mode: load all files upfront (original behavior for small projects)
      this.project = new Project({
        tsConfigFilePath: tsConfigPath,
        skipAddingFilesFromTsConfig: false,
        skipFileDependencyResolution: true,
        compilerOptions: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          target: 7,
          module: 1,
          esModuleInterop: true,
          skipLibCheck: true,
        },
      });
      // Include both .ts and .tsx files
      this.project.addSourceFilesAtPaths(path.join(workspacePath, '**/*.{ts,tsx}'));
    }
  }

  /**
   * Get the projectId for this parser instance.
   * This is used by tools to pass projectId to Neo4j queries.
   */
  getProjectId(): string {
    return this.projectId;
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
          projectId: this.projectId,
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
      // In lazy mode, files may not be loaded yet - add them if needed
      sourceFiles = filesToParse
        .map((filePath) => {
          const existing = this.project.getSourceFile(filePath);
          if (existing) return existing;
          // Add file to project if not already loaded (lazy mode)
          try {
            return this.project.addSourceFileAtPath(filePath);
          } catch {
            return undefined;
          }
        })
        .filter((sf): sf is SourceFile => sf !== undefined);
    } else {
      sourceFiles = this.project.getSourceFiles();
    }

    for (const sourceFile of sourceFiles) {
      if (this.shouldSkipFile(sourceFile)) continue;
      await this.parseCoreTypeScriptV2(sourceFile);
    }

    await this.resolveDeferredEdges();

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
      size: Number(stats.size),
      mtime: Number(stats.mtimeMs),
      contentHash: await hashFile(filePath),
    };

    const sourceFileNode = this.createCoreNode(sourceFile, CoreNodeType.SOURCE_FILE, fileTrackingProperties);
    this.addNode(sourceFileNode);

    await this.parseChildNodes(this.coreSchema.nodeTypes[CoreNodeType.SOURCE_FILE], sourceFileNode, sourceFile);

    // Queue IMPORTS edges for deferred resolution
    // Note: ImportDeclaration nodes are already created by parseChildNodes via the schema
    // This adds SourceFile → SourceFile IMPORTS edges for cross-file dependency tracking
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();

      // Skip external modules (node_modules) - only process relative and scoped imports
      if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('@')) {
        continue;
      }

      // Use ts-morph's module resolution to get the actual file path
      // This correctly resolves relative imports like './auth.controller' to absolute paths
      try {
        const targetSourceFile = importDecl.getModuleSpecifierSourceFile();
        if (targetSourceFile) {
          this.deferredEdges.push({
            edgeType: CoreEdgeType.IMPORTS,
            sourceNodeId: sourceFileNode.id,
            targetName: targetSourceFile.getFilePath(), // Store resolved absolute path
            targetType: CoreNodeType.SOURCE_FILE,
          });
        }
      } catch {
        // If resolution fails, fall back to raw module specifier
        this.deferredEdges.push({
          edgeType: CoreEdgeType.IMPORTS,
          sourceNodeId: sourceFileNode.id,
          targetName: moduleSpecifier,
          targetType: CoreNodeType.SOURCE_FILE,
        });
      }
    }

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

        // Track parent class name for methods, properties, and constructors
        const extraProperties: Partial<Neo4jNodeProperties> = {};
        if (
          parentNode.coreType === CoreNodeType.CLASS_DECLARATION &&
          (type === CoreNodeType.METHOD_DECLARATION ||
            type === CoreNodeType.PROPERTY_DECLARATION ||
            type === CoreNodeType.CONSTRUCTOR_DECLARATION)
        ) {
          extraProperties.parentClassName = parentNode.properties.name;
        }

        const coreNode = this.createCoreNode(child, type, extraProperties, parentNode.id);
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

        // Extract CALLS edges from method/function/constructor bodies
        const CALL_EXTRACTION_TYPES = new Set([
          CoreNodeType.METHOD_DECLARATION,
          CoreNodeType.FUNCTION_DECLARATION,
          CoreNodeType.CONSTRUCTOR_DECLARATION,
        ]);

        if (CALL_EXTRACTION_TYPES.has(type)) {
          this.extractCallsFromBody(coreNode, child);
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

        // For EXTENDS/IMPLEMENTS, try to get the file path from the resolved declaration
        let targetFilePath: string | undefined;
        if (edgeType === CoreEdgeType.EXTENDS || edgeType === CoreEdgeType.IMPLEMENTS) {
          targetFilePath = this.extractTargetFilePath(target);
        }

        this.deferredEdges.push({
          edgeType: edgeType as CoreEdgeType,
          sourceNodeId: parsedNode.id,
          targetName,
          targetType: targetNodeType,
          targetFilePath,
        });
      }
    }
  }

  /**
   * Extract the file path from a resolved target declaration.
   * Used for EXTENDS/IMPLEMENTS to enable precise matching.
   */
  private extractTargetFilePath(target: Node): string | undefined {
    try {
      // If target is already a ClassDeclaration or InterfaceDeclaration, get its source file
      if (Node.isClassDeclaration(target) || Node.isInterfaceDeclaration(target)) {
        return target.getSourceFile().getFilePath();
      }

      // If target is ExpressionWithTypeArguments (e.g., extends Foo<T>), resolve the type
      if (Node.isExpressionWithTypeArguments(target)) {
        const expression = target.getExpression();
        if (Node.isIdentifier(expression)) {
          // Try to get the definition of the type
          const definitions = expression.getDefinitionNodes();
          for (const def of definitions) {
            if (Node.isClassDeclaration(def) || Node.isInterfaceDeclaration(def)) {
              return def.getSourceFile().getFilePath();
            }
          }
        }
      }
    } catch {
      // If resolution fails (e.g., external type), return undefined
    }
    return undefined;
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
   * Extract method/function calls from the body of a method or function.
   * Creates deferred CALLS edges for resolution after all nodes are parsed.
   */
  private extractCallsFromBody(callerNode: ParsedNode, astNode: Node): void {
    // Get the body of the method/function
    let body: Node | undefined;

    if (Node.isMethodDeclaration(astNode)) {
      body = astNode.getBody();
    } else if (Node.isFunctionDeclaration(astNode)) {
      body = astNode.getBody();
    } else if (Node.isConstructorDeclaration(astNode)) {
      body = astNode.getBody();
    }

    if (!body) return;

    // Skip very short method bodies (likely simple getters/setters)
    const bodyText = body.getText();
    if (bodyText.length < 15) return;

    // Track unique calls to avoid duplicates (same method called multiple times)
    const seenCalls = new Set<string>();

    // Traverse all descendants looking for call expressions
    body.forEachDescendant((descendant) => {
      // Method/function calls: foo(), this.foo(), obj.foo()
      if (Node.isCallExpression(descendant)) {
        const callInfo = this.extractCallInfo(descendant, callerNode);
        if (callInfo) {
          const callKey = `${callInfo.targetName}:${callInfo.receiverType ?? 'unknown'}`;
          if (!seenCalls.has(callKey)) {
            seenCalls.add(callKey);
            this.queueCallEdge(callerNode.id, callInfo);
          }
        }
      }

      // Constructor calls: new ClassName()
      if (Node.isNewExpression(descendant)) {
        const callInfo = this.extractConstructorCallInfo(descendant);
        if (callInfo) {
          const callKey = `constructor:${callInfo.targetClassName}`;
          if (!seenCalls.has(callKey)) {
            seenCalls.add(callKey);
            this.queueCallEdge(callerNode.id, callInfo);
          }
        }
      }
    });
  }

  /**
   * Extract call information from a CallExpression.
   */
  private extractCallInfo(
    callExpr: Node,
    callerNode: ParsedNode,
  ): {
    targetName: string;
    targetType: CoreNodeType;
    receiverExpression?: string;
    receiverType?: string;
    receiverPropertyName?: string;
    lineNumber: number;
    isAsync: boolean;
    argumentCount: number;
    targetClassName?: string;
  } | null {
    if (!Node.isCallExpression(callExpr)) return null;

    const expression = callExpr.getExpression();
    const lineNumber = callExpr.getStartLineNumber();
    const argumentCount = callExpr.getArguments().length;

    // Check if this call is awaited
    const parent = callExpr.getParent();
    const isAsync = parent !== undefined && Node.isAwaitExpression(parent);

    // Case 1: Direct function call - functionName()
    if (Node.isIdentifier(expression)) {
      const targetName = expression.getText();
      // Skip built-in functions and common utilities
      if (this.isBuiltInFunction(targetName)) return null;

      return {
        targetName,
        targetType: CoreNodeType.FUNCTION_DECLARATION,
        lineNumber,
        isAsync,
        argumentCount,
      };
    }

    // Case 2: Method call - obj.method() or this.method() or this.service.method()
    if (Node.isPropertyAccessExpression(expression)) {
      const methodName = expression.getName();
      const receiver = expression.getExpression();

      // Skip common built-in method calls
      if (this.isBuiltInMethod(methodName)) return null;

      // this.method() - internal class method call
      if (Node.isThisExpression(receiver)) {
        return {
          targetName: methodName,
          targetType: CoreNodeType.METHOD_DECLARATION,
          receiverExpression: 'this',
          lineNumber,
          isAsync,
          argumentCount,
        };
      }

      // this.service.method() - dependency injection call
      if (Node.isPropertyAccessExpression(receiver)) {
        const innerReceiver = receiver.getExpression();
        if (Node.isThisExpression(innerReceiver)) {
          const propertyName = receiver.getName();
          // Try to resolve the type from constructor parameters
          const receiverType = this.resolvePropertyType(callerNode, propertyName);

          return {
            targetName: methodName,
            targetType: CoreNodeType.METHOD_DECLARATION,
            receiverExpression: `this.${propertyName}`,
            receiverPropertyName: propertyName,
            receiverType,
            lineNumber,
            isAsync,
            argumentCount,
          };
        }
      }

      // variable.method() - method call on local variable
      if (Node.isIdentifier(receiver)) {
        const varName = receiver.getText();
        // Try to get the type of the variable
        let receiverType: string | undefined;
        try {
          const typeText = receiver.getType().getText();
          // Clean up type (remove generics, imports)
          receiverType = this.cleanTypeName(typeText);
        } catch {
          // Type resolution failed
        }

        return {
          targetName: methodName,
          targetType: CoreNodeType.METHOD_DECLARATION,
          receiverExpression: varName,
          receiverType,
          lineNumber,
          isAsync,
          argumentCount,
        };
      }
    }

    return null;
  }

  /**
   * Extract constructor call information from a NewExpression.
   */
  private extractConstructorCallInfo(newExpr: Node): {
    targetName: string;
    targetType: CoreNodeType;
    targetClassName: string;
    lineNumber: number;
    isAsync: boolean;
    argumentCount: number;
  } | null {
    if (!Node.isNewExpression(newExpr)) return null;

    const expression = newExpr.getExpression();
    const lineNumber = newExpr.getStartLineNumber();
    const argumentCount = newExpr.getArguments().length;

    // new ClassName()
    if (Node.isIdentifier(expression)) {
      const className = expression.getText();

      // Skip built-in constructors
      if (this.isBuiltInClass(className)) return null;

      return {
        targetName: 'constructor',
        targetType: CoreNodeType.CONSTRUCTOR_DECLARATION,
        targetClassName: className,
        lineNumber,
        isAsync: false,
        argumentCount,
      };
    }

    return null;
  }

  /**
   * Queue a CALLS edge for deferred resolution.
   */
  private queueCallEdge(
    sourceNodeId: string,
    callInfo: {
      targetName: string;
      targetType: CoreNodeType;
      receiverExpression?: string;
      receiverType?: string;
      receiverPropertyName?: string;
      targetClassName?: string;
      lineNumber: number;
      isAsync: boolean;
      argumentCount: number;
    },
  ): void {
    // For constructor calls, use class name as target
    const targetName = callInfo.targetClassName ?? callInfo.targetName;

    this.deferredEdges.push({
      edgeType: CoreEdgeType.CALLS,
      sourceNodeId,
      targetName,
      targetType: callInfo.targetType,
      callContext: {
        receiverExpression: callInfo.receiverExpression,
        receiverType: callInfo.receiverType,
        receiverPropertyName: callInfo.receiverPropertyName,
        lineNumber: callInfo.lineNumber,
        isAsync: callInfo.isAsync,
        argumentCount: callInfo.argumentCount,
      },
    });
  }

  /**
   * Resolve the type of a class property from constructor parameters.
   * Used for NestJS dependency injection pattern.
   */
  private resolvePropertyType(node: ParsedNode, propertyName: string): string | undefined {
    // Look for constructor parameter types in the node's context
    const context = node.properties.context;
    if (context?.constructorParamTypes) {
      const paramTypes = context.constructorParamTypes as string[];
      // Constructor params with 'private' or 'public' become properties
      // Try to find a matching parameter by name
      // The context extractor stores types in order, we need to match by name
      // For now, use a heuristic: look for type that matches property name
      for (const paramType of paramTypes) {
        // Check if the type name matches (case-insensitive, removing 'Service', 'Repository' etc.)
        const normalizedProp = propertyName.toLowerCase().replace(/service|repository|provider/gi, '');
        const normalizedType = paramType.toLowerCase().replace(/service|repository|provider/gi, '');
        if (normalizedType.includes(normalizedProp) || normalizedProp.includes(normalizedType)) {
          return paramType;
        }
      }
    }

    // Also check the class node's parent for constructor info
    const classNode = this.findParentClassNode(node);
    if (classNode?.properties.context?.constructorParamTypes) {
      const paramTypes = classNode.properties.context.constructorParamTypes as string[];
      for (const paramType of paramTypes) {
        const normalizedProp = propertyName.toLowerCase().replace(/service|repository|provider/gi, '');
        const normalizedType = paramType.toLowerCase().replace(/service|repository|provider/gi, '');
        if (normalizedType.includes(normalizedProp) || normalizedProp.includes(normalizedType)) {
          return paramType;
        }
      }
    }

    return undefined;
  }

  /**
   * Find the parent class node for a method/property node.
   * Uses the parentClassName property tracked during parsing.
   */
  private findParentClassNode(node: ParsedNode): ParsedNode | undefined {
    const parentClassName = node.properties.parentClassName as string | undefined;
    if (!parentClassName) return undefined;

    // Find the class node by name and file path
    for (const [, classNode] of this.parsedNodes) {
      if (
        classNode.coreType === CoreNodeType.CLASS_DECLARATION &&
        classNode.properties.name === parentClassName &&
        classNode.properties.filePath === node.properties.filePath
      ) {
        return classNode;
      }
    }
    return undefined;
  }

  /**
   * Clean up a type name by removing generics, imports, etc.
   */
  private cleanTypeName(typeName: string): string {
    // Remove import paths: import("...").ClassName -> ClassName
    let cleaned = typeName.replace(/import\([^)]+\)\./g, '');
    // Remove generics: ClassName<T> -> ClassName
    const genericIndex = cleaned.indexOf('<');
    if (genericIndex > 0) {
      cleaned = cleaned.substring(0, genericIndex);
    }
    // Remove array notation: ClassName[] -> ClassName
    cleaned = cleaned.replace(/\[\]$/, '');
    return cleaned.trim();
  }

  /**
   * Check if a function name is a built-in JavaScript/Node.js function.
   */
  private isBuiltInFunction(name: string): boolean {
    return BUILT_IN_FUNCTIONS.has(name);
  }

  /**
   * Check if a method name is a common built-in method.
   */
  private isBuiltInMethod(name: string): boolean {
    return BUILT_IN_METHODS.has(name);
  }

  /**
   * Check if a class name is a built-in JavaScript class.
   */
  private isBuiltInClass(name: string): boolean {
    return BUILT_IN_CLASSES.has(name);
  }

  /**
   * Find a parsed node by name and core type
   * For SourceFiles, implements smart import resolution:
   * - Direct file path match
   * - Relative import resolution (./foo, ../bar)
   * - Scoped package imports (@workspace/ui, @ui/core)
   *
   * For ClassDeclaration/InterfaceDeclaration with filePath, uses precise matching.
   */
  private findNodeByNameAndType(name: string, coreType: CoreNodeType, filePath?: string): ParsedNode | undefined {
    // Combine both node collections for searching
    const allNodes = [...this.parsedNodes.values(), ...this.existingNodes.values()];

    // If we have a file path and it's not a SOURCE_FILE, use precise matching first
    if (filePath && coreType !== CoreNodeType.SOURCE_FILE) {
      for (const node of allNodes) {
        if (node.coreType === coreType && node.properties.name === name && node.properties.filePath === filePath) {
          return node;
        }
      }
      // If precise match fails, fall through to name-only matching below
    }

    // For SOURCE_FILE with import specifier, try multiple matching strategies
    if (coreType === CoreNodeType.SOURCE_FILE) {
      // Strategy 1: Direct file path match
      for (const node of allNodes) {
        if (node.coreType === coreType && node.properties.filePath === name) {
          return node;
        }
      }

      // Strategy 2: Resolve relative imports (./foo, ../bar, ../../baz)
      if (name.startsWith('.')) {
        // Normalize: remove all leading ./ or ../ segments (handles ../../foo, ./bar, etc.)
        const normalizedPath = name.replace(/^(\.\.?\/)+/, '');

        // Try matching with common extensions
        const extensions = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
        for (const ext of extensions) {
          const searchPath = normalizedPath + ext;
          for (const node of allNodes) {
            if (node.coreType === coreType) {
              // Match if filePath ends with the normalized path
              if (
                node.properties.filePath.endsWith(searchPath) ||
                node.properties.filePath.endsWith('/' + searchPath)
              ) {
                return node;
              }
            }
          }
        }
      }

      // Strategy 3: Workspace package imports (@workspace/ui, @ui/core)
      if (name.startsWith('@')) {
        const parts = name.split('/');
        const packageName = parts.slice(0, 2).join('/'); // @scope/package
        const subPath = parts.slice(2).join('/'); // rest of path after package name

        // First, try to find an exact match with subpath
        if (subPath) {
          const extensions = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
          for (const ext of extensions) {
            const searchPath = subPath + ext;
            for (const node of allNodes) {
              if (node.coreType === coreType && node.properties.packageName === packageName) {
                if (
                  node.properties.filePath.endsWith(searchPath) ||
                  node.properties.filePath.endsWith('/' + searchPath)
                ) {
                  return node;
                }
              }
            }
          }
        }

        // For bare package imports (@workspace/ui), look for index files
        if (!subPath) {
          for (const node of allNodes) {
            if (node.coreType === coreType && node.properties.packageName === packageName) {
              const fileName = node.properties.name;
              if (fileName === 'index.ts' || fileName === 'index.tsx') {
                return node;
              }
            }
          }
          // If no index file, return any file from the package as a fallback
          for (const node of allNodes) {
            if (node.coreType === coreType && node.properties.packageName === packageName) {
              return node;
            }
          }
        }
      }
    }

    // Default: exact name match (for non-SourceFile types like classes, interfaces)
    for (const node of allNodes) {
      if (node.coreType === coreType && node.properties.name === name) {
        return node;
      }
    }

    return undefined;
  }

  /**
   * Resolve deferred edges after all nodes have been parsed
   */
  private async resolveDeferredEdges(): Promise<void> {
    // Count edges by type for logging
    const importsCount = this.deferredEdges.filter((e) => e.edgeType === CoreEdgeType.IMPORTS).length;
    const extendsCount = this.deferredEdges.filter((e) => e.edgeType === CoreEdgeType.EXTENDS).length;
    const implementsCount = this.deferredEdges.filter((e) => e.edgeType === CoreEdgeType.IMPLEMENTS).length;
    const callsCount = this.deferredEdges.filter((e) => e.edgeType === CoreEdgeType.CALLS).length;

    let importsResolved = 0;
    let extendsResolved = 0;
    let implementsResolved = 0;
    let callsResolved = 0;
    const unresolvedImports: string[] = [];
    const unresolvedExtends: string[] = [];
    const unresolvedImplements: string[] = [];
    const unresolvedCalls: string[] = [];

    for (const deferred of this.deferredEdges) {
      // Special handling for CALLS edges
      if (deferred.edgeType === CoreEdgeType.CALLS) {
        const targetNode = this.resolveCallTarget(deferred);

        if (targetNode) {
          const edge = this.createCallsEdge(deferred.sourceNodeId, targetNode.id, deferred.callContext);
          this.addEdge(edge);
          callsResolved++;
        } else {
          const callDesc = deferred.callContext?.receiverType
            ? `${deferred.callContext.receiverType}.${deferred.targetName}`
            : deferred.targetName;
          unresolvedCalls.push(callDesc);
        }
        continue;
      }

      // Pass filePath for precise matching (especially important for EXTENDS/IMPLEMENTS)
      const targetNode = this.findNodeByNameAndType(deferred.targetName, deferred.targetType, deferred.targetFilePath);

      if (targetNode) {
        const edge = this.createCoreEdge(deferred.edgeType, deferred.sourceNodeId, targetNode.id);
        this.addEdge(edge);

        // Track resolution by type
        if (deferred.edgeType === CoreEdgeType.IMPORTS) {
          importsResolved++;
        } else if (deferred.edgeType === CoreEdgeType.EXTENDS) {
          extendsResolved++;
        } else if (deferred.edgeType === CoreEdgeType.IMPLEMENTS) {
          implementsResolved++;
        }
      } else {
        // Track unresolved by type
        if (deferred.edgeType === CoreEdgeType.IMPORTS) {
          unresolvedImports.push(deferred.targetName);
        } else if (deferred.edgeType === CoreEdgeType.EXTENDS) {
          unresolvedExtends.push(deferred.targetName);
        } else if (deferred.edgeType === CoreEdgeType.IMPLEMENTS) {
          unresolvedImplements.push(deferred.targetName);
        }
      }
    }

    // Log import resolution stats
    if (importsCount > 0) {
      await debugLog('Import edge resolution', {
        totalImports: importsCount,
        resolved: importsResolved,
        unresolvedCount: unresolvedImports.length,
        unresolvedSample: unresolvedImports.slice(0, 10),
      });
    }

    // Log inheritance (EXTENDS/IMPLEMENTS) resolution stats
    if (extendsCount > 0 || implementsCount > 0) {
      await debugLog('Inheritance edge resolution', {
        extendsQueued: extendsCount,
        extendsResolved,
        extendsUnresolved: unresolvedExtends.length,
        unresolvedExtendsSample: unresolvedExtends.slice(0, 10),
        implementsQueued: implementsCount,
        implementsResolved,
        implementsUnresolved: unresolvedImplements.length,
        unresolvedImplementsSample: unresolvedImplements.slice(0, 10),
      });
    }

    // Log CALLS resolution stats
    if (callsCount > 0) {
      await debugLog('CALLS edge resolution', {
        totalCalls: callsCount,
        resolved: callsResolved,
        unresolvedCount: unresolvedCalls.length,
        unresolvedSample: unresolvedCalls.slice(0, 10),
      });
    }

    this.deferredEdges = [];
  }

  /**
   * Resolve the target node for a CALLS edge.
   * Uses special resolution logic based on call context.
   */
  private resolveCallTarget(deferred: {
    targetName: string;
    targetType: CoreNodeType;
    sourceNodeId: string;
    callContext?: {
      receiverExpression?: string;
      receiverType?: string;
      receiverPropertyName?: string;
      lineNumber: number;
      isAsync: boolean;
      argumentCount: number;
    };
  }): ParsedNode | undefined {
    const { targetName, targetType, sourceNodeId, callContext } = deferred;

    // Case 1: this.method() - internal class method call
    if (callContext?.receiverExpression === 'this') {
      // Find the caller's class, then look for method in same class
      const sourceNode = this.parsedNodes.get(sourceNodeId) ?? this.existingNodes.get(sourceNodeId);
      if (sourceNode) {
        const className = this.getClassNameForNode(sourceNode);
        if (className && this.methodsByClass.has(className)) {
          const method = this.methodsByClass.get(className)!.get(targetName);
          if (method) return method;
        }
      }
    }

    // Case 2: this.service.method() - dependency injection call
    if (callContext?.receiverType) {
      // Look for method in the receiver's class
      const className = callContext.receiverType;
      if (this.methodsByClass.has(className)) {
        const method = this.methodsByClass.get(className)!.get(targetName);
        if (method) return method;
      }
      // Fallback: search all nodes for a method with this name in a class matching the type
      for (const [, node] of this.parsedNodes) {
        if (node.coreType === CoreNodeType.METHOD_DECLARATION && node.properties.name === targetName) {
          // Check if parent class matches the receiver type
          const parentClass = this.findParentClassNode(node);
          if (parentClass?.properties.name === className) {
            return node;
          }
        }
      }
    }

    // Case 3: Constructor call - find the constructor in the target class
    if (targetType === CoreNodeType.CONSTRUCTOR_DECLARATION) {
      const constructor = this.constructorsByClass.get(targetName);
      if (constructor) return constructor;
    }

    // Case 4: Standalone function call
    if (targetType === CoreNodeType.FUNCTION_DECLARATION) {
      const func = this.functionsByName.get(targetName);
      if (func) return func;
    }

    // Fallback: generic name matching
    return this.findNodeByNameAndType(targetName, targetType);
  }

  /**
   * Create a CALLS edge with call-specific context.
   */
  private createCallsEdge(
    sourceNodeId: string,
    targetNodeId: string,
    callContext?: {
      receiverExpression?: string;
      receiverType?: string;
      receiverPropertyName?: string;
      lineNumber: number;
      isAsync: boolean;
      argumentCount: number;
    },
  ): ParsedEdge {
    const coreEdgeSchema = CORE_TYPESCRIPT_SCHEMA.edgeTypes[CoreEdgeType.CALLS];
    const relationshipWeight = coreEdgeSchema?.relationshipWeight ?? 0.85;

    // Confidence: higher if we resolved the receiver type
    const confidence = callContext?.receiverType ? 0.9 : 0.7;

    // Generate deterministic edge ID based on type + source + target + line
    const lineNum = callContext?.lineNumber ?? 0;
    const edgeIdentity = `CALLS::${sourceNodeId}::${targetNodeId}::${lineNum}`;
    const edgeHash = crypto.createHash('sha256').update(edgeIdentity).digest('hex').substring(0, 16);
    const edgeId = `CALLS:${edgeHash}`;

    return {
      id: edgeId,
      relationshipType: 'CALLS',
      sourceNodeId,
      targetNodeId,
      properties: {
        coreType: CoreEdgeType.CALLS,
        projectId: this.projectId,
        source: 'ast',
        confidence,
        relationshipWeight,
        filePath: '',
        createdAt: new Date().toISOString(),
        lineNumber: callContext?.lineNumber,
        context: callContext
          ? {
              isAsync: callContext.isAsync,
              argumentCount: callContext.argumentCount,
              receiverType: callContext.receiverType,
            }
          : undefined,
      },
    };
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

        // Try to resolve import to create SourceFile -> SourceFile IMPORTS edge
        try {
          const targetSourceFile = importDecl.getModuleSpecifierSourceFile();
          if (targetSourceFile) {
            const targetFilePath = targetSourceFile.getFilePath();
            // Queue deferred edge - will be resolved after all files are parsed
            this.deferredEdges.push({
              edgeType: CoreEdgeType.IMPORTS,
              sourceNodeId: sourceFileNode.id,
              targetName: targetFilePath, // Use file path as "name" for SourceFiles
              targetType: CoreNodeType.SOURCE_FILE,
            });
          }
        } catch {
          // Module resolution failed - external dependency, skip
        }
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
    const nodeId = generateDeterministicId(this.projectId, coreType, filePath, name, parentId);

    // Extract base properties using schema
    const properties: Neo4jNodeProperties = {
      id: nodeId,
      projectId: this.projectId,
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

    // Compute normalizedHash for duplicate detection (methods, functions, constructors)
    if (
      coreType === CoreNodeType.METHOD_DECLARATION ||
      coreType === CoreNodeType.FUNCTION_DECLARATION ||
      coreType === CoreNodeType.CONSTRUCTOR_DECLARATION
    ) {
      try {
        const { normalizedHash } = normalizeCode(properties.sourceCode);
        if (normalizedHash) {
          properties.normalizedHash = normalizedHash;
        }
      } catch (error) {
        console.warn(`Failed to compute normalizedHash for ${nodeId}:`, error);
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
        projectId: this.projectId,
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
              // Pass the AST sourceNode to pattern functions, not the ParsedNode wrapper
              const astNode = node.sourceNode;
              if (!astNode) return false;
              return pattern.pattern(astNode);
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
      // Combine parsed nodes and existing nodes for edge matching
      // Detection patterns should use pre-extracted context, not raw AST
      const allTargetNodes = new Map([...this.parsedNodes, ...this.existingNodes]);

      for (const [sourceId, sourceNode] of this.parsedNodes) {
        // Note: sourceNode.sourceNode may be undefined after AST cleanup
        // Detection patterns should use pre-extracted context from node.properties.context

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
    const { id, properties } = createFrameworkEdgeData({
      semanticType,
      sourceNodeId,
      targetNodeId,
      projectId: this.projectId,
      context,
      relationshipWeight,
    });

    return {
      id,
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

  /**
   * Safely test if a file path matches a pattern (string or regex).
   * Falls back to literal string matching if the pattern is an invalid regex.
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // First try literal string match (always safe)
    if (filePath.includes(pattern)) {
      return true;
    }
    // Then try regex match with error handling
    try {
      return new RegExp(pattern).test(filePath);
    } catch {
      // Invalid regex pattern - already checked via includes() above
      return false;
    }
  }

  private shouldSkipFile(sourceFile: SourceFile): boolean {
    const filePath = sourceFile.getFilePath();
    const excludedPatterns = this.parseConfig.excludePatterns ?? [];

    for (const pattern of excludedPatterns) {
      if (this.matchesPattern(filePath, pattern)) {
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

    // Build lookup indexes for CALLS edge resolution
    if (node.coreType === CoreNodeType.METHOD_DECLARATION) {
      const className = this.getClassNameForNode(node);
      if (className) {
        if (!this.methodsByClass.has(className)) {
          this.methodsByClass.set(className, new Map());
        }
        this.methodsByClass.get(className)!.set(node.properties.name, node);
      }
    } else if (node.coreType === CoreNodeType.FUNCTION_DECLARATION) {
      this.functionsByName.set(node.properties.name, node);
    } else if (node.coreType === CoreNodeType.CONSTRUCTOR_DECLARATION) {
      const className = this.getClassNameForNode(node);
      if (className) {
        this.constructorsByClass.set(className, node);
      }
    }
  }

  /**
   * Get the class name for a node.
   * Uses the parentClassName property tracked during parsing.
   */
  private getClassNameForNode(node: ParsedNode): string | undefined {
    // Use the parentClassName that was tracked during parseChildNodes
    return node.properties.parentClassName as string | undefined;
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

  // ============================================
  // CHUNK-AWARE PARSING METHODS
  // For streaming/chunked parsing of large codebases
  // ============================================

  /**
   * Export current chunk results without clearing internal state.
   * Use this when importing chunks incrementally.
   */
  public exportChunkResults(): {
    nodes: Neo4jNode[];
    edges: Neo4jEdge[];
    deferredEdges: Array<{
      edgeType: CoreEdgeType;
      sourceNodeId: string;
      targetName: string;
      targetType: CoreNodeType;
    }>;
  } {
    const nodes = Array.from(this.parsedNodes.values()).map(this.toNeo4jNode);
    const edges = Array.from(this.parsedEdges.values()).map(this.toNeo4jEdge);

    return {
      nodes,
      edges,
      deferredEdges: [...this.deferredEdges],
    };
  }

  /**
   * Clear all parsed data (nodes, edges, deferred edges).
   * Call this after importing a chunk to free memory.
   */
  public clearParsedData(): void {
    this.parsedNodes.clear();
    this.parsedEdges.clear();
    this.deferredEdges = [];
    // Clear CALLS edge lookup indexes
    this.methodsByClass.clear();
    this.functionsByName.clear();
    this.constructorsByClass.clear();
  }

  /**
   * Get count of currently parsed nodes and edges.
   * Useful for progress reporting.
   */
  public getCurrentCounts(): { nodes: number; edges: number; deferredEdges: number } {
    return {
      nodes: this.parsedNodes.size,
      edges: this.parsedEdges.size,
      deferredEdges: this.deferredEdges.length,
    };
  }

  /**
   * Set the shared context for this parser.
   * Use this to share context across multiple parsers (e.g., in WorkspaceParser).
   * @param context The shared context map to use
   */
  public setSharedContext(context: ParsingContext): void {
    this.sharedContext = context;
  }

  /**
   * Get the shared context from this parser.
   * Useful for aggregating context across multiple parsers.
   */
  public getSharedContext(): ParsingContext {
    return this.sharedContext;
  }

  /**
   * Get all parsed nodes (for cross-parser edge resolution).
   * Returns the internal Map of ParsedNodes.
   */
  public getParsedNodes(): Map<string, ParsedNode> {
    return this.parsedNodes;
  }

  /**
   * Get the framework schemas used by this parser.
   * Useful for WorkspaceParser to apply cross-package edge enhancements.
   */
  public getFrameworkSchemas(): FrameworkSchema[] {
    return this.frameworkSchemas;
  }

  /**
   * Defer edge enhancements to a parent parser (e.g., WorkspaceParser).
   * When true, parseChunk() will skip applyEdgeEnhancements().
   * The parent is responsible for calling applyEdgeEnhancementsManually() at the end.
   */
  public setDeferEdgeEnhancements(defer: boolean): void {
    this.deferEdgeEnhancements = defer;
  }

  /**
   * Get list of source files in the project.
   * In lazy mode, uses glob to discover files without loading them into memory.
   * Useful for determining total work and creating chunks.
   */
  public async discoverSourceFiles(): Promise<string[]> {
    if (this.discoveredFiles !== null) {
      return this.discoveredFiles;
    }

    if (this.lazyLoad) {
      // Use glob to find files without loading them into ts-morph
      // Include both .ts and .tsx files
      const pattern = path.join(this.workspacePath, '**/*.{ts,tsx}');
      const allFiles = await glob(pattern, {
        ignore: ['**/node_modules/**', '**/*.d.ts'],
        absolute: true,
      });

      // Apply exclude patterns from parseConfig
      const excludedPatterns = this.parseConfig.excludePatterns ?? [];
      this.discoveredFiles = allFiles.filter((filePath) => {
        for (const excludePattern of excludedPatterns) {
          if (this.matchesPattern(filePath, excludePattern)) {
            return false;
          }
        }
        return true;
      });

      console.log(`🔍 Discovered ${this.discoveredFiles.length} TypeScript files (lazy mode)`);
      return this.discoveredFiles;
    } else {
      // Eager mode - files are already loaded
      this.discoveredFiles = this.project
        .getSourceFiles()
        .filter((sf) => !this.shouldSkipFile(sf))
        .map((sf) => sf.getFilePath());
      return this.discoveredFiles;
    }
  }

  /**
   * @deprecated Use discoverSourceFiles() instead for async file discovery
   */
  public getSourceFilePaths(): string[] {
    if (this.lazyLoad) {
      throw new Error('getSourceFilePaths() is not supported in lazy mode. Use discoverSourceFiles() instead.');
    }
    return this.project
      .getSourceFiles()
      .filter((sf) => !this.shouldSkipFile(sf))
      .map((sf) => sf.getFilePath());
  }

  /**
   * Parse a chunk of files without resolving deferred edges.
   * Use this for streaming parsing where edges are resolved after all chunks.
   * In lazy mode, files are added to the project just-in-time and removed after parsing.
   * @param filePaths Specific file paths to parse
   * @param skipEdgeResolution If true, deferred edges are not resolved (default: false)
   */
  async parseChunk(
    filePaths: string[],
    skipEdgeResolution: boolean = false,
  ): Promise<{ nodes: Neo4jNode[]; edges: Neo4jEdge[] }> {
    // Declare sourceFiles outside try so it's available in finally
    const sourceFiles: SourceFile[] = [];

    try {
      if (this.lazyLoad) {
        // Lazy mode: add files to project just-in-time
        for (const filePath of filePaths) {
          try {
            // Check if file already exists in project (shouldn't happen in lazy mode)
            // Add the file to the project if not already present
            const sourceFile = this.project.getSourceFile(filePath) ?? this.project.addSourceFileAtPath(filePath);
            sourceFiles.push(sourceFile);
          } catch (error) {
            console.warn(`Failed to add source file ${filePath}:`, error);
          }
        }
      } else {
        // Eager mode: files are already loaded
        const loadedFiles = filePaths
          .map((filePath) => this.project.getSourceFile(filePath))
          .filter((sf): sf is SourceFile => sf !== undefined);
        sourceFiles.push(...loadedFiles);
      }

      for (const sourceFile of sourceFiles) {
        if (this.shouldSkipFile(sourceFile)) continue;
        await this.parseCoreTypeScriptV2(sourceFile);
      }

      // Only resolve edges if not skipping
      if (!skipEdgeResolution) {
        await this.resolveDeferredEdges();
      }

      await this.applyContextExtractors();

      if (this.frameworkSchemas.length > 0) {
        await this.applyFrameworkEnhancements();
      }

      // Apply edge enhancements unless deferred to parent (e.g., WorkspaceParser)
      // When deferred, parent will call applyEdgeEnhancementsManually() at the end
      // with all accumulated nodes for cross-package edge detection
      if (!this.deferEdgeEnhancements) {
        await this.applyEdgeEnhancements();
      }

      const neo4jNodes = Array.from(this.parsedNodes.values()).map(this.toNeo4jNode);
      const neo4jEdges = Array.from(this.parsedEdges.values()).map(this.toNeo4jEdge);

      return { nodes: neo4jNodes, edges: neo4jEdges };
    } finally {
      // Always clean up in lazy mode to prevent memory leaks
      if (this.lazyLoad) {
        for (const sourceFile of sourceFiles) {
          try {
            this.project.removeSourceFile(sourceFile);
          } catch {
            // Ignore errors when removing files
          }
        }
      }
    }
  }

  /**
   * Resolve deferred edges against both parsed nodes and existing nodes.
   * Call this after all chunks have been parsed.
   * @returns Resolved edges
   */
  public async resolveDeferredEdgesManually(): Promise<Neo4jEdge[]> {
    const resolvedEdges: ParsedEdge[] = [];

    // Count edges by type for logging
    const extendsCount = this.deferredEdges.filter((e) => e.edgeType === CoreEdgeType.EXTENDS).length;
    const implementsCount = this.deferredEdges.filter((e) => e.edgeType === CoreEdgeType.IMPLEMENTS).length;
    let extendsResolved = 0;
    let implementsResolved = 0;
    const unresolvedExtends: string[] = [];
    const unresolvedImplements: string[] = [];

    for (const deferred of this.deferredEdges) {
      // Pass filePath for precise matching (especially important for EXTENDS/IMPLEMENTS)
      const targetNode = this.findNodeByNameAndType(deferred.targetName, deferred.targetType, deferred.targetFilePath);

      if (targetNode) {
        const edge = this.createCoreEdge(deferred.edgeType, deferred.sourceNodeId, targetNode.id);
        resolvedEdges.push(edge);
        this.addEdge(edge);

        if (deferred.edgeType === CoreEdgeType.EXTENDS) {
          extendsResolved++;
        } else if (deferred.edgeType === CoreEdgeType.IMPLEMENTS) {
          implementsResolved++;
        }
      } else {
        if (deferred.edgeType === CoreEdgeType.EXTENDS) {
          unresolvedExtends.push(deferred.targetName);
        } else if (deferred.edgeType === CoreEdgeType.IMPLEMENTS) {
          unresolvedImplements.push(deferred.targetName);
        }
      }
    }

    // Log inheritance resolution stats
    if (extendsCount > 0 || implementsCount > 0) {
      await debugLog('Inheritance edge resolution (manual)', {
        extendsQueued: extendsCount,
        extendsResolved,
        extendsUnresolved: unresolvedExtends.length,
        unresolvedExtendsSample: unresolvedExtends.slice(0, 10),
        implementsQueued: implementsCount,
        implementsResolved,
        implementsUnresolved: unresolvedImplements.length,
        unresolvedImplementsSample: unresolvedImplements.slice(0, 10),
      });
    }

    this.deferredEdges = [];
    return resolvedEdges.map(this.toNeo4jEdge);
  }

  /**
   * Apply edge enhancements on all accumulated nodes.
   * Call this after all chunks have been parsed for streaming mode.
   * This allows context-dependent edges (like INTERNAL_API_CALL) to be detected
   * after all nodes and their context have been collected.
   * @returns New edges created by edge enhancements
   */
  public async applyEdgeEnhancementsManually(): Promise<Neo4jEdge[]> {
    const edgeCountBefore = this.parsedEdges.size;

    console.log(`🔗 Applying edge enhancements on ${this.parsedNodes.size} accumulated nodes...`);

    await this.applyEdgeEnhancements();

    const newEdgeCount = this.parsedEdges.size - edgeCountBefore;
    console.log(`   ✅ Created ${newEdgeCount} edges from edge enhancements`);

    // Return only the new edges (those created by edge enhancements)
    const allEdges = Array.from(this.parsedEdges.values()).map(this.toNeo4jEdge);
    return allEdges.slice(edgeCountBefore);
  }

  /**
   * Add nodes to the existing nodes map for cross-chunk edge resolution.
   * These nodes are considered as potential edge targets but won't be exported.
   */
  public addExistingNodesFromChunk(nodes: Neo4jNode[]): void {
    for (const node of nodes) {
      const parsedNode: ParsedNode = {
        id: node.id,
        coreType: node.properties.coreType as CoreNodeType,
        semanticType: node.properties.semanticType,
        labels: node.labels,
        properties: node.properties,
      };
      this.existingNodes.set(node.id, parsedNode);
    }
  }
}
