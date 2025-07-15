/* eslint-disable @typescript-eslint/no-explicit-any */
// graph.ts - Updated with layered architecture and framework separation

/**
 * Core TypeScript AST Node Types (from ts-morph)
 * These are the fundamental building blocks we get from parsing
 */

export enum CoreNodeType {
  // File System & Workspace
  NX_PROJECT = 'NxProject',
  SOURCE_FILE = 'SourceFile',

  // Core TypeScript AST Declarations
  CLASS_DECLARATION = 'ClassDeclaration',
  INTERFACE_DECLARATION = 'InterfaceDeclaration',
  ENUM_DECLARATION = 'EnumDeclaration',
  TYPE_ALIAS_DECLARATION = 'TypeAliasDeclaration',
  FUNCTION_DECLARATION = 'FunctionDeclaration',
  VARIABLE_DECLARATION = 'VariableDeclaration',

  // Class Members
  METHOD_DECLARATION = 'MethodDeclaration',
  PROPERTY_DECLARATION = 'PropertyDeclaration',
  CONSTRUCTOR_DECLARATION = 'ConstructorDeclaration',
  GET_ACCESSOR_DECLARATION = 'GetAccessorDeclaration',
  SET_ACCESSOR_DECLARATION = 'SetAccessorDeclaration',

  // Function Elements
  PARAMETER_DECLARATION = 'ParameterDeclaration',

  // Import/Export System
  IMPORT_DECLARATION = 'ImportDeclaration',
  EXPORT_DECLARATION = 'ExportDeclaration',
  EXPORT_ASSIGNMENT = 'ExportAssignment',

  // Decorators & Metadata
  DECORATOR = 'Decorator',

  // Comments & Documentation
  JS_DOC_COMMENT = 'JSDocComment',

  // Expressions (for method calls, instantiations)
  CALL_EXPRESSION = 'CallExpression',
  NEW_EXPRESSION = 'NewExpression',
}

/**
 * Core Edge Types (based on AST relationships)
 * These map to actual code relationships we can detect via ts-morph
 */
export enum CoreEdgeType {
  // File Structure Edges
  CONTAINS = 'CONTAINS', // File contains Class, Project contains File
  DECLARES = 'DECLARES', // File declares Class/Interface/etc

  // Import/Export Edges
  IMPORTS = 'IMPORTS', // File imports from File
  EXPORTS = 'EXPORTS', // File exports Symbol
  REFERENCES = 'REFERENCES', // Symbol references Symbol

  // Type System Edges
  EXTENDS = 'EXTENDS', // Class extends BaseClass
  IMPLEMENTS = 'IMPLEMENTS', // Class implements Interface
  TYPED_AS = 'TYPED_AS', // Parameter typed as Interface
  RETURNS = 'RETURNS', // Method returns Type

  // Code Structure Edges
  HAS_MEMBER = 'HAS_MEMBER', // Class has Method/Property
  HAS_PARAMETER = 'HAS_PARAMETER', // Method has Parameter
  CALLS = 'CALLS', // Method calls Method
  INSTANTIATES = 'INSTANTIATES', // Method creates new Class()

  // Decorator Edges
  DECORATED_WITH = 'DECORATED_WITH', // Class/Method decorated with Decorator

  // Documentation Edges
  DOCUMENTED_BY = 'DOCUMENTED_BY', // Code documented by JSDoc
}

/**
 * Semantic Node Types (Framework-specific interpretations of AST nodes)
 * These are derived by analyzing the core AST nodes + decorators + patterns
 */
export enum SemanticNodeType {
  // NestJS Framework Types
  NEST_MODULE = 'NestModule', // ClassDeclaration + @Module
  NEST_CONTROLLER = 'NestController', // ClassDeclaration + @Controller
  NEST_SERVICE = 'NestService', // ClassDeclaration + @Injectable (service pattern)
  NEST_GUARD = 'NestGuard', // ClassDeclaration + @Injectable + CanActivate
  NEST_PIPE = 'NestPipe', // ClassDeclaration + @Injectable + PipeTransform
  NEST_INTERCEPTOR = 'NestInterceptor', // ClassDeclaration + @Injectable + NestInterceptor
  NEST_FILTER = 'NestFilter', // ClassDeclaration + @Catch
  NEST_PROVIDER = 'NestProvider', // ClassDeclaration + @Injectable (generic)

  // HTTP & API Types
  HTTP_ENDPOINT = 'HttpEndpoint', // MethodDeclaration + @Get/@Post/etc

  // Data Types
  DTO_CLASS = 'DTOClass', // ClassDeclaration in *.dto.ts
  ENTITY_CLASS = 'EntityClass', // ClassDeclaration + @Entity
  VALUE_OBJECT = 'ValueObject', // ClassDeclaration (domain pattern)

  // Configuration
  CONFIG_CLASS = 'ConfigClass', // ClassDeclaration + validation decorators

  // Testing
  TEST_CLASS = 'TestClass', // ClassDeclaration in *.spec.ts
  TEST_METHOD = 'TestMethod', // MethodDeclaration + describe/it/test
}

/**
 * Semantic Edge Types (Framework-specific interpretations of core edges)
 */
export enum SemanticEdgeType {
  // NestJS Module System
  MODULE_IMPORTS = 'MODULE_IMPORTS', // Module imports Module
  MODULE_PROVIDES = 'MODULE_PROVIDES', // Module provides Service
  MODULE_EXPORTS = 'MODULE_EXPORTS', // Module exports Provider
  MODULE_DECLARES = 'MODULE_DECLARES', // Module declares Controller

  // Dependency Injection
  INJECTS = 'INJECTS', // Controller injects Service
  PROVIDED_BY = 'PROVIDED_BY', // Service provided by Module

  // HTTP API Edges
  EXPOSES = 'EXPOSES', // Controller exposes Endpoint
  ACCEPTS = 'ACCEPTS', // Endpoint accepts DTO
  RESPONDS_WITH = 'RESPONDS_WITH', // Endpoint responds with DTO

  // Security & Middleware
  GUARDED_BY = 'GUARDED_BY', // Endpoint guarded by Guard
  TRANSFORMED_BY = 'TRANSFORMED_BY', // Endpoint uses Pipe
  INTERCEPTED_BY = 'INTERCEPTED_BY', // Endpoint uses Interceptor

  // Domain Logic
  MANAGES = 'MANAGES', // Service manages Entity
  AGGREGATES = 'AGGREGATES', // Service aggregates multiple Entities
  VALIDATES = 'VALIDATES', // DTO validates Input

  // Testing Edges
  TESTS = 'TESTS', // TestClass tests ProductionClass
  MOCKS = 'MOCKS', // Test mocks Service
}

// ============================================================================
// CORE PROPERTY INTERFACES
// ============================================================================

/**
 * Base properties that all nodes should have
 */
export interface BaseNodeProperties {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  sourceCode?: string;
  createdAt: string;
}

/**
 * Core AST Node Properties
 */
export interface SourceFileProperties extends BaseNodeProperties {
  extension: string;
  relativePath: string;
  nxProject?: string;
  isTestFile: boolean;
  isDeclarationFile: boolean;
  moduleKind: 'ES6' | 'CommonJS' | 'AMD' | 'UMD' | 'None';
  importCount: number;
  exportCount: number;
  declarationCount: number;
}

export interface ClassDeclarationProperties extends BaseNodeProperties {
  isAbstract: boolean;
  isExported: boolean;
  isDefaultExport: boolean;
  extendsClause?: string;
  implementsClauses: string[];
  decoratorNames: string[];
  methodCount: number;
  propertyCount: number;
  constructorParameterCount: number;
  visibility: 'public' | 'private' | 'protected' | 'none';
}

export interface MethodDeclarationProperties extends BaseNodeProperties {
  isStatic: boolean;
  isAsync: boolean;
  isAbstract: boolean;
  visibility: 'public' | 'private' | 'protected';
  returnType: string;
  parameterCount: number;
  decoratorNames: string[];
  isGetter: boolean;
  isSetter: boolean;
  overloadCount: number;
}

export interface PropertyDeclarationProperties extends BaseNodeProperties {
  isStatic: boolean;
  isReadonly: boolean;
  visibility: 'public' | 'private' | 'protected';
  type: string;
  hasInitializer: boolean;
  decoratorNames: string[];
  isOptional: boolean;
}

export interface ParameterDeclarationProperties extends BaseNodeProperties {
  type: string;
  isOptional: boolean;
  isRestParameter: boolean;
  hasDefaultValue: boolean;
  decoratorNames: string[];
  parameterIndex: number;
}

