/* eslint-disable @typescript-eslint/no-explicit-any */
// graph.ts - Optimized for Neo4j performance with context-based framework properties

import { EXCLUDE_PATTERNS_REGEX } from '../../constants.js';

// ============================================================================
// CORE ENUMS
// ============================================================================

/**
 * Core TypeScript AST Node Types (from ts-morph)
 */
export enum CoreNodeType {
  // File System & Workspace
  SOURCE_FILE = 'SourceFile',

  // Core TypeScript AST Declarations
  CLASS_DECLARATION = 'ClassDeclaration',
  INTERFACE_DECLARATION = 'InterfaceDeclaration',
  ENUM_DECLARATION = 'EnumDeclaration',
  FUNCTION_DECLARATION = 'FunctionDeclaration',
  VARIABLE_DECLARATION = 'VariableDeclaration',

  // Class Members
  METHOD_DECLARATION = 'MethodDeclaration',
  PROPERTY_DECLARATION = 'PropertyDeclaration',
  CONSTRUCTOR_DECLARATION = 'ConstructorDeclaration',
  PARAMETER_DECLARATION = 'ParameterDeclaration',

  // Import/Export System
  IMPORT_DECLARATION = 'ImportDeclaration',
  EXPORT_DECLARATION = 'ExportDeclaration',

  // Decorators
  DECORATOR = 'Decorator',
}

/**
 * Core Edge Types (AST relationships)
 */
export enum CoreEdgeType {
  // File Structure
  CONTAINS = 'CONTAINS',

  // Import/Export
  IMPORTS = 'IMPORTS',
  EXPORTS = 'EXPORTS',

  // Type System
  EXTENDS = 'EXTENDS',
  IMPLEMENTS = 'IMPLEMENTS',
  TYPED_AS = 'TYPED_AS',

  // Code Structure
  HAS_MEMBER = 'HAS_MEMBER',
  HAS_PARAMETER = 'HAS_PARAMETER',
  CALLS = 'CALLS',

  // Decorator
  DECORATED_WITH = 'DECORATED_WITH',
}

/**
 * Semantic Node Types (Framework interpretations)
 */
export enum SemanticNodeType {
  // NestJS Framework Types
  NEST_MODULE = 'NestModule',
  NEST_CONTROLLER = 'NestController',
  NEST_SERVICE = 'NestService',
  NEST_GUARD = 'NestGuard',
  NEST_PIPE = 'NestPipe',
  NEST_INTERCEPTOR = 'NestInterceptor',
  NEST_FILTER = 'NestFilter',
  NEST_PROVIDER = 'NestProvider',

  // HTTP & API Types
  HTTP_ENDPOINT = 'HttpEndpoint',
  MESSAGE_HANDLER = 'MessageHandler',

  // Data Types
  DTO_CLASS = 'DTOClass',
  ENTITY_CLASS = 'EntityClass',
  CONFIG_CLASS = 'ConfigClass',

  // Testing
  TEST_CLASS = 'TestClass',
}

/**
 * Semantic Edge Types (Framework relationships)
 */
export enum SemanticEdgeType {
  // NestJS Module System
  MODULE_IMPORTS = 'MODULE_IMPORTS',
  MODULE_PROVIDES = 'MODULE_PROVIDES',
  MODULE_EXPORTS = 'MODULE_EXPORTS',

  // Dependency Injection
  INJECTS = 'INJECTS',
  PROVIDED_BY = 'PROVIDED_BY',

  // HTTP API
  EXPOSES = 'EXPOSES',
  ACCEPTS = 'ACCEPTS',
  RESPONDS_WITH = 'RESPONDS_WITH',
  CONSUMES_MESSAGE = 'CONSUMES_MESSAGE',

  // Security & Middleware
  GUARDED_BY = 'GUARDED_BY',
  TRANSFORMED_BY = 'TRANSFORMED_BY',
  INTERCEPTED_BY = 'INTERCEPTED_BY',

  // Domain Logic
  MANAGES = 'MANAGES',
  VALIDATES = 'VALIDATES',

  // Testing
  TESTS = 'TESTS',
}

// ============================================================================
// OPTIMIZED NEO4J PROPERTIES
// ============================================================================

/**
 * Streamlined Node Properties - Only essential + frequently queried fields
 */