export interface InterfaceDeclarationProperties extends BaseNodeProperties {
  isExported: boolean;
  extendsClause: string[];
  memberCount: number;
  isGeneric: boolean;
  typeParameters: string[];
}

export interface FunctionDeclarationProperties extends BaseNodeProperties {
  isAsync: boolean;
  isExported: boolean;
  isDefaultExport: boolean;
  returnType: string;
  parameterCount: number;
  overloadCount: number;
}

export interface ImportDeclarationProperties extends BaseNodeProperties {
  moduleSpecifier: string;
  isTypeOnly: boolean;
  importKind: 'named' | 'default' | 'namespace' | 'side-effect';
  namedImports: string[];
  defaultImport?: string;
  namespaceImport?: string;
}

export interface DecoratorProperties extends BaseNodeProperties {
  decoratorName: string;
  arguments: string[];
  target: 'class' | 'method' | 'property' | 'parameter';
  targetName: string;
}

// ============================================================================
// FRAMEWORK-SPECIFIC PROPERTY INTERFACES (Extensions of Core)
// ============================================================================

/**
 * NestJS-specific Properties (extend core interfaces)
 */
export interface NestModuleProperties extends ClassDeclarationProperties {
  isGlobal: boolean;
  isDynamic: boolean;
  imports: string[];
  providers: string[];
  controllers: string[];
  exports: string[];
  decoratorArguments: Record<string, any>;
}

export interface NestControllerProperties extends ClassDeclarationProperties {
  basePath: string;
  version?: string;
  endpointCount: number;
  hasGlobalGuards: boolean;
  hasGlobalPipes: boolean;
  hasGlobalInterceptors: boolean;
}

export interface NestServiceProperties extends ClassDeclarationProperties {
  scope: 'DEFAULT' | 'REQUEST' | 'TRANSIENT';
  isAsync: boolean;
  dependencyCount: number;
  injectionToken?: string;
}

export interface HttpEndpointProperties extends MethodDeclarationProperties {
  httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  path: string;
  fullPath: string;
  statusCode?: number;
  hasAuth: boolean;
  hasValidation: boolean;
  requestDtoType?: string;
  responseDtoType?: string;
  guardNames: string[];
  pipeNames: string[];
  interceptorNames: string[];
}

export interface DTOClassProperties extends ClassDeclarationProperties {
  validationDecorators: string[];
  isRequestDto: boolean;
  isResponseDto: boolean;
  isPartialDto: boolean;
  baseClass?: string;
}

// ============================================================================
// EDGE PROPERTIES
// ============================================================================

/**
 * Base properties that all relationships should have
 */
export interface BaseRelationshipProperties {
  id: string;
  createdAt: string;
  weight?: number;
}

/**
 * Neo4j-compatible edge properties
 */
export interface Neo4jEdgeProperties extends BaseRelationshipProperties {
  // Core classification
  coreType: CoreEdgeType; // AST-level type
  semanticType: SemanticEdgeType; // Semantic interpretations (as array property)

  // Context and confidence
  confidence: number; // How confident we are (0-1)
  source: 'ast' | 'decorator' | 'pattern' | 'inference';

  // Common properties
  filePath: string; // Where this relationship was found
  lineNumber?: number; // Specific line if applicable

  // Type-specific properties (union of all possible properties)

  // For IMPORTS relationships
  importType?: 'named' | 'default' | 'namespace' | 'side-effect';
  importedSymbols?: string[];
  isTypeOnly?: boolean;
  moduleSpecifier?: string;
  resolvedPath?: string;

  // For INJECTS relationships
  injectionType?: 'constructor' | 'property' | 'setter';
  parameterIndex?: number;
  isOptional?: boolean;
  injectionToken?: string;
  scope?: 'DEFAULT' | 'REQUEST' | 'TRANSIENT';

  // For EXPOSES relationships (HTTP endpoints)
  httpMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  path?: string;
  fullPath?: string;
  statusCode?: number;
  isAsync?: boolean;
  middlewareCount?: number;

  // For CALLS relationships
  callType?: 'direct' | 'indirect' | 'async' | 'conditional';
  frequency?: number;
  arguments?: string[];
  isConditional?: boolean;

  // For DECORATED_WITH relationships
  decoratorName?: string;
  decoratorArguments?: any[];
  target?: 'class' | 'method' | 'property' | 'parameter';
  position?: number;

  // For GUARDED_BY relationships
  guardType?: string;
  isGlobal?: boolean;
  conditions?: string[];
  priority?: number;

  // For ACCEPTS relationships
  parameterType?: 'body' | 'query' | 'param' | 'header';
  validationRules?: string[];
  transformationType?: string;

  // For inheritance relationships
  overriddenMethods?: string[];
  addedMethods?: string[];

  // Generic metadata
  metadata?: Record<string, any>;
}

// ============================================================================
// GRAPH STRUCTURES
// ============================================================================

/**
 * Neo4j-Compatible Edge Structure
 */
export interface CodeGraphEdge {
  id: string; // Unique edge identifier

  // Single relationship type for Neo4j (primary type)
  relationshipType: string; // 'INJECTS', 'CALLS', 'CONTAINS', etc.

  // Direction (explicit for clarity)
  direction: 'OUTGOING' | 'INCOMING' | 'BIDIRECTIONAL';

  // Source and target
  sourceNodeId: string;
  targetNodeId: string;

  // Rich properties that include semantic info
  properties: Neo4jEdgeProperties;

  // Metadata
  createdAt: Date;
  updatedAt?: Date;
}

/**
 * Graph Node Structure
 */
export interface CodeGraphNode {
  // Core AST info
  coreType: CoreNodeType;

  // Semantic interpretation (may be multiple)
  semanticType: SemanticNodeType;

  // Neo4j labels (combination of core + semantic + custom)
  labels: string[];

  // Properties (type depends on node type)
  properties: BaseNodeProperties;
}

export interface CodeGraph {
  nodes: Map<string, CodeGraphNode>;
  edges: Map<string, CodeGraphEdge>;
  metadata: {
    created: Date;
    lastUpdated: Date;
    sourceFiles: string[];
    nxProjects: string[];
    totalNodes: number;
    totalEdges: number;
    nodeTypeCounts: Record<CoreNodeType, number>;
    edgeTypeCounts: Record<CoreEdgeType | SemanticEdgeType, number>;
  };
}

// ============================================================================
// LAYERED SCHEMA SYSTEM
// ============================================================================

export interface PropertyDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'date';
  extraction: {
    method: 'static' | 'ast' | 'decorator' | 'pattern' | 'computed' | 'function';
    source?: string | ((node: any) => any); // ✅ Function OR string support
    defaultValue?: any;
    transformer?: string;
  };
  neo4j: {
    indexed: boolean;
    unique: boolean;
    required: boolean;
  };
  description?: string;
  examples?: any[];
}

// Updated DetectionPattern to support functions
export interface DetectionPattern {
  type: 'decorator' | 'filename' | 'import' | 'classname' | 'function';
  pattern: string | RegExp | ((node: any) => boolean); // ✅ Function support
  confidence: number;
  priority?: number;
}
/**
 * Core TypeScript schema definition (framework-agnostic)
 */
export interface CoreNode {
  coreType: CoreNodeType;
  astNodeKind: number; // ts-morph SyntaxKind
  properties: PropertyDefinition[];
  relationships: CoreEdgeType[]; // Which core relationships this node can have
  neo4j: {
    labels: string[]; // Base Neo4j labels
    primaryLabel: string; // Primary label for indexing
  };
}

export interface CoreEdge {
  coreType: CoreEdgeType;
  sourceTypes: CoreNodeType[]; // Valid source node types
  targetTypes: CoreNodeType[]; // Valid target node types
  properties: PropertyDefinition[];
  neo4j: {
    relationshipType: string;
    direction: 'OUTGOING' | 'INCOMING' | 'BIDIRECTIONAL';
  };
}

export interface CoreTypeScriptSchema {
  name: string;
  version: string;
  description: string;
  nodeTypes: {
    [coreType in CoreNodeType]: CoreNode;
  };
  edgeTypes: {
    [coreType in CoreEdgeType]: CoreEdge;
  };
}

/**
 * Framework enhancement definition
 */
export interface NodeEnhancement {
  name: string;
  targetCoreType: CoreNodeType; // Which core node type this enhances
  semanticType: SemanticNodeType; // What semantic meaning to add
  detectionPatterns: DetectionPattern[]; // How to detect this enhancement
  additionalProperties: PropertyDefinition[]; // Extra properties to add
  additionalRelationships: SemanticEdgeType[]; // Extra relationships this can have
  neo4j: {
    additionalLabels: string[]; // Extra Neo4j labels
    primaryLabel?: string; // Override primary label
  };
  priority: number; // For ordering multiple enhancements
}

export interface EdgeEnhancement {
  name: string;
  semanticType: SemanticEdgeType;
  detectionPattern: string | ((sourceNode: any, targetNode: any) => boolean);
  additionalProperties: PropertyDefinition[];
  neo4j: {
    relationshipType: string;
    direction: 'OUTGOING' | 'INCOMING' | 'BIDIRECTIONAL';
  };
}

export interface FrameworkSchema {
  name: string;
  version: string;
  description: string;
  enhances: CoreNodeType[]; // Which core types this framework enhances
  nodeEnhancements: {
    [enhancementName: string]: NodeEnhancement;
  };
  edgeEnhancements: {
    [enhancementName: string]: EdgeEnhancement;
  };
  metadata: {
    targetLanguages: string[];
    dependencies?: string[]; // Required npm packages
  };
}

// ============================================================================
// COMPLETE FIXED CORE TYPESCRIPT SCHEMA
// ============================================================================

export const CORE_TYPESCRIPT_SCHEMA: CoreTypeScriptSchema = {
  name: 'Core TypeScript Schema',
  version: '1.0.0',
  description: 'Framework-agnostic TypeScript AST parsing schema',

  nodeTypes: {
    [CoreNodeType.SOURCE_FILE]: {
      coreType: CoreNodeType.SOURCE_FILE,
      astNodeKind: 311, // SourceFile
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getBaseName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'filePath',
          type: 'string',
          extraction: { method: 'ast', source: 'getFilePath' },
          neo4j: { indexed: true, unique: true, required: true },
        },
        {
          name: 'extension',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const filePath = node.getFilePath();
              return filePath.substring(filePath.lastIndexOf('.'));
            },
            defaultValue: '.ts',
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'relativePath',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const filePath = node.getFilePath();
              // Extract relative path from full path (simplified)
              const parts = filePath.split('/');
              return parts.slice(-3).join('/'); // Last 3 parts
            },
            defaultValue: '',
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'isTestFile',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const filePath = node.getFilePath();
              return /\.(spec|test)\.ts$/.test(filePath);
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isDeclarationFile',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const filePath = node.getFilePath();
              return filePath.endsWith('.d.ts');
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'moduleKind',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Check for import/export statements to determine module kind
              const imports = node.getImportDeclarations();
              const exports = node.getExportDeclarations();
              if (imports.length > 0 || exports.length > 0) {
                return 'ES6';
              }
              return 'None';
            },
            defaultValue: 'ES6',
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'importCount',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => node.getImportDeclarations().length,
            defaultValue: 0,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'exportCount',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => node.getExportDeclarations().length,
            defaultValue: 0,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'declarationCount',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => {
              return (
                node.getClasses().length +
                node.getInterfaces().length +
                node.getFunctions().length +
                node.getEnums().length
              );
            },
            defaultValue: 0,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
      ],
      relationships: [CoreEdgeType.CONTAINS, CoreEdgeType.IMPORTS, CoreEdgeType.EXPORTS, CoreEdgeType.DECLARES],
      neo4j: {
        labels: ['SourceFile', 'TypeScript'],
        primaryLabel: 'SourceFile',
      },
    },

    [CoreNodeType.CLASS_DECLARATION]: {
      coreType: CoreNodeType.CLASS_DECLARATION,
      astNodeKind: 262, // ClassDeclaration
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isAbstract',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isAbstract', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isExported',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isExported', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isDefaultExport',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isDefaultExport', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'extendsClause',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const baseClass = node.getBaseClass();
              return baseClass ? baseClass.getText() : null;
            },
            defaultValue: null,
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'implementsClauses',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              return node.getImplements().map((impl: any) => impl.getText());
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'decoratorNames',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              return node.getDecorators().map((d: any) => d.getName());
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'methodCount',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => node.getMethods().length,
            defaultValue: 0,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'propertyCount',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => node.getProperties().length,
            defaultValue: 0,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'constructorParameterCount',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const constructors = node.getConstructors();
              return constructors.length > 0 ? constructors[0].getParameters().length : 0;
            },
            defaultValue: 0,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'visibility',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Check for export - simplified visibility
              return node.isExported() ? 'public' : 'none';
            },
            defaultValue: 'none',
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [
        CoreEdgeType.HAS_MEMBER,
        CoreEdgeType.EXTENDS,
        CoreEdgeType.IMPLEMENTS,
        CoreEdgeType.DECORATED_WITH,
      ],
      neo4j: {
        labels: ['Class', 'TypeScript'],
        primaryLabel: 'Class',
      },
    },

    [CoreNodeType.METHOD_DECLARATION]: {
      coreType: CoreNodeType.METHOD_DECLARATION,
      astNodeKind: 172, // MethodDeclaration
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isStatic',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isStatic', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isAsync',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isAsync', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isAbstract',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isAbstract', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'visibility',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Check modifiers for visibility
              const modifiers = node.getModifiers();
              for (const modifier of modifiers) {
                const kind = modifier.getKind();
                if (kind === 123) return 'public'; // SyntaxKind.PublicKeyword
                if (kind === 121) return 'private'; // SyntaxKind.PrivateKeyword
                if (kind === 122) return 'protected'; // SyntaxKind.ProtectedKeyword
              }
              return 'public'; // Default in TypeScript
            },
            defaultValue: 'public',
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'returnType',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const returnTypeNode = node.getReturnTypeNode();
              return returnTypeNode ? returnTypeNode.getText() : 'void';
            },
            defaultValue: 'void',
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'parameterCount',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => node.getParameters().length,
            defaultValue: 0,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'decoratorNames',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              return node.getDecorators().map((d: any) => d.getName());
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'isGetter',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              return node.getKind() === 177; // SyntaxKind.GetAccessor
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isSetter',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              return node.getKind() === 178; // SyntaxKind.SetAccessor
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'overloadCount',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Count method overloads (simplified)
              const parent = node.getParent();
              if (parent?.getMethods) {
                const methods = parent.getMethods();
                const methodName = node.getName();
                return methods.filter((m: any) => m.getName() === methodName).length;
              }
              return 1;
            },
            defaultValue: 1,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
      ],
      relationships: [
        CoreEdgeType.HAS_PARAMETER,
        CoreEdgeType.CALLS,
        CoreEdgeType.RETURNS,
        CoreEdgeType.DECORATED_WITH,
      ],
      neo4j: {
        labels: ['Method', 'TypeScript'],
        primaryLabel: 'Method',
      },
    },

    [CoreNodeType.PROPERTY_DECLARATION]: {
      coreType: CoreNodeType.PROPERTY_DECLARATION,
      astNodeKind: 171, // PropertyDeclaration
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isStatic',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isStatic', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isReadonly',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isReadonly', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'visibility',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const modifiers = node.getModifiers();
              for (const modifier of modifiers) {
                const kind = modifier.getKind();
                if (kind === 123) return 'public';
                if (kind === 121) return 'private';
                if (kind === 122) return 'protected';
              }
              return 'public';
            },
            defaultValue: 'public',
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'type',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const typeNode = node.getTypeNode();
              return typeNode ? typeNode.getText() : 'any';
            },
            defaultValue: 'any',
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'hasInitializer',
          type: 'boolean',
          extraction: { method: 'ast', source: 'hasInitializer', defaultValue: false },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'decoratorNames',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              return node.getDecorators().map((d: any) => d.getName());
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'isOptional',
          type: 'boolean',
          extraction: { method: 'ast', source: 'hasQuestionToken', defaultValue: false },
          neo4j: { indexed: false, unique: false, required: true },
        },
      ],
      relationships: [CoreEdgeType.TYPED_AS, CoreEdgeType.DECORATED_WITH],
      neo4j: {
        labels: ['Property', 'TypeScript'],
        primaryLabel: 'Property',
      },
    },

    [CoreNodeType.PARAMETER_DECLARATION]: {
      coreType: CoreNodeType.PARAMETER_DECLARATION,
      astNodeKind: 169, // Parameter
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'type',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const typeNode = node.getTypeNode();
              return typeNode ? typeNode.getText() : 'any';
            },
            defaultValue: 'any',
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'isOptional',
          type: 'boolean',
          extraction: { method: 'ast', source: 'hasQuestionToken', defaultValue: false },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'isRestParameter',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isRestParameter', defaultValue: false },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'hasDefaultValue',
          type: 'boolean',
          extraction: { method: 'ast', source: 'hasInitializer', defaultValue: false },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'decoratorNames',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              return node.getDecorators().map((d: any) => d.getName());
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'parameterIndex',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => {
              return node.getChildIndex();
            },
            defaultValue: 0,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
      ],
      relationships: [CoreEdgeType.TYPED_AS, CoreEdgeType.DECORATED_WITH],
      neo4j: {
        labels: ['Parameter', 'TypeScript'],
        primaryLabel: 'Parameter',
      },
    },

    [CoreNodeType.INTERFACE_DECLARATION]: {
      coreType: CoreNodeType.INTERFACE_DECLARATION,
      astNodeKind: 263, // InterfaceDeclaration
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isExported',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isExported', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'extendsClause',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              return node.getExtends().map((ext: any) => ext.getText());
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'memberCount',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => node.getMembers().length,
            defaultValue: 0,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'isGeneric',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              return node.getTypeParameters().length > 0;
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'typeParameters',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              return node.getTypeParameters().map((tp: any) => tp.getName());
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
      ],
      relationships: [CoreEdgeType.EXTENDS, CoreEdgeType.HAS_MEMBER],
      neo4j: {
        labels: ['Interface', 'TypeScript'],
        primaryLabel: 'Interface',
      },
    },

    [CoreNodeType.FUNCTION_DECLARATION]: {
      coreType: CoreNodeType.FUNCTION_DECLARATION,
      astNodeKind: 261, // FunctionDeclaration
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isAsync',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isAsync', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isExported',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isExported', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isDefaultExport',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isDefaultExport', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'returnType',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const returnTypeNode = node.getReturnTypeNode();
              return returnTypeNode ? returnTypeNode.getText() : 'void';
            },
            defaultValue: 'void',
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'parameterCount',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => node.getParameters().length,
            defaultValue: 0,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'overloadCount',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Count function overloads (simplified)
              return 1; // TODO: Implement proper overload counting
            },
            defaultValue: 1,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
      ],
      relationships: [CoreEdgeType.HAS_PARAMETER, CoreEdgeType.CALLS, CoreEdgeType.RETURNS],
      neo4j: {
        labels: ['Function', 'TypeScript'],
        primaryLabel: 'Function',
      },
    },

    [CoreNodeType.IMPORT_DECLARATION]: {
      coreType: CoreNodeType.IMPORT_DECLARATION,
      astNodeKind: 272, // ImportDeclaration
      properties: [
        {
          name: 'moduleSpecifier',
          type: 'string',
          extraction: { method: 'ast', source: 'getModuleSpecifierValue' },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isTypeOnly',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isTypeOnly', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'importKind',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              if (node.getDefaultImport()) return 'default';
              if (node.getNamespaceImport()) return 'namespace';
              if (node.getNamedImports().length > 0) return 'named';
              return 'side-effect';
            },
            defaultValue: 'named',
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'namedImports',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              return node.getNamedImports().map((ni: any) => ni.getName());
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'defaultImport',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const defaultImport = node.getDefaultImport();
              return defaultImport ? defaultImport.getText() : null;
            },
            defaultValue: null,
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'namespaceImport',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const namespaceImport = node.getNamespaceImport();
              return namespaceImport ? namespaceImport.getText() : null;
            },
            defaultValue: null,
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
      ],
      relationships: [CoreEdgeType.IMPORTS],
      neo4j: {
        labels: ['Import', 'TypeScript'],
        primaryLabel: 'Import',
      },
    },

    // Remaining node types with proper properties
    [CoreNodeType.NX_PROJECT]: {
      coreType: CoreNodeType.NX_PROJECT,
      astNodeKind: -1, // Not an AST node
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'unknown' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [CoreEdgeType.CONTAINS],
      neo4j: { labels: ['NxProject'], primaryLabel: 'NxProject' },
    },

    [CoreNodeType.ENUM_DECLARATION]: {
      coreType: CoreNodeType.ENUM_DECLARATION,
      astNodeKind: 264,
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isExported',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isExported', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [],
      neo4j: { labels: ['Enum'], primaryLabel: 'Enum' },
    },

    [CoreNodeType.TYPE_ALIAS_DECLARATION]: {
      coreType: CoreNodeType.TYPE_ALIAS_DECLARATION,
      astNodeKind: 265,
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isExported',
          type: 'boolean',
          extraction: { method: 'ast', source: 'isExported', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [],
      neo4j: { labels: ['TypeAlias'], primaryLabel: 'TypeAlias' },
    },

    [CoreNodeType.VARIABLE_DECLARATION]: {
      coreType: CoreNodeType.VARIABLE_DECLARATION,
      astNodeKind: 258,
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [],
      neo4j: { labels: ['Variable'], primaryLabel: 'Variable' },
    },

    [CoreNodeType.CONSTRUCTOR_DECLARATION]: {
      coreType: CoreNodeType.CONSTRUCTOR_DECLARATION,
      astNodeKind: 175,
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'constructor' },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'parameterCount',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => node.getParameters().length,
            defaultValue: 0,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
      ],
      relationships: [CoreEdgeType.HAS_PARAMETER],
      neo4j: { labels: ['Constructor'], primaryLabel: 'Constructor' },
    },

    [CoreNodeType.GET_ACCESSOR_DECLARATION]: {
      coreType: CoreNodeType.GET_ACCESSOR_DECLARATION,
      astNodeKind: 177,
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [],
      neo4j: { labels: ['GetAccessor'], primaryLabel: 'GetAccessor' },
    },

    [CoreNodeType.SET_ACCESSOR_DECLARATION]: {
      coreType: CoreNodeType.SET_ACCESSOR_DECLARATION,
      astNodeKind: 178,
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [],
      neo4j: { labels: ['SetAccessor'], primaryLabel: 'SetAccessor' },
    },

    [CoreNodeType.EXPORT_DECLARATION]: {
      coreType: CoreNodeType.EXPORT_DECLARATION,
      astNodeKind: 273,
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'export' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [],
      neo4j: { labels: ['Export'], primaryLabel: 'Export' },
    },

    [CoreNodeType.EXPORT_ASSIGNMENT]: {
      coreType: CoreNodeType.EXPORT_ASSIGNMENT,
      astNodeKind: 274,
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'exportAssignment' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [],
      neo4j: { labels: ['ExportAssignment'], primaryLabel: 'ExportAssignment' },
    },

    [CoreNodeType.DECORATOR]: {
      coreType: CoreNodeType.DECORATOR,
      astNodeKind: 170,
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'arguments',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              return node.getArguments().map((arg: any) => arg.getText());
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
      ],
      relationships: [],
      neo4j: { labels: ['Decorator'], primaryLabel: 'Decorator' },
    },

    [CoreNodeType.JS_DOC_COMMENT]: {
      coreType: CoreNodeType.JS_DOC_COMMENT,
      astNodeKind: 323,
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'jsdoc' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [],
      neo4j: { labels: ['JSDoc'], primaryLabel: 'JSDoc' },
    },

    [CoreNodeType.CALL_EXPRESSION]: {
      coreType: CoreNodeType.CALL_EXPRESSION,
      astNodeKind: 211,
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'call' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [],
      neo4j: { labels: ['CallExpression'], primaryLabel: 'CallExpression' },
    },

    [CoreNodeType.NEW_EXPRESSION]: {
      coreType: CoreNodeType.NEW_EXPRESSION,
      astNodeKind: 212,
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'new' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [],
      neo4j: { labels: ['NewExpression'], primaryLabel: 'NewExpression' },
    },
  },

  edgeTypes: {
    [CoreEdgeType.CONTAINS]: {
      coreType: CoreEdgeType.CONTAINS,
      sourceTypes: [CoreNodeType.SOURCE_FILE, CoreNodeType.CLASS_DECLARATION],
      targetTypes: [
        CoreNodeType.CLASS_DECLARATION,
        CoreNodeType.INTERFACE_DECLARATION,
        CoreNodeType.FUNCTION_DECLARATION,
      ],
      properties: [],
      neo4j: {
        relationshipType: 'CONTAINS',
        direction: 'OUTGOING',
      },
    },
    [CoreEdgeType.DECLARES]: {
      coreType: CoreEdgeType.DECLARES,
      sourceTypes: [CoreNodeType.SOURCE_FILE],
      targetTypes: [
        CoreNodeType.CLASS_DECLARATION,
        CoreNodeType.INTERFACE_DECLARATION,
        CoreNodeType.FUNCTION_DECLARATION,
        CoreNodeType.ENUM_DECLARATION,
      ],
      properties: [],
      neo4j: { relationshipType: 'DECLARES', direction: 'OUTGOING' },
    },
    [CoreEdgeType.HAS_MEMBER]: {
      coreType: CoreEdgeType.HAS_MEMBER,
      sourceTypes: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.INTERFACE_DECLARATION],
      targetTypes: [CoreNodeType.METHOD_DECLARATION, CoreNodeType.PROPERTY_DECLARATION],
      properties: [],
      neo4j: {
        relationshipType: 'HAS_MEMBER',
        direction: 'OUTGOING',
      },
    },
    [CoreEdgeType.HAS_PARAMETER]: {
      coreType: CoreEdgeType.HAS_PARAMETER,
      sourceTypes: [
        CoreNodeType.METHOD_DECLARATION,
        CoreNodeType.FUNCTION_DECLARATION,
        CoreNodeType.CONSTRUCTOR_DECLARATION,
      ],
      targetTypes: [CoreNodeType.PARAMETER_DECLARATION],
      properties: [],
      neo4j: {
        relationshipType: 'HAS_PARAMETER',
        direction: 'OUTGOING',
      },
    },
    [CoreEdgeType.IMPORTS]: {
      coreType: CoreEdgeType.IMPORTS,
      sourceTypes: [CoreNodeType.SOURCE_FILE],
      targetTypes: [CoreNodeType.SOURCE_FILE],
      properties: [],
      neo4j: { relationshipType: 'IMPORTS', direction: 'OUTGOING' },
    },
    [CoreEdgeType.EXPORTS]: {
      coreType: CoreEdgeType.EXPORTS,
      sourceTypes: [CoreNodeType.SOURCE_FILE],
      targetTypes: [
        CoreNodeType.CLASS_DECLARATION,
        CoreNodeType.INTERFACE_DECLARATION,
        CoreNodeType.FUNCTION_DECLARATION,
      ],
      properties: [],
      neo4j: { relationshipType: 'EXPORTS', direction: 'OUTGOING' },
    },
    [CoreEdgeType.REFERENCES]: {
      coreType: CoreEdgeType.REFERENCES,
      sourceTypes: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.METHOD_DECLARATION],
      targetTypes: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.INTERFACE_DECLARATION],
      properties: [],
      neo4j: { relationshipType: 'REFERENCES', direction: 'OUTGOING' },
    },
    [CoreEdgeType.EXTENDS]: {
      coreType: CoreEdgeType.EXTENDS,
      sourceTypes: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.INTERFACE_DECLARATION],
      targetTypes: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.INTERFACE_DECLARATION],
      properties: [],
      neo4j: { relationshipType: 'EXTENDS', direction: 'OUTGOING' },
    },
    [CoreEdgeType.IMPLEMENTS]: {
      coreType: CoreEdgeType.IMPLEMENTS,
      sourceTypes: [CoreNodeType.CLASS_DECLARATION],
      targetTypes: [CoreNodeType.INTERFACE_DECLARATION],
      properties: [],
      neo4j: { relationshipType: 'IMPLEMENTS', direction: 'OUTGOING' },
    },
    [CoreEdgeType.TYPED_AS]: {
      coreType: CoreEdgeType.TYPED_AS,
      sourceTypes: [CoreNodeType.PARAMETER_DECLARATION, CoreNodeType.PROPERTY_DECLARATION],
      targetTypes: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.INTERFACE_DECLARATION],
      properties: [],
      neo4j: { relationshipType: 'TYPED_AS', direction: 'OUTGOING' },
    },
    [CoreEdgeType.RETURNS]: {
      coreType: CoreEdgeType.RETURNS,
      sourceTypes: [CoreNodeType.METHOD_DECLARATION, CoreNodeType.FUNCTION_DECLARATION],
      targetTypes: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.INTERFACE_DECLARATION],
      properties: [],
      neo4j: { relationshipType: 'RETURNS', direction: 'OUTGOING' },
    },
    [CoreEdgeType.CALLS]: {
      coreType: CoreEdgeType.CALLS,
      sourceTypes: [CoreNodeType.METHOD_DECLARATION, CoreNodeType.FUNCTION_DECLARATION],
      targetTypes: [CoreNodeType.METHOD_DECLARATION, CoreNodeType.FUNCTION_DECLARATION],
      properties: [],
      neo4j: { relationshipType: 'CALLS', direction: 'OUTGOING' },
    },
    [CoreEdgeType.INSTANTIATES]: {
      coreType: CoreEdgeType.INSTANTIATES,
      sourceTypes: [CoreNodeType.METHOD_DECLARATION, CoreNodeType.FUNCTION_DECLARATION],
      targetTypes: [CoreNodeType.CLASS_DECLARATION],
      properties: [],
      neo4j: { relationshipType: 'INSTANTIATES', direction: 'OUTGOING' },
    },
    [CoreEdgeType.DECORATED_WITH]: {
      coreType: CoreEdgeType.DECORATED_WITH,
      sourceTypes: [
        CoreNodeType.CLASS_DECLARATION,
        CoreNodeType.METHOD_DECLARATION,
        CoreNodeType.PROPERTY_DECLARATION,
        CoreNodeType.PARAMETER_DECLARATION,
      ],
      targetTypes: [CoreNodeType.DECORATOR],
      properties: [],
      neo4j: { relationshipType: 'DECORATED_WITH', direction: 'OUTGOING' },
    },
    [CoreEdgeType.DOCUMENTED_BY]: {
      coreType: CoreEdgeType.DOCUMENTED_BY,
      sourceTypes: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.METHOD_DECLARATION, CoreNodeType.PROPERTY_DECLARATION],
      targetTypes: [CoreNodeType.JS_DOC_COMMENT],
      properties: [],
      neo4j: { relationshipType: 'DOCUMENTED_BY', direction: 'OUTGOING' },
    },
  },
};