export interface Neo4jNodeProperties {
  // === ALWAYS INDEXED ===
  id: string;
  name: string;
  coreType: CoreNodeType;
  semanticType?: string; // Can be SemanticNodeType or framework-specific semantic type

  // === FREQUENTLY INDEXED ===
  filePath: string;
  isExported?: boolean;
  visibility?: 'public' | 'private' | 'protected';

  // === CORE METADATA ===
  startLine: number;
  endLine: number;
  sourceCode: string;
  createdAt: string;
  contentHash?: string;
  mtime?: number;
  size?: number;

  // === FRAMEWORK-SPECIFIC (Dynamic) ===
  context?: Record<string, any>;
}

/**
 * Streamlined Edge Properties - Core relationship info + dynamic context
 */
export interface Neo4jEdgeProperties {
  // === ALWAYS INDEXED ===
  coreType: CoreEdgeType;
  semanticType?: string; // Can be SemanticEdgeType or framework-specific edge type

  // === FREQUENTLY INDEXED ===
  source: 'ast' | 'decorator' | 'pattern' | 'inference';
  confidence: number;

  // === TRAVERSAL SCORING ===
  /**
   * Weight for traversal prioritization (0.0 - 1.0)
   * Higher weights indicate more important relationships to follow
   * Used in combination with query relevance and depth penalty
   */
  relationshipWeight: number;

  // === CORE METADATA ===
  filePath: string;
  createdAt: string;
  lineNumber?: number;

  // === FRAMEWORK-SPECIFIC (Dynamic) ===
  context?: Record<string, any>;
}

// ============================================================================
// NEO4J GRAPH STRUCTURES
// ============================================================================

/**
 * Neo4j Node Structure
 */
export interface Neo4jNode {
  id: string;
  labels: string[]; // Neo4j labels
  properties: Neo4jNodeProperties;
  skipEmbedding?: boolean;
}

/**
 * Neo4j Edge Structure
 */
export interface Neo4jEdge {
  id: string;
  type: string; // Neo4j relationship type
  startNodeId: string;
  endNodeId: string;
  properties: Neo4jEdgeProperties;
}

/**
 * Complete Graph Structure
 */
export interface CodeGraph {
  nodes: Map<string, Neo4jNode>;
  edges: Map<string, Neo4jEdge>;
  metadata: {
    created: Date;
    totalNodes: number;
    totalEdges: number;
    sourceFiles: string[];
  };
}

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

/**
 * Property Definition with Context Support
 */
export interface PropertyDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'date';
  extraction: {
    method: 'static' | 'ast' | 'function' | 'context';
    source?: string | ((node: any) => any);
    defaultValue?: any;
    contextKey?: string; // For context-based extraction
  };
  neo4j: {
    indexed: boolean;
    unique: boolean;
    required: boolean;
  };
}

/**
 * Detection Pattern for Framework Enhancement
 */
export interface DetectionPattern {
  type: 'decorator' | 'filename' | 'import' | 'classname' | 'function';
  pattern: string | RegExp | ((parsedNode: ParsedNode) => boolean);
  confidence: number;
  priority: number;
}

/**
 * Parsing Context - Shared state across all parsing phases
 * Simple map for custom data that can be shared between extractors and enhancements
 * e.g., store vendorClients: Map<string, ParsedNode> by project name
 */
export type ParsingContext = Map<string, any>;

/**
 * Parsed node representation (after parsing, not the raw AST node)
 * This is the structure stored in the parser's parsedNodes map
 */
export interface ParsedNode {
  id: string;
  coreType: CoreNodeType;
  semanticType?: string; // Can be SemanticNodeType or framework-specific semantic type
  labels: string[];
  properties: Neo4jNodeProperties;
  sourceNode?: any; // The original ts-morph AST Node
  skipEmbedding?: boolean;
}

/**
 * Context Extractor for Framework-Specific Properties
 * Receives the parsed node, all parsed nodes, and shared context
 * Access the AST node via parsedNode.sourceNode if needed
 */
export interface ContextExtractor {
  nodeType: CoreNodeType;
  edgeType?: CoreEdgeType;
  semanticType?: SemanticNodeType;
  extractor: (
    parsedNode: ParsedNode,
    allParsedNodes: Map<string, ParsedNode>,
    sharedContext: ParsingContext,
    edge?: any,
  ) => Record<string, any>;
  priority: number;
}