// ============================================================================
// REVIEWED AND CORRECTED NESTJS FRAMEWORK SCHEMA
// ============================================================================

export const NESTJS_FRAMEWORK_SCHEMA: FrameworkSchema = {
  name: 'NestJS Framework Schema',
  version: '1.0.0',
  description: 'NestJS-specific enhancements using function-based extraction',
  enhances: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.METHOD_DECLARATION, CoreNodeType.PARAMETER_DECLARATION],

  nodeEnhancements: {
    NestController: {
      name: 'NestController',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.NEST_CONTROLLER,
      detectionPatterns: [
        {
          type: 'decorator',
          pattern: 'Controller',
          confidence: 0.95,
          priority: 10,
        },
        {
          type: 'filename',
          pattern: /\.controller\.ts$/,
          confidence: 0.7,
          priority: 5,
        },
      ],
      additionalProperties: [
        {
          name: 'basePath',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract path from @Controller('path')
              if (!node.getDecorators) return '';
              const decorators = node.getDecorators();
              const controller = decorators.find((d: any) => d.getName() === 'Controller');
              if (!controller) return '';
              const args = controller.getArguments();
              return args.length > 0 ? args[0].getText().replace(/['"]/g, '') : '';
            },
            defaultValue: '',
          },
          neo4j: { indexed: true, unique: false, required: false },
        },
        {
          name: 'version',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract API version from @Version('v1')
              if (!node.getDecorators) return null;
              const decorators = node.getDecorators();
              const version = decorators.find((d: any) => d.getName() === 'Version');
              if (!version) return null;
              const args = version.getArguments();
              return args.length > 0 ? args[0].getText().replace(/['"]/g, '') : null;
            },
            defaultValue: null,
          },
          neo4j: { indexed: true, unique: false, required: false },
        },
        {
          name: 'endpointCount',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Count HTTP method decorators
              if (!node.getMethods) return 0;
              const methods = node.getMethods();
              const httpDecorators = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Head', 'Options'];
              return methods.filter((method: any) => {
                if (!method.getDecorators) return false;
                const decorators = method.getDecorators();
                return decorators.some((d: any) => httpDecorators.includes(d.getName()));
              }).length;
            },
            defaultValue: 0,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'hasGlobalGuards',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Check for @UseGuards at class level
              if (!node.getDecorators) return false;
              const decorators = node.getDecorators();
              return decorators.some((d: any) => d.getName() === 'UseGuards');
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'hasGlobalPipes',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Check for @UsePipes at class level
              if (!node.getDecorators) return false;
              const decorators = node.getDecorators();
              return decorators.some((d: any) => d.getName() === 'UsePipes');
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'hasGlobalInterceptors',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Check for @UseInterceptors at class level
              if (!node.getDecorators) return false;
              const decorators = node.getDecorators();
              return decorators.some((d: any) => d.getName() === 'UseInterceptors');
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      additionalRelationships: [SemanticEdgeType.EXPOSES, SemanticEdgeType.INJECTS],
      neo4j: {
        additionalLabels: ['NestController', 'NestJS'],
        primaryLabel: 'NestController',
      },
      priority: 90,
    },

    NestService: {
      name: 'NestService',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.NEST_SERVICE,
      detectionPatterns: [
        {
          type: 'function',
          pattern: (node: any) => {
            if (!node.getName) return false;
            const className = node.getName();
            return className?.endsWith('Service');
          },
          confidence: 0.9,
          priority: 8,
        },
        {
          type: 'filename',
          pattern: /\.service\.ts$/,
          confidence: 0.9,
          priority: 9,
        },
      ],
      additionalProperties: [
        {
          name: 'scope',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Parse @Injectable({scope: Scope.REQUEST})
              if (!node.getDecorators) return 'DEFAULT';
              const decorators = node.getDecorators();
              const injectable = decorators.find((d: any) => d.getName() === 'Injectable');
              if (!injectable) return 'DEFAULT';

              const args = injectable.getArguments();
              if (args.length === 0) return 'DEFAULT';

              const argText = args[0].getText();
              if (argText.includes('REQUEST')) return 'REQUEST';
              if (argText.includes('TRANSIENT')) return 'TRANSIENT';
              return 'DEFAULT';
            },
            defaultValue: 'DEFAULT',
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isAsync',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Check if service has async methods
              if (!node.getMethods) return false;
              const methods = node.getMethods();
              return methods.some((method: any) => method.isAsync?.());
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'dependencyCount',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Count constructor parameters (dependencies)
              if (!node.getConstructors) return 0;
              const constructors = node.getConstructors();
              if (constructors.length === 0) return 0;
              return constructors[0].getParameters().length;
            },
            defaultValue: 0,
          },
          neo4j: { indexed: false, unique: false, required: true },
        },
        {
          name: 'injectionToken',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract custom injection token from @Injectable('CUSTOM_TOKEN')
              if (!node.getDecorators) return null;
              const decorators = node.getDecorators();
              const injectable = decorators.find((d: any) => d.getName() === 'Injectable');
              if (!injectable) return null;

              const args = injectable.getArguments();
              // Look for string token as first argument
              if (args.length > 0 && args[0].getText().startsWith("'")) {
                return args[0].getText().replace(/['"]/g, '');
              }
              return null;
            },
            defaultValue: null,
          },
          neo4j: { indexed: true, unique: false, required: false },
        },
      ],
      additionalRelationships: [SemanticEdgeType.PROVIDED_BY, SemanticEdgeType.MANAGES],
      neo4j: {
        additionalLabels: ['NestService', 'NestJS'],
        primaryLabel: 'NestService',
      },
      priority: 80,
    },

    NestGuard: {
      name: 'NestGuard',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.NEST_GUARD,
      detectionPatterns: [
        {
          type: 'decorator',
          pattern: 'Injectable',
          confidence: 0.6,
          priority: 6,
        },
        {
          type: 'filename',
          pattern: /\.guard\.ts$/,
          confidence: 0.9,
          priority: 8,
        },
        {
          type: 'function',
          pattern: (node: any) => {
            // Check if class implements CanActivate interface
            if (!node.getImplements) return false;
            const implement = node.getImplements();
            return implement.some((impl: any) => impl.getText().includes('CanActivate'));
          },
          confidence: 0.95,
          priority: 10,
        },
      ],
      additionalProperties: [],
      additionalRelationships: [],
      neo4j: {
        additionalLabels: ['NestGuard', 'NestJS'],
        primaryLabel: 'NestGuard',
      },
      priority: 70,
    },

    NestPipe: {
      name: 'NestPipe',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.NEST_PIPE,
      detectionPatterns: [
        {
          type: 'decorator',
          pattern: 'Injectable',
          confidence: 0.6,
          priority: 6,
        },
        {
          type: 'filename',
          pattern: /\.pipe\.ts$/,
          confidence: 0.9,
          priority: 8,
        },
        {
          type: 'function',
          pattern: (node: any) => {
            // Check if class implements PipeTransform interface
            if (!node.getImplements) return false;
            const implement = node.getImplements();
            return implement.some((impl: any) => impl.getText().includes('PipeTransform'));
          },
          confidence: 0.95,
          priority: 10,
        },
      ],
      additionalProperties: [],
      additionalRelationships: [],
      neo4j: {
        additionalLabels: ['NestPipe', 'NestJS'],
        primaryLabel: 'NestPipe',
      },
      priority: 70,
    },

    NestInterceptor: {
      name: 'NestInterceptor',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.NEST_INTERCEPTOR,
      detectionPatterns: [
        {
          type: 'decorator',
          pattern: 'Injectable',
          confidence: 0.6,
          priority: 6,
        },
        {
          type: 'filename',
          pattern: /\.interceptor\.ts$/,
          confidence: 0.9,
          priority: 8,
        },
        {
          type: 'function',
          pattern: (node: any) => {
            // Check if class implements NestInterceptor interface
            if (!node.getImplements) return false;
            const implement = node.getImplements();
            return implement.some((impl: any) => impl.getText().includes('NestInterceptor'));
          },
          confidence: 0.95,
          priority: 10,
        },
      ],
      additionalProperties: [],
      additionalRelationships: [],
      neo4j: {
        additionalLabels: ['NestInterceptor', 'NestJS'],
        primaryLabel: 'NestInterceptor',
      },
      priority: 70,
    },

    NestFilter: {
      name: 'NestFilter',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.NEST_FILTER,
      detectionPatterns: [
        {
          type: 'decorator',
          pattern: 'Catch',
          confidence: 0.95,
          priority: 10,
        },
        {
          type: 'filename',
          pattern: /\.filter\.ts$/,
          confidence: 0.8,
          priority: 7,
        },
      ],
      additionalProperties: [],
      additionalRelationships: [],
      neo4j: {
        additionalLabels: ['NestFilter', 'NestJS'],
        primaryLabel: 'NestFilter',
      },
      priority: 70,
    },

    NestProvider: {
      name: 'NestProvider',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.NEST_PROVIDER,
      detectionPatterns: [
        {
          type: 'decorator',
          pattern: 'Injectable',
          confidence: 0.5,
          priority: 1,
        },
      ],
      additionalProperties: [],
      additionalRelationships: [],
      neo4j: {
        additionalLabels: ['NestProvider', 'NestJS'],
        primaryLabel: 'NestProvider',
      },
      priority: 10, // Lowest priority - catch-all for @Injectable
    },

    NestModule: {
      name: 'NestModule',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.NEST_MODULE,
      detectionPatterns: [
        {
          type: 'decorator',
          pattern: 'Module',
          confidence: 0.95,
          priority: 10,
        },
        {
          type: 'filename',
          pattern: /\.module\.ts$/,
          confidence: 0.8,
          priority: 7,
        },
      ],
      additionalProperties: [
        {
          name: 'isGlobal',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Check for @Global() decorator
              if (!node.getDecorators) return false;
              const decorators = node.getDecorators();
              return decorators.some((d: any) => d.getName() === 'Global');
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isDynamic',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Check if module has static methods like forRoot, forFeature
              if (!node.getMethods) return false;
              const methods = node.getMethods();
              const dynamicMethods = ['forRoot', 'forFeature', 'forRootAsync', 'forFeatureAsync'];
              return methods.some((method: any) => {
                return method.isStatic?.() && dynamicMethods.includes(method.getName());
              });
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'imports',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract imports from @Module({imports: [...]})
              if (!node.getDecorators) return [];
              const decorators = node.getDecorators();
              const module = decorators.find((d: any) => d.getName() === 'Module');
              if (!module) return [];

              const args = module.getArguments();
              if (args.length === 0) return [];

              const configText = args[0].getText();
              const importsMatch = configText.match(/imports\s*:\s*\[([^\]]+)\]/);
              if (!importsMatch) return [];

              return importsMatch[1]
                .split(',')
                .map((item: string) => item.trim().replace(/['"]/g, ''))
                .filter((item: string) => item.length > 0);
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'providers',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract providers from @Module({providers: [...]})
              if (!node.getDecorators) return [];
              const decorators = node.getDecorators();
              const module = decorators.find((d: any) => d.getName() === 'Module');
              if (!module) return [];

              const args = module.getArguments();
              if (args.length === 0) return [];

              const configText = args[0].getText();
              const providersMatch = configText.match(/providers\s*:\s*\[([^\]]+)\]/);
              if (!providersMatch) return [];

              return providersMatch[1]
                .split(',')
                .map((item: string) => item.trim().replace(/['"]/g, ''))
                .filter((item: string) => item.length > 0);
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'controllers',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract controllers from @Module({controllers: [...]})
              if (!node.getDecorators) return [];
              const decorators = node.getDecorators();
              const module = decorators.find((d: any) => d.getName() === 'Module');
              if (!module) return [];

              const args = module.getArguments();
              if (args.length === 0) return [];

              const configText = args[0].getText();
              const controllersMatch = configText.match(/controllers\s*:\s*\[([^\]]+)\]/);
              if (!controllersMatch) return [];

              return controllersMatch[1]
                .split(',')
                .map((item: string) => item.trim().replace(/['"]/g, ''))
                .filter((item: string) => item.length > 0);
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'exports',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract exports from @Module({exports: [...]})
              if (!node.getDecorators) return [];
              const decorators = node.getDecorators();
              const module = decorators.find((d: any) => d.getName() === 'Module');
              if (!module) return [];

              const args = module.getArguments();
              if (args.length === 0) return [];

              const configText = args[0].getText();
              const exportsMatch = configText.match(/exports\s*:\s*\[([^\]]+)\]/);
              if (!exportsMatch) return [];

              return exportsMatch[1]
                .split(',')
                .map((item: string) => item.trim().replace(/['"]/g, ''))
                .filter((item: string) => item.length > 0);
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
      ],
      additionalRelationships: [
        SemanticEdgeType.MODULE_IMPORTS,
        SemanticEdgeType.MODULE_PROVIDES,
        SemanticEdgeType.MODULE_DECLARES,
      ],
      neo4j: {
        additionalLabels: ['NestModule', 'NestJS'],
        primaryLabel: 'NestModule',
      },
      priority: 95,
    },

    HttpEndpoint: {
      name: 'HttpEndpoint',
      targetCoreType: CoreNodeType.METHOD_DECLARATION,
      semanticType: SemanticNodeType.HTTP_ENDPOINT,
      detectionPatterns: [
        {
          type: 'function',
          pattern: (node: any) => {
            // Custom detection for HTTP endpoints
            if (!node.getDecorators) return false;
            const decorators = node.getDecorators();
            const httpDecorators = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Head', 'Options'];
            return decorators.some((d: any) => httpDecorators.includes(d.getName()));
          },
          confidence: 0.98,
          priority: 15,
        },
      ],
      additionalProperties: [
        {
          name: 'httpMethod',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract HTTP method from decorator
              if (!node.getDecorators) return '';
              const decorators = node.getDecorators();
              const httpDecorators = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Head', 'Options'];
              const httpDecorator = decorators.find((d: any) => httpDecorators.includes(d.getName()));
              return httpDecorator ? httpDecorator.getName().toUpperCase() : '';
            },
            defaultValue: '',
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'path',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract route path from @Get('path')
              if (!node.getDecorators) return '';
              const decorators = node.getDecorators();
              const httpDecorators = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Head', 'Options'];
              const httpDecorator = decorators.find((d: any) => httpDecorators.includes(d.getName()));
              if (!httpDecorator) return '';

              const args = httpDecorator.getArguments();
              return args.length > 0 ? args[0].getText().replace(/['"]/g, '') : '';
            },
            defaultValue: '',
          },
          neo4j: { indexed: true, unique: false, required: false },
        },
        {
          name: 'fullPath',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Combine controller base path with method path
              // This would need access to parent controller - simplified for now
              if (!node.getDecorators) return '';
              const decorators = node.getDecorators();
              const httpDecorators = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Head', 'Options'];
              const httpDecorator = decorators.find((d: any) => httpDecorators.includes(d.getName()));
              if (!httpDecorator) return '';

              const args = httpDecorator.getArguments();
              const methodPath = args.length > 0 ? args[0].getText().replace(/['"]/g, '') : '';

              // TODO: Would need to traverse up to controller to get base path
              return methodPath;
            },
            defaultValue: '',
          },
          neo4j: { indexed: true, unique: false, required: false },
        },
        {
          name: 'statusCode',
          type: 'number',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract status code from @HttpCode(201)
              if (!node.getDecorators) return null;
              const decorators = node.getDecorators();
              const httpCode = decorators.find((d: any) => d.getName() === 'HttpCode');
              if (!httpCode) return null;

              const args = httpCode.getArguments();
              if (args.length > 0) {
                const statusText = args[0].getText();
                const status = parseInt(statusText);
                return isNaN(status) ? null : status;
              }
              return null;
            },
            defaultValue: null,
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'hasAuth',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Check for auth decorators
              if (!node.getDecorators) return false;
              const decorators = node.getDecorators();
              const authDecorators = ['UseGuards', 'Auth', 'Roles', 'Public'];
              return decorators.some((d: any) => authDecorators.includes(d.getName()));
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'hasValidation',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Check for validation decorators
              if (!node.getDecorators) return false;
              const decorators = node.getDecorators();
              const validationDecorators = ['UsePipes', 'ValidationPipe'];
              return decorators.some((d: any) => validationDecorators.includes(d.getName()));
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'guardNames',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract guard names
              if (!node.getDecorators) return [];
              const decorators = node.getDecorators();
              const useGuards = decorators.find((d: any) => d.getName() === 'UseGuards');
              if (!useGuards) return [];

              const args = useGuards.getArguments();
              return args
                .map((arg: any) => arg.getText().replace(/[(),]/g, '').trim())
                .filter((name: string) => name.length > 0);
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'pipeNames',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract pipe names
              if (!node.getDecorators) return [];
              const decorators = node.getDecorators();
              const usePipes = decorators.find((d: any) => d.getName() === 'UsePipes');
              if (!usePipes) return [];

              const args = usePipes.getArguments();
              return args
                .map((arg: any) => arg.getText().replace(/[(),]/g, '').trim())
                .filter((name: string) => name.length > 0);
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'interceptorNames',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract interceptor names
              if (!node.getDecorators) return [];
              const decorators = node.getDecorators();
              const useInterceptors = decorators.find((d: any) => d.getName() === 'UseInterceptors');
              if (!useInterceptors) return [];

              const args = useInterceptors.getArguments();
              return args
                .map((arg: any) => arg.getText().replace(/[(),]/g, '').trim())
                .filter((name: string) => name.length > 0);
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
      ],
      additionalRelationships: [SemanticEdgeType.ACCEPTS, SemanticEdgeType.RESPONDS_WITH, SemanticEdgeType.GUARDED_BY],
      neo4j: {
        additionalLabels: ['HttpEndpoint', 'NestJS'],
        primaryLabel: 'HttpEndpoint',
      },
      priority: 85,
    },

    DTOClass: {
      name: 'DTOClass',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.DTO_CLASS,
      detectionPatterns: [
        {
          type: 'filename',
          pattern: /\.dto\.ts$/,
          confidence: 0.9,
          priority: 8,
        },
        {
          type: 'classname',
          pattern: /.*Dto$/,
          confidence: 0.7,
          priority: 6,
        },
      ],
      additionalProperties: [
        {
          name: 'validationDecorators',
          type: 'array',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract validation decorators from properties
              if (!node.getProperties) return [];
              const properties = node.getProperties();
              const validationDecorators: string[] = [];

              properties.forEach((prop: any) => {
                if (!prop.getDecorators) return;
                const decorators = prop.getDecorators();
                decorators.forEach((decorator: any) => {
                  const name = decorator.getName();
                  const commonValidators = [
                    'IsString',
                    'IsNumber',
                    'IsEmail',
                    'IsOptional',
                    'IsNotEmpty',
                    'MinLength',
                    'MaxLength',
                    'IsArray',
                    'IsBoolean',
                    'IsDate',
                    'IsEnum',
                    'IsUUID',
                    'IsUrl',
                    'Min',
                    'Max',
                    'Matches',
                    'IsIn',
                    'IsNotIn',
                    'IsDefined',
                    'ValidateNested',
                  ];
                  if (commonValidators.includes(name)) {
                    validationDecorators.push(name);
                  }
                });
              });

              return [...new Set(validationDecorators)]; // Remove duplicates
            },
            defaultValue: [],
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
        {
          name: 'isRequestDto',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const name = node.getName() || '';
              return name.toLowerCase().includes('request');
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isResponseDto',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              const name = node.getName() || '';
              return name.toLowerCase().includes('response');
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'isPartialDto',
          type: 'boolean',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Check if DTO extends PartialType
              if (!node.getBaseClass) return false;
              const baseClass = node.getBaseClass();
              return baseClass ? baseClass.getText().includes('PartialType') : false;
            },
            defaultValue: false,
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'baseClass',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract base class name
              if (!node.getBaseClass) return null;
              const baseClass = node.getBaseClass();
              return baseClass ? baseClass.getText() : null;
            },
            defaultValue: null,
          },
          neo4j: { indexed: false, unique: false, required: false },
        },
      ],
      additionalRelationships: [SemanticEdgeType.VALIDATES],
      neo4j: {
        additionalLabels: ['DTO', 'NestJS'],
        primaryLabel: 'DTO',
      },
      priority: 70,
    },

    EntityClass: {
      name: 'EntityClass',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.ENTITY_CLASS,
      detectionPatterns: [
        {
          type: 'decorator',
          pattern: 'Entity',
          confidence: 0.95,
          priority: 10,
        },
        {
          type: 'filename',
          pattern: /\.entity\.ts$/,
          confidence: 0.8,
          priority: 7,
        },
      ],
      additionalProperties: [
        {
          name: 'tableName',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => {
              // Extract table name from @Entity('table_name')
              if (!node.getDecorators) return null;
              const decorators = node.getDecorators();
              const entity = decorators.find((d: any) => d.getName() === 'Entity');
              if (!entity) return null;

              const args = entity.getArguments();
              return args.length > 0 ? args[0].getText().replace(/['"]/g, '') : null;
            },
            defaultValue: null,
          },
          neo4j: { indexed: true, unique: false, required: false },
        },
      ],
      additionalRelationships: [],
      neo4j: {
        additionalLabels: ['Entity', 'NestJS'],
        primaryLabel: 'Entity',
      },
      priority: 80,
    },

    ConfigClass: {
      name: 'ConfigClass',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.CONFIG_CLASS,
      detectionPatterns: [
        {
          type: 'filename',
          pattern: /\.config\.ts$/,
          confidence: 0.8,
          priority: 7,
        },
        {
          type: 'classname',
          pattern: /.*Config$/,
          confidence: 0.7,
          priority: 6,
        },
      ],
      additionalProperties: [],
      additionalRelationships: [],
      neo4j: {
        additionalLabels: ['Config', 'NestJS'],
        primaryLabel: 'Config',
      },
      priority: 60,
    },

    TestClass: {
      name: 'TestClass',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.TEST_CLASS,
      detectionPatterns: [
        {
          type: 'filename',
          pattern: /\.spec\.ts$/,
          confidence: 0.9,
          priority: 8,
        },
        {
          type: 'filename',
          pattern: /\.test\.ts$/,
          confidence: 0.9,
          priority: 8,
        },
      ],
      additionalProperties: [],
      additionalRelationships: [SemanticEdgeType.TESTS],
      neo4j: {
        additionalLabels: ['Test', 'NestJS'],
        primaryLabel: 'Test',
      },
      priority: 50,
    },
  },

  edgeEnhancements: {
    DependencyInjection: {
      name: 'DependencyInjection',
      semanticType: SemanticEdgeType.INJECTS,
      detectionPattern: (sourceNode: any, targetNode: any) => {
        // Only check between classes
        if (sourceNode.coreType !== CoreNodeType.CLASS_DECLARATION) return false;
        if (targetNode.coreType !== CoreNodeType.CLASS_DECLARATION) return false;

        if (!sourceNode.sourceNode?.getConstructors) return false;
        const constructors = sourceNode.sourceNode.getConstructors();
        if (constructors.length === 0) return false;

        const constructor = constructors[0];
        const parameters = constructor.getParameters();
        const targetName = targetNode.properties?.name;

        return parameters.some((param: any) => {
          const paramType = param.getTypeNode()?.getText();

          // Type 1: Direct type match
          // constructor(private userService: UserService)
          if (paramType === targetName) return true;

          // Type 2: Token-based injection
          // constructor(@Inject('USER_SERVICE') private service: any)
          const decorators = param.getDecorators();
          for (const decorator of decorators) {
            if (decorator.getName() === 'Inject') {
              const args = decorator.getArguments();
              if (args.length > 0) {
                const token = args[0].getText().replace(/['"]/g, '');

                // Token matches class name directly
                if (token === targetName) return true;

                // Convert snake_case token to ClassName
                // 'USER_SERVICE' -> 'UserService'
                const tokenToClassName = token
                  .split('_')
                  .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
                  .join('');
                if (tokenToClassName === targetName) return true;
              }
            }
          }

          return false;
        });
      },
      additionalProperties: [
        {
          name: 'injectionToken',
          type: 'string',
          extraction: {
            method: 'function',
            source: (context: any) => {
              // Extract token if token-based injection
              const { sourceNode, targetNode } = context;
              if (!sourceNode.sourceNode?.getConstructors) return null;

              const constructors = sourceNode.sourceNode.getConstructors();
              if (constructors.length === 0) return null;

              const constructor = constructors[0];
              const parameters = constructor.getParameters();

              for (const param of parameters) {
                const decorators = param.getDecorators();
                for (const decorator of decorators) {
                  if (decorator.getName() === 'Inject') {
                    const args = decorator.getArguments();
                    if (args.length > 0) {
                      return args[0].getText().replace(/['"]/g, '');
                    }
                  }
                }
              }

              return null; // Type-based injection, no token
            },
            defaultValue: null,
          },
          neo4j: { indexed: true, unique: false, required: false },
        },
      ],
      neo4j: {
        relationshipType: 'INJECTS',
        direction: 'OUTGOING',
      },
    },
    HttpEndpointExposure: {
      name: 'HttpEndpointExposure',
      semanticType: SemanticEdgeType.EXPOSES,
      detectionPattern: (sourceNode: any, targetNode: any) => {
        // Controller exposes HTTP endpoint
        return (
          sourceNode.semanticType === SemanticNodeType.NEST_CONTROLLER &&
          targetNode.semanticType === SemanticNodeType.HTTP_ENDPOINT
        );
      },
      additionalProperties: [
        {
          name: 'httpMethod',
          type: 'string',
          extraction: {
            method: 'function',
            source: (context: any) => {
              const { targetNode } = context;
              return targetNode.properties?.httpMethod || '';
            },
            defaultValue: '',
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'fullPath',
          type: 'string',
          extraction: {
            method: 'function',
            source: (context: any) => {
              const { sourceNode, targetNode } = context;
              const basePath = sourceNode.properties?.basePath ?? '';
              const methodPath = targetNode.properties?.path ?? '';
              return `${basePath}/${methodPath}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
            },
            defaultValue: '',
          },
          neo4j: { indexed: true, unique: false, required: false },
        },
      ],
      neo4j: {
        relationshipType: 'EXPOSES',
        direction: 'OUTGOING',
      },
    },

    HttpEndpointGuardedBy: {
      name: 'HttpEndpointGuardedBy',
      semanticType: SemanticEdgeType.GUARDED_BY,
      detectionPattern: (sourceNode: any, targetNode: any) => {
        return (
          sourceNode.semanticType === SemanticNodeType.HTTP_ENDPOINT &&
          targetNode.semanticType === SemanticNodeType.NEST_GUARD
        );
      },
      additionalProperties: [],
      neo4j: {
        relationshipType: 'GUARDED_BY',
        direction: 'OUTGOING',
      },
    },

    HttpEndpointInterceptedBy: {
      name: 'HttpEndpointInterceptedBy',
      semanticType: SemanticEdgeType.INTERCEPTED_BY,
      detectionPattern: (sourceNode: any, targetNode: any) => {
        return (
          sourceNode.semanticType === SemanticNodeType.HTTP_ENDPOINT &&
          targetNode.semanticType === SemanticNodeType.NEST_INTERCEPTOR
        );
      },
      additionalProperties: [],
      neo4j: {
        relationshipType: 'INTERCEPTED_BY',
        direction: 'OUTGOING',
      },
    },
  },

  metadata: {
    targetLanguages: ['typescript'],
    dependencies: ['@nestjs/core', '@nestjs/common'],
  },
};

// ============================================================================
// PARSING CONFIGURATION (Simplified)
// ============================================================================

export interface ParseOptions {
  files?: string[]; // Specific files to parse
  directories?: string[]; // Directories to scan
  includePatterns?: string[]; // File patterns to include
  excludePatterns?: string[]; // File patterns to exclude
  maxFiles?: number; // Limit number of files
  coreSchema?: CoreTypeScriptSchema; // Override core schema
  frameworkSchemas?: FrameworkSchema[]; // Framework enhancements to apply
}

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
  includePatterns: ['**/*.ts', '**/*.tsx'],
  excludePatterns: ['node_modules/', 'dist/', 'coverage/', '.d.ts', '.spec.ts', '.test.ts'],
  maxFiles: 1000,
  coreSchema: CORE_TYPESCRIPT_SCHEMA,
  frameworkSchemas: [],
};

export const NESTJS_PARSE_OPTIONS: ParseOptions = {
  ...DEFAULT_PARSE_OPTIONS,
  frameworkSchemas: [NESTJS_FRAMEWORK_SCHEMA],
};