/**
 * Relationship Extractor Definition
 * Maps an edge type to the AST method that extracts the related node(s)
 */
export interface RelationshipExtractor {
  edgeType: CoreEdgeType;
  /**
   * AST method name to call on the source node
   * - For single node: 'getBaseClass', 'getReturnTypeNode'
   * - For array of nodes: 'getImplements', 'getTypeArguments'
   */
  method: string;
  /**
   * Whether the method returns a single node or an array
   * - 'single': Method returns one node (e.g., getBaseClass)
   * - 'array': Method returns array of nodes (e.g., getImplements)
   */
  cardinality: 'single' | 'array';
  /**
   * The target node type to create/link to
   * Used to find existing nodes or create new ones
   */
  targetNodeType: CoreNodeType;
}

/**
 * Core Schema Node Definition
 */
export interface CoreNode {
  coreType: CoreNodeType;
  astNodeKind: number;
  astGetter: string; // Method name to call on parent AST node (e.g., 'getMethods', 'getProperties')
  properties: PropertyDefinition[];

  /**
   * Relationship extractors - defines how to find related nodes and create edges
   * Unlike 'children' which handles containment, these handle references to other nodes
   * Example: Class EXTENDS BaseClass, Class IMPLEMENTS Interface
   */
  relationships?: RelationshipExtractor[];

  // Children map - defines what child nodes to parse and what edge to create
  // Key: Child CoreNodeType, Value: Edge type to create between parent and child
  children?: Partial<Record<CoreNodeType, CoreEdgeType>>;

  neo4j: {
    labels: string[];
    primaryLabel: string;
    indexed: string[]; // Which properties to index
    skipEmbedding?: boolean; // Skip embedding for this node type
  };
}

/**
 * Core Schema Edge Definition
 */
export interface CoreEdge {
  coreType: CoreEdgeType;
  sourceTypes: CoreNodeType[];
  targetTypes: CoreNodeType[];
  properties: PropertyDefinition[];
  /**
   * Default traversal weight for this core edge type (0.0 - 1.0)
   * Can be overridden by framework-specific edge enhancements
   */
  relationshipWeight: number;
  neo4j: {
    relationshipType: string;
    direction: 'OUTGOING' | 'INCOMING' | 'BIDIRECTIONAL';
  };
}

/**
 * Core TypeScript Schema
 */
export interface CoreTypeScriptSchema {
  name: string;
  version: string;

  // AST getter map - single source of truth for how to get each node type from parent
  astGetters: Partial<Record<CoreNodeType, string>>;

  nodeTypes: Record<CoreNodeType, CoreNode>;
  edgeTypes: Record<CoreEdgeType, CoreEdge>;
}

/**
 * Framework Enhancement Definition
 */
export interface FrameworkEnhancement {
  name: string;
  targetCoreType: CoreNodeType;
  semanticType: string; // Can be SemanticNodeType or framework-specific semantic type
  detectionPatterns: DetectionPattern[];
  contextExtractors: ContextExtractor[];
  additionalRelationships: string[]; // Can be SemanticEdgeType or framework-specific edge type
  neo4j: {
    additionalLabels: string[];
    primaryLabel?: string;
  };
  priority: number;
}

/**
 * Edge Enhancement Definition
 */
export interface EdgeEnhancement {
  name: string;
  semanticType: string; // Can be SemanticEdgeType or framework-specific edge type
  /**
   * Traversal weight for this relationship type (0.0 - 1.0)
   * Higher weights = more important to follow during traversal
   *
   * Weight tiers:
   * - Critical (0.9-1.0): Primary architectural relationships (INJECTS, EXPOSES)
   * - High (0.7-0.8): Important semantic relationships (GUARDED_BY, MODULE_IMPORTS)
   * - Medium (0.5-0.6): Supporting relationships (VALIDATES, TRANSFORMS)
   * - Low (0.3-0.4): Structural relationships (CONTAINS, DECORATED_WITH)
   */
  relationshipWeight: number;
  detectionPattern: (
    parsedSourceNode: ParsedNode,
    parsedTargetNode: ParsedNode,
    allParsedNodes: Map<string, ParsedNode>,
    sharedContext: ParsingContext,
  ) => boolean;
  contextExtractor?: (
    parsedSourceNode: ParsedNode,
    parsedTargetNode: ParsedNode,
    allParsedNodes: Map<string, ParsedNode>,
    sharedContext: ParsingContext,
  ) => Record<string, any>;
  neo4j: {
    relationshipType: string;
    direction: 'OUTGOING' | 'INCOMING' | 'BIDIRECTIONAL';
  };
}

/**
 * Framework Schema Definition
 */
export interface FrameworkSchema {
  name: string;
  version: string;
  description: string;
  enhances: CoreNodeType[];
  enhancements: Record<string, FrameworkEnhancement>;
  edgeEnhancements: Record<string, EdgeEnhancement>;
  contextExtractors: ContextExtractor[];
  metadata: {
    targetLanguages: string[];
    dependencies?: string[];
    parseVariablesFrom?: string[]; // Glob patterns for files to parse variable declarations from
  };
}

// ============================================================================
// CORE TYPESCRIPT SCHEMA
// ============================================================================

export const CORE_TYPESCRIPT_SCHEMA: CoreTypeScriptSchema = {
  name: 'Core TypeScript Schema',
  version: '2.0.0',

  // AST Getters Map - single source of truth
  astGetters: {
    [CoreNodeType.SOURCE_FILE]: 'self', // Special case - entry point
    [CoreNodeType.CLASS_DECLARATION]: 'getClasses',
    [CoreNodeType.METHOD_DECLARATION]: 'getMethods',
    [CoreNodeType.PROPERTY_DECLARATION]: 'getProperties',
    [CoreNodeType.PARAMETER_DECLARATION]: 'getParameters',
    [CoreNodeType.DECORATOR]: 'getDecorators',
    [CoreNodeType.INTERFACE_DECLARATION]: 'getInterfaces',
    [CoreNodeType.FUNCTION_DECLARATION]: 'getFunctions',
    [CoreNodeType.IMPORT_DECLARATION]: 'getImportDeclarations',
    [CoreNodeType.VARIABLE_DECLARATION]: 'getDeclarations', // Called on VariableStatement
    [CoreNodeType.ENUM_DECLARATION]: 'getEnums',
    [CoreNodeType.CONSTRUCTOR_DECLARATION]: 'getConstructors',
    [CoreNodeType.EXPORT_DECLARATION]: 'getExportDeclarations',
  },

  nodeTypes: {
    [CoreNodeType.SOURCE_FILE]: {
      coreType: CoreNodeType.SOURCE_FILE,
      astNodeKind: 311,
      astGetter: 'self',
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
          name: 'isExported',
          type: 'boolean',
          extraction: { method: 'static', defaultValue: false },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [], // SourceFile doesn't have reference relationships, only containment
      children: {
        [CoreNodeType.CLASS_DECLARATION]: CoreEdgeType.CONTAINS,
        [CoreNodeType.INTERFACE_DECLARATION]: CoreEdgeType.CONTAINS,
        [CoreNodeType.FUNCTION_DECLARATION]: CoreEdgeType.CONTAINS,
        [CoreNodeType.IMPORT_DECLARATION]: CoreEdgeType.CONTAINS,
        [CoreNodeType.ENUM_DECLARATION]: CoreEdgeType.CONTAINS,
      },
      neo4j: {
        labels: ['SourceFile', 'TypeScript'],
        primaryLabel: 'SourceFile',
        indexed: ['name', 'filePath', 'isExported'],
        skipEmbedding: true,
      },
    },

    [CoreNodeType.CLASS_DECLARATION]: {
      coreType: CoreNodeType.CLASS_DECLARATION,
      astNodeKind: 262,
      astGetter: 'getClasses',
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
          name: 'visibility',
          type: 'string',
          extraction: {
            method: 'function',
            source: (node: any) => (node.isExported() ? 'public' : 'none'),
            defaultValue: 'none',
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [
        {
          edgeType: CoreEdgeType.EXTENDS,
          method: 'getBaseClass',
          cardinality: 'single',
          targetNodeType: CoreNodeType.CLASS_DECLARATION,
        },
        {
          edgeType: CoreEdgeType.IMPLEMENTS,
          method: 'getImplements',
          cardinality: 'array',
          targetNodeType: CoreNodeType.INTERFACE_DECLARATION,
        },
      ],
      children: {
        [CoreNodeType.METHOD_DECLARATION]: CoreEdgeType.HAS_MEMBER,
        [CoreNodeType.PROPERTY_DECLARATION]: CoreEdgeType.HAS_MEMBER,
        [CoreNodeType.CONSTRUCTOR_DECLARATION]: CoreEdgeType.HAS_MEMBER,
        [CoreNodeType.DECORATOR]: CoreEdgeType.DECORATED_WITH,
      },
      neo4j: {
        labels: ['Class', 'TypeScript'],
        primaryLabel: 'Class',
        indexed: ['name', 'isExported', 'visibility'],
      },
    },

    [CoreNodeType.METHOD_DECLARATION]: {
      coreType: CoreNodeType.METHOD_DECLARATION,
      astNodeKind: 172,
      astGetter: 'getMethods',
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
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
                if (kind === 125) return 'public';
                if (kind === 123) return 'private';
                if (kind === 124) return 'protected';
              }
              return 'public';
            },
            defaultValue: 'public',
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [], // CALLS would need call-site analysis, not implemented yet
      children: {
        [CoreNodeType.PARAMETER_DECLARATION]: CoreEdgeType.HAS_PARAMETER,
        [CoreNodeType.DECORATOR]: CoreEdgeType.DECORATED_WITH,
      },
      neo4j: {
        labels: ['Method', 'TypeScript'],
        primaryLabel: 'Method',
        indexed: ['name', 'visibility'],
      },
    },

    [CoreNodeType.PROPERTY_DECLARATION]: {
      coreType: CoreNodeType.PROPERTY_DECLARATION,
      astNodeKind: 171,
      astGetter: 'getProperties',
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
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
                if (kind === 125) return 'public';
                if (kind === 123) return 'private';
                if (kind === 124) return 'protected';
              }
              return 'public';
            },
            defaultValue: 'public',
          },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [], // TYPED_AS would need type resolution, not implemented yet
      children: {
        [CoreNodeType.DECORATOR]: CoreEdgeType.DECORATED_WITH,
      },
      neo4j: {
        labels: ['Property', 'TypeScript'],
        primaryLabel: 'Property',
        indexed: ['name', 'visibility'],
        skipEmbedding: true,
      },
    },

    [CoreNodeType.PARAMETER_DECLARATION]: {
      coreType: CoreNodeType.PARAMETER_DECLARATION,
      astNodeKind: 169,
      astGetter: 'getParameters',
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [], // TYPED_AS would need type resolution, not implemented yet
      children: {
        [CoreNodeType.DECORATOR]: CoreEdgeType.DECORATED_WITH,
      },
      neo4j: {
        labels: ['Parameter', 'TypeScript'],
        primaryLabel: 'Parameter',
        indexed: ['name'],
        skipEmbedding: true,
      },
    },

    [CoreNodeType.IMPORT_DECLARATION]: {
      coreType: CoreNodeType.IMPORT_DECLARATION,
      astNodeKind: 272,
      astGetter: 'getImportDeclarations',
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getModuleSpecifierValue' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [], // IMPORTS to SourceFile would need module resolution
      children: {},
      neo4j: {
        labels: ['Import', 'TypeScript'],
        primaryLabel: 'Import',
        indexed: ['name'],
        skipEmbedding: true,
      },
    },

    [CoreNodeType.DECORATOR]: {
      coreType: CoreNodeType.DECORATOR,
      astNodeKind: 170,
      astGetter: 'getDecorators',
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [],
      children: {},
      neo4j: {
        labels: ['Decorator'],
        primaryLabel: 'Decorator',
        indexed: ['name'],
        skipEmbedding: true,
      },
    },

    [CoreNodeType.INTERFACE_DECLARATION]: {
      coreType: CoreNodeType.INTERFACE_DECLARATION,
      astNodeKind: 263,
      astGetter: 'getInterfaces',
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
      relationships: [
        {
          edgeType: CoreEdgeType.EXTENDS,
          method: 'getExtends',
          cardinality: 'array',
          targetNodeType: CoreNodeType.INTERFACE_DECLARATION,
        },
      ],
      children: {},
      neo4j: {
        labels: ['Interface', 'TypeScript'],
        primaryLabel: 'Interface',
        indexed: ['name', 'isExported'],
      },
    },

    [CoreNodeType.ENUM_DECLARATION]: {
      coreType: CoreNodeType.ENUM_DECLARATION,
      astNodeKind: 264,
      astGetter: 'getEnums',
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
      children: {},
      neo4j: {
        labels: ['Enum', 'TypeScript'],
        primaryLabel: 'Enum',
        indexed: ['name', 'isExported'],
        skipEmbedding: true,
      },
    },

    [CoreNodeType.FUNCTION_DECLARATION]: {
      coreType: CoreNodeType.FUNCTION_DECLARATION,
      astNodeKind: 261,
      astGetter: 'getFunctions',
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
      relationships: [], // CALLS would need call-site analysis, not implemented yet
      children: {
        [CoreNodeType.PARAMETER_DECLARATION]: CoreEdgeType.HAS_PARAMETER,
      },
      neo4j: {
        labels: ['Function', 'TypeScript'],
        primaryLabel: 'Function',
        indexed: ['name', 'isExported'],
      },
    },

    [CoreNodeType.VARIABLE_DECLARATION]: {
      coreType: CoreNodeType.VARIABLE_DECLARATION,
      astNodeKind: 258,
      astGetter: 'getDeclarations',
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [],
      children: {},
      neo4j: {
        labels: ['Variable', 'TypeScript'],
        primaryLabel: 'Variable',
        indexed: ['name'],
        skipEmbedding: true,
      },
    },

    [CoreNodeType.CONSTRUCTOR_DECLARATION]: {
      coreType: CoreNodeType.CONSTRUCTOR_DECLARATION,
      astNodeKind: 175,
      astGetter: 'getConstructors',
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'constructor' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [], // Parameters are handled via children, not relationship extractors
      children: {
        [CoreNodeType.PARAMETER_DECLARATION]: CoreEdgeType.HAS_PARAMETER,
      },
      neo4j: {
        labels: ['Constructor', 'TypeScript'],
        primaryLabel: 'Constructor',
        indexed: ['name'],
        skipEmbedding: true,
      },
    },

    [CoreNodeType.EXPORT_DECLARATION]: {
      coreType: CoreNodeType.EXPORT_DECLARATION,
      astNodeKind: 273,
      astGetter: 'getExportDeclarations',
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'export' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [],
      children: {},
      neo4j: {
        labels: ['Export', 'TypeScript'],
        primaryLabel: 'Export',
        indexed: ['name'],
        skipEmbedding: true,
      },
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
        CoreNodeType.METHOD_DECLARATION,
        CoreNodeType.PROPERTY_DECLARATION,
      ],
      properties: [
        {
          name: 'confidence',
          type: 'number',
          extraction: { method: 'static', defaultValue: 1.0 },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'source',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'ast' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationshipWeight: 0.4, // Structural - useful but not primary focus
      neo4j: {
        relationshipType: 'CONTAINS',
        direction: 'OUTGOING',
      },
    },

    [CoreEdgeType.HAS_MEMBER]: {
      coreType: CoreEdgeType.HAS_MEMBER,
      sourceTypes: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.INTERFACE_DECLARATION],
      targetTypes: [
        CoreNodeType.METHOD_DECLARATION,
        CoreNodeType.PROPERTY_DECLARATION,
        CoreNodeType.CONSTRUCTOR_DECLARATION,
      ],
      properties: [
        {
          name: 'confidence',
          type: 'number',
          extraction: { method: 'static', defaultValue: 1.0 },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'source',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'ast' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationshipWeight: 0.6, // Medium - important for understanding class structure
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
      properties: [
        {
          name: 'confidence',
          type: 'number',
          extraction: { method: 'static', defaultValue: 1.0 },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'source',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'ast' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationshipWeight: 0.35, // Low - rarely primary traversal target
      neo4j: {
        relationshipType: 'HAS_PARAMETER',
        direction: 'OUTGOING',
      },
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
      properties: [
        {
          name: 'confidence',
          type: 'number',
          extraction: { method: 'static', defaultValue: 1.0 },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'source',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'ast' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationshipWeight: 0.3, // Low - metadata, not code flow
      neo4j: {
        relationshipType: 'DECORATED_WITH',
        direction: 'OUTGOING',
      },
    },

    [CoreEdgeType.IMPORTS]: {
      coreType: CoreEdgeType.IMPORTS,
      sourceTypes: [CoreNodeType.SOURCE_FILE],
      targetTypes: [CoreNodeType.SOURCE_FILE],
      properties: [
        {
          name: 'confidence',
          type: 'number',
          extraction: { method: 'static', defaultValue: 1.0 },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'source',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'ast' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationshipWeight: 0.55, // Medium - useful for dependency tracing
      neo4j: {
        relationshipType: 'IMPORTS',
        direction: 'OUTGOING',
      },
    },

    [CoreEdgeType.EXPORTS]: {
      coreType: CoreEdgeType.EXPORTS,
      sourceTypes: [CoreNodeType.SOURCE_FILE],
      targetTypes: [
        CoreNodeType.CLASS_DECLARATION,
        CoreNodeType.INTERFACE_DECLARATION,
        CoreNodeType.FUNCTION_DECLARATION,
      ],
      properties: [
        {
          name: 'confidence',
          type: 'number',
          extraction: { method: 'static', defaultValue: 1.0 },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'source',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'ast' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationshipWeight: 0.5, // Medium - public API surface
      neo4j: {
        relationshipType: 'EXPORTS',
        direction: 'OUTGOING',
      },
    },

    [CoreEdgeType.EXTENDS]: {
      coreType: CoreEdgeType.EXTENDS,
      sourceTypes: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.INTERFACE_DECLARATION],
      targetTypes: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.INTERFACE_DECLARATION],
      properties: [
        {
          name: 'confidence',
          type: 'number',
          extraction: { method: 'static', defaultValue: 1.0 },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'source',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'ast' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationshipWeight: 0.85, // High - inheritance is critical for understanding
      neo4j: {
        relationshipType: 'EXTENDS',
        direction: 'OUTGOING',
      },
    },

    [CoreEdgeType.IMPLEMENTS]: {
      coreType: CoreEdgeType.IMPLEMENTS,
      sourceTypes: [CoreNodeType.CLASS_DECLARATION],
      targetTypes: [CoreNodeType.INTERFACE_DECLARATION],
      properties: [
        {
          name: 'confidence',
          type: 'number',
          extraction: { method: 'static', defaultValue: 1.0 },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'source',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'ast' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationshipWeight: 0.75, // High - contract relationships are important
      neo4j: {
        relationshipType: 'IMPLEMENTS',
        direction: 'OUTGOING',
      },
    },

    [CoreEdgeType.TYPED_AS]: {
      coreType: CoreEdgeType.TYPED_AS,
      sourceTypes: [CoreNodeType.PARAMETER_DECLARATION, CoreNodeType.PROPERTY_DECLARATION],
      targetTypes: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.INTERFACE_DECLARATION],
      properties: [
        {
          name: 'confidence',
          type: 'number',
          extraction: { method: 'static', defaultValue: 1.0 },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'source',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'ast' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationshipWeight: 0.5, // Medium - type info useful but not primary
      neo4j: {
        relationshipType: 'TYPED_AS',
        direction: 'OUTGOING',
      },
    },

    [CoreEdgeType.CALLS]: {
      coreType: CoreEdgeType.CALLS,
      sourceTypes: [CoreNodeType.METHOD_DECLARATION, CoreNodeType.FUNCTION_DECLARATION],
      targetTypes: [CoreNodeType.METHOD_DECLARATION, CoreNodeType.FUNCTION_DECLARATION],
      properties: [
        {
          name: 'confidence',
          type: 'number',
          extraction: { method: 'static', defaultValue: 0.8 },
          neo4j: { indexed: true, unique: false, required: true },
        },
        {
          name: 'source',
          type: 'string',
          extraction: { method: 'static', defaultValue: 'pattern' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationshipWeight: 0.85, // Critical - execution flow is primary
      neo4j: {
        relationshipType: 'CALLS',
        direction: 'OUTGOING',
      },
    },
  },
};

// ============================================================================
// PARSE OPTIONS
// ============================================================================

export interface ParseOptions {
  files?: string[];
  directories?: string[];
  includePatterns?: string[];
  excludePatterns?: string[];
  excludedNodeTypes?: CoreNodeType[];
  maxFiles?: number;
  coreSchema?: CoreTypeScriptSchema;
  frameworkSchemas?: FrameworkSchema[];
}

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
  includePatterns: ['**/*.ts', '**/*.tsx'],
  excludePatterns: EXCLUDE_PATTERNS_REGEX,
  maxFiles: 1000,
  coreSchema: CORE_TYPESCRIPT_SCHEMA,
  frameworkSchemas: [],
};
