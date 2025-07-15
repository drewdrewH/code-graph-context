/* eslint-disable prefer-arrow/prefer-arrow-functions */
/* eslint-disable @typescript-eslint/no-explicit-any */
// graph.ts - Optimized for Neo4j performance with context-based framework properties

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
  semanticType?: SemanticNodeType; // Single semantic type

  // === FREQUENTLY INDEXED ===
  filePath: string;
  isExported?: boolean;
  visibility?: 'public' | 'private' | 'protected';

  // === CORE METADATA ===
  startLine: number;
  endLine: number;
  sourceCode: string;
  createdAt: string;

  // === FRAMEWORK-SPECIFIC (Dynamic) ===
  context?: Record<string, any>;
}

/**
 * Streamlined Edge Properties - Core relationship info + dynamic context
 */
export interface Neo4jEdgeProperties {
  // === ALWAYS INDEXED ===
  coreType: CoreEdgeType;
  semanticType?: SemanticEdgeType; // Single semantic type

  // === FREQUENTLY INDEXED ===
  source: 'ast' | 'decorator' | 'pattern' | 'inference';
  confidence: number;

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
  pattern: string | RegExp | ((node: any) => boolean);
  confidence: number;
  priority: number;
}

/**
 * Context Extractor for Framework-Specific Properties
 */
export interface ContextExtractor {
  nodeType: CoreNodeType;
  edgeType?: CoreEdgeType;
  semanticType?: SemanticNodeType;
  extractor: (node: any, edge?: any) => Record<string, any>;
  priority: number;
}

/**
 * Core Schema Node Definition
 */
export interface CoreNode {
  coreType: CoreNodeType;
  astNodeKind: number;
  properties: PropertyDefinition[];
  relationships: CoreEdgeType[];
  neo4j: {
    labels: string[];
    primaryLabel: string;
    indexed: string[]; // Which properties to index
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
  nodeTypes: Record<CoreNodeType, CoreNode>;
  edgeTypes: Record<CoreEdgeType, CoreEdge>;
}

/**
 * Framework Enhancement Definition
 */
export interface FrameworkEnhancement {
  name: string;
  targetCoreType: CoreNodeType;
  semanticType: SemanticNodeType;
  detectionPatterns: DetectionPattern[];
  contextExtractors: ContextExtractor[];
  additionalRelationships: SemanticEdgeType[];
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
  semanticType: SemanticEdgeType;
  detectionPattern: (sourceNode: any, targetNode: any) => boolean;
  contextExtractor?: (sourceNode: any, targetNode: any) => Record<string, any>;
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
  };
}

// ============================================================================
// CORE TYPESCRIPT SCHEMA
// ============================================================================

export const CORE_TYPESCRIPT_SCHEMA: CoreTypeScriptSchema = {
  name: 'Core TypeScript Schema',
  version: '2.0.0',

  nodeTypes: {
    [CoreNodeType.SOURCE_FILE]: {
      coreType: CoreNodeType.SOURCE_FILE,
      astNodeKind: 311,
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
      relationships: [CoreEdgeType.CONTAINS, CoreEdgeType.IMPORTS, CoreEdgeType.EXPORTS],
      neo4j: {
        labels: ['SourceFile', 'TypeScript'],
        primaryLabel: 'SourceFile',
        indexed: ['name', 'filePath', 'isExported'],
      },
    },

    [CoreNodeType.CLASS_DECLARATION]: {
      coreType: CoreNodeType.CLASS_DECLARATION,
      astNodeKind: 262,
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
        CoreEdgeType.HAS_MEMBER,
        CoreEdgeType.EXTENDS,
        CoreEdgeType.IMPLEMENTS,
        CoreEdgeType.DECORATED_WITH,
      ],
      neo4j: {
        labels: ['Class', 'TypeScript'],
        primaryLabel: 'Class',
        indexed: ['name', 'isExported', 'visibility'],
      },
    },

    [CoreNodeType.METHOD_DECLARATION]: {
      coreType: CoreNodeType.METHOD_DECLARATION,
      astNodeKind: 172,
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
      relationships: [CoreEdgeType.HAS_PARAMETER, CoreEdgeType.CALLS, CoreEdgeType.DECORATED_WITH],
      neo4j: {
        labels: ['Method', 'TypeScript'],
        primaryLabel: 'Method',
        indexed: ['name', 'visibility'],
      },
    },

    [CoreNodeType.PROPERTY_DECLARATION]: {
      coreType: CoreNodeType.PROPERTY_DECLARATION,
      astNodeKind: 171,
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
      relationships: [CoreEdgeType.TYPED_AS, CoreEdgeType.DECORATED_WITH],
      neo4j: {
        labels: ['Property', 'TypeScript'],
        primaryLabel: 'Property',
        indexed: ['name', 'visibility'],
      },
    },

    [CoreNodeType.PARAMETER_DECLARATION]: {
      coreType: CoreNodeType.PARAMETER_DECLARATION,
      astNodeKind: 169,
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getName' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [CoreEdgeType.TYPED_AS, CoreEdgeType.DECORATED_WITH],
      neo4j: {
        labels: ['Parameter', 'TypeScript'],
        primaryLabel: 'Parameter',
        indexed: ['name'],
      },
    },

    [CoreNodeType.IMPORT_DECLARATION]: {
      coreType: CoreNodeType.IMPORT_DECLARATION,
      astNodeKind: 272,
      properties: [
        {
          name: 'name',
          type: 'string',
          extraction: { method: 'ast', source: 'getModuleSpecifierValue' },
          neo4j: { indexed: true, unique: false, required: true },
        },
      ],
      relationships: [CoreEdgeType.IMPORTS],
      neo4j: {
        labels: ['Import', 'TypeScript'],
        primaryLabel: 'Import',
        indexed: ['name'],
      },
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
      ],
      relationships: [],
      neo4j: {
        labels: ['Decorator'],
        primaryLabel: 'Decorator',
        indexed: ['name'],
      },
    },

    // Add remaining core types with minimal properties
    [CoreNodeType.INTERFACE_DECLARATION]: {
      coreType: CoreNodeType.INTERFACE_DECLARATION,
      astNodeKind: 263,
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
      relationships: [CoreEdgeType.EXTENDS, CoreEdgeType.HAS_MEMBER],
      neo4j: {
        labels: ['Interface', 'TypeScript'],
        primaryLabel: 'Interface',
        indexed: ['name', 'isExported'],
      },
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
      neo4j: {
        labels: ['Enum', 'TypeScript'],
        primaryLabel: 'Enum',
        indexed: ['name', 'isExported'],
      },
    },

    [CoreNodeType.FUNCTION_DECLARATION]: {
      coreType: CoreNodeType.FUNCTION_DECLARATION,
      astNodeKind: 261,
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
      relationships: [CoreEdgeType.HAS_PARAMETER, CoreEdgeType.CALLS],
      neo4j: {
        labels: ['Function', 'TypeScript'],
        primaryLabel: 'Function',
        indexed: ['name', 'isExported'],
      },
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
      neo4j: {
        labels: ['Variable', 'TypeScript'],
        primaryLabel: 'Variable',
        indexed: ['name'],
      },
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
      ],
      relationships: [CoreEdgeType.HAS_PARAMETER],
      neo4j: {
        labels: ['Constructor', 'TypeScript'],
        primaryLabel: 'Constructor',
        indexed: ['name'],
      },
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
      neo4j: {
        labels: ['Export', 'TypeScript'],
        primaryLabel: 'Export',
        indexed: ['name'],
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
      neo4j: {
        relationshipType: 'CALLS',
        direction: 'OUTGOING',
      },
    },
  },
};

// ============================================================================
// NESTJS FRAMEWORK SCHEMA
// ============================================================================

export const NESTJS_FRAMEWORK_SCHEMA: FrameworkSchema = {
  name: 'NestJS Framework Schema',
  version: '2.0.0',
  description: 'NestJS-specific enhancements with context-based properties',
  enhances: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.METHOD_DECLARATION],

  enhancements: {
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
      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          semanticType: SemanticNodeType.NEST_CONTROLLER,
          extractor: (node: any) => ({
            basePath: extractControllerPath(node),
            endpointCount: countHttpEndpoints(node),
            hasGlobalGuards: hasDecorator(node, 'UseGuards'),
            hasGlobalPipes: hasDecorator(node, 'UsePipes'),
            hasGlobalInterceptors: hasDecorator(node, 'UseInterceptors'),
            version: extractVersion(node),
          }),
          priority: 1,
        },
      ],
      additionalRelationships: [SemanticEdgeType.EXPOSES, SemanticEdgeType.INJECTS],
      neo4j: {
        additionalLabels: ['Controller', 'NestJS'],
        primaryLabel: 'Controller',
      },
      priority: 90,
    },

    NestService: {
      name: 'NestService',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.NEST_SERVICE,
      detectionPatterns: [ 
        {
          type: 'filename',
          pattern: /\.service\.ts$/,
          confidence: 0.9,
          priority: 9,
        },
        {
          type: 'function',
          pattern: (node: any) => node.getName()?.endsWith('Service'),
          confidence: 0.7,
          priority: 7,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          semanticType: SemanticNodeType.NEST_SERVICE,
          extractor: (node: any) => ({
            scope: extractScope(node),
            isAsync: hasAsyncMethods(node),
            dependencyCount: countConstructorParameters(node),
            injectionToken: extractInjectionToken(node),
          }),
          priority: 1,
        },
      ],
      additionalRelationships: [SemanticEdgeType.PROVIDED_BY, SemanticEdgeType.MANAGES],
      neo4j: {
        additionalLabels: ['Service', 'NestJS'],
        primaryLabel: 'Service',
      },
      priority: 80,
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
      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          semanticType: SemanticNodeType.NEST_MODULE,
          extractor: (node: any) => ({
            isGlobal: hasDecorator(node, 'Global'),
            isDynamic: hasDynamicMethods(node),
            imports: extractModuleImports(node),
            providers: extractModuleProviders(node),
            controllers: extractModuleControllers(node),
            exports: extractModuleExports(node),
          }),
          priority: 1,
        },
      ],
      additionalRelationships: [SemanticEdgeType.MODULE_IMPORTS, SemanticEdgeType.MODULE_PROVIDES],
      neo4j: {
        additionalLabels: ['Module', 'NestJS'],
        primaryLabel: 'Module',
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
            const decorators = node.getDecorators?.() || [];
            const httpDecorators = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Head', 'Options'];
            return decorators.some((d: any) => httpDecorators.includes(d.getName()));
          },
          confidence: 0.98,
          priority: 15,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.METHOD_DECLARATION,
          semanticType: SemanticNodeType.HTTP_ENDPOINT,
          extractor: (node: any) => ({
            httpMethod: extractHttpMethod(node),
            path: extractRoutePath(node),
            fullPath: computeFullPath(node),
            statusCode: extractStatusCode(node),
            hasAuth: hasAuthDecorators(node),
            hasValidation: hasValidationDecorators(node),
            guardNames: extractGuardNames(node),
            pipeNames: extractPipeNames(node),
            interceptorNames: extractInterceptorNames(node),
          }),
          priority: 1,
        },
      ],
      additionalRelationships: [SemanticEdgeType.ACCEPTS, SemanticEdgeType.RESPONDS_WITH, SemanticEdgeType.GUARDED_BY],
      neo4j: {
        additionalLabels: ['HttpEndpoint', 'NestJS'],
        primaryLabel: 'HttpEndpoint',
      },
      priority: 85,
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
      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          semanticType: SemanticNodeType.ENTITY_CLASS,
          extractor: (node: any) => ({
            tableName: extractTableName(node),
            columnCount: countColumns(node),
            hasRelations: hasRelationDecorators(node),
          }),
          priority: 1,
        },
      ],
      additionalRelationships: [],
      neo4j: {
        additionalLabels: ['Entity', 'NestJS'],
        primaryLabel: 'Entity',
      },
      priority: 80,
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
      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          semanticType: SemanticNodeType.DTO_CLASS,
          extractor: (node: any) => ({
            validationDecorators: extractValidationDecorators(node),
            isRequestDto: node.getName()?.toLowerCase().includes('request') || false,
            isResponseDto: node.getName()?.toLowerCase().includes('response') || false,
            isPartialDto: extendsPartialType(node),
            baseClass: extractBaseClass(node),
          }),
          priority: 1,
        },
      ],
      additionalRelationships: [SemanticEdgeType.VALIDATES],
      neo4j: {
        additionalLabels: ['DTO', 'NestJS'],
        primaryLabel: 'DTO',
      },
      priority: 70,
    },
  },

  edgeEnhancements: {
    DependencyInjection: {
      name: 'DependencyInjection',
      semanticType: SemanticEdgeType.INJECTS,
      detectionPattern: (sourceNode: any, targetNode: any) => {
        return detectDependencyInjection(sourceNode, targetNode);
      },
      contextExtractor: (sourceNode: any, targetNode: any) => ({
        injectionType: 'constructor',
        injectionToken: extractInjectionTokenFromRelation(sourceNode, targetNode),
        parameterIndex: findParameterIndex(sourceNode, targetNode),
      }),
      neo4j: {
        relationshipType: 'INJECTS',
        direction: 'OUTGOING',
      },
    },

    HttpEndpointExposure: {
      name: 'HttpEndpointExposure',
      semanticType: SemanticEdgeType.EXPOSES,
      detectionPattern: (sourceNode: any, targetNode: any) => {
        return (
          sourceNode.properties?.semanticType === SemanticNodeType.NEST_CONTROLLER &&
          targetNode.properties?.semanticType === SemanticNodeType.HTTP_ENDPOINT
        );
      },
      contextExtractor: (sourceNode: any, targetNode: any) => ({
        httpMethod: targetNode.properties?.context?.httpMethod || '',
        fullPath: computeFullPathFromNodes(sourceNode, targetNode),
        statusCode: targetNode.properties?.context?.statusCode || 200,
      }),
      neo4j: {
        relationshipType: 'EXPOSES',
        direction: 'OUTGOING',
      },
    },
  },

  contextExtractors: [
    // Global context extractors that apply to all nodes
    {
      nodeType: CoreNodeType.SOURCE_FILE,
      extractor: (node: any) => ({
        extension: node.getFilePath().substring(node.getFilePath().lastIndexOf('.')),
        relativePath: extractRelativePath(node),
        isTestFile: /\.(test|spec)\./.test(node.getFilePath()),
        isDeclarationFile: node.getFilePath().endsWith('.d.ts'),
        moduleKind: 'ES6',
        importCount: node.getImportDeclarations().length,
        exportCount: node.getExportDeclarations().length,
        declarationCount: countDeclarations({ node }),
      }),
      priority: 1,
    },
    {
      nodeType: CoreNodeType.CLASS_DECLARATION,
      extractor: (node: any) => ({
        isAbstract: node.getAbstractKeyword() != null,
        isDefaultExport: node.isDefaultExport(),
        extendsClause: node.getExtends()?.getText(),
        implementsClauses: node.getImplements().map((i: any) => i.getText()),
        decoratorNames: node.getDecorators().map((d: any) => d.getName()),
        methodCount: node.getMethods().length,
        propertyCount: node.getProperties().length,
        constructorParameterCount: countConstructorParameters(node),
      }),
      priority: 1,
    },
    {
      nodeType: CoreNodeType.METHOD_DECLARATION,
      extractor: (node: any) => ({
        isStatic: node.isStatic(),
        isAsync: node.isAsync(),
        isAbstract: node.isAbstract(),
        returnType: node.getReturnTypeNode()?.getText() || 'void',
        parameterCount: node.getParameters().length,
        decoratorNames: node.getDecorators().map((d: any) => d.getName()),
        isGetter: node.getKind() === 177,
        isSetter: node.getKind() === 178,
        overloadCount: 1, // Simplified
      }),
      priority: 1,
    },
    {
      nodeType: CoreNodeType.PROPERTY_DECLARATION,
      extractor: (node: any) => ({
        isStatic: node.isStatic(),
        isReadonly: node.isReadonly(),
        type: node.getTypeNode()?.getText() || 'any',
        hasInitializer: node.hasInitializer(),
        decoratorNames: node.getDecorators().map((d: any) => d.getName()),
        isOptional: node.hasQuestionToken(),
      }),
      priority: 1,
    },
    {
      nodeType: CoreNodeType.PARAMETER_DECLARATION,
      extractor: (node: any) => ({
        type: node.getTypeNode()?.getText() || 'any',
        isOptional: node.hasQuestionToken(),
        isRestParameter: node.isRestParameter(),
        hasDefaultValue: node.hasInitializer(),
        decoratorNames: node.getDecorators().map((d: any) => d.getName()),
        parameterIndex: node.getChildIndex(),
      }),
      priority: 1,
    },
    {
      nodeType: CoreNodeType.IMPORT_DECLARATION,
      extractor: (node: any) => ({
        moduleSpecifier: node.getModuleSpecifierValue(),
        isTypeOnly: node.isTypeOnly(),
        importKind: determineImportKind(node),
        namedImports: node.getNamedImports().map((ni: any) => ni.getName()),
        defaultImport: node.getDefaultImport()?.getText() || null,
        namespaceImport: node.getNamespaceImport()?.getText() || null,
      }),
      priority: 1,
    },
    {
      nodeType: CoreNodeType.DECORATOR,
      extractor: (node: any) => ({
        arguments: node.getArguments().map((arg: any) => arg.getText()),
        target: determineDecoratorTarget(node),
      }),
      priority: 1,
    },
  ],

  metadata: {
    targetLanguages: ['typescript'],
    dependencies: ['@nestjs/core', '@nestjs/common'],
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function extractControllerPath(node: any): string {
  const decorator = node.getDecorator('Controller');
  if (!decorator) return '';
  const args = decorator.getArguments();
  return args.length > 0 ? `/${args[0].getText().replace(/['"]/g, '')}` : '';
}

function countHttpEndpoints(node: any): number {
  const methods = node.getMethods();
  const httpDecorators = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Head', 'Options'];
  return methods.filter((method: any) => {
    const decorators = method.getDecorators();
    return decorators.some((d: any) => httpDecorators.includes(d.getName()));
  }).length;
}

function hasDecorator(node: any, decoratorName: string): boolean {
  const decorators = node.getDecorators();
  return decorators.some((d: any) => d.getName() === decoratorName);
}

function extractVersion(node: any): string | null {
  const decorator = node.getDecorator('Version');
  if (!decorator) return null;
  const args = decorator.getArguments();
  return args.length > 0 ? args[0].getText().replace(/['"]/g, '') : null;
}

function extractScope(node: any): string {
  const decorator = node.getDecorator('Injectable');
  if (!decorator) return 'DEFAULT';
  const args = decorator.getArguments();
  if (args.length === 0) return 'DEFAULT';
  const argText = args[0].getText();
  if (argText.includes('REQUEST')) return 'REQUEST';
  if (argText.includes('TRANSIENT')) return 'TRANSIENT';
  return 'DEFAULT';
}

function hasAsyncMethods(node: any): boolean {
  const methods = node.getMethods();
  return methods.some((method: any) => method.isAsync?.());
}

function countConstructorParameters(node: any): number {
  const constructors = node.getConstructors();
  return constructors.length > 0 ? constructors[0].getParameters().length : 0;
}

function extractInjectionToken(node: any): string | null {
  const decorator = node.getDecorator('Injectable');
  if (!decorator) return null;
  const args = decorator.getArguments();
  if (args.length > 0 && args[0].getText().startsWith("'")) {
    return args[0].getText().replace(/['"]/g, '');
  }
  return null;
}

function hasDynamicMethods(node: any): boolean {
  const methods = node.getMethods();
  const dynamicMethods = ['forRoot', 'forFeature', 'forRootAsync', 'forFeatureAsync'];
  return methods.some((method: any) => {
    return method.isStatic?.() && dynamicMethods.includes(method.getName());
  });
}

function extractModuleImports(node: any): string[] {
  return extractModuleArrayProperty(node, 'imports');
}

function extractModuleProviders(node: any): string[] {
  return extractModuleArrayProperty(node, 'providers');
}

function extractModuleControllers(node: any): string[] {
  return extractModuleArrayProperty(node, 'controllers');
}

function extractModuleExports(node: any): string[] {
  return extractModuleArrayProperty(node, 'exports');
}

function extractModuleArrayProperty(node: any, propertyName: string): string[] {
  const decorator = node.getDecorator('Module');
  if (!decorator) return [];
  const args = decorator.getArguments();
  if (args.length === 0) return [];
  const configText = args[0].getText();
  const regex = new RegExp(`${propertyName}\\s*:\\s*\\[([^\\]]+)\\]`);
  const match = configText.match(regex);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((item: string) => item.trim().replace(/['"]/g, ''))
    .filter((item: string) => item.length > 0);
}

function extractHttpMethod(node: any): string {
  const decorators = node.getDecorators();
  const httpDecorators = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Head', 'Options'];
  const httpDecorator = decorators.find((d: any) => httpDecorators.includes(d.getName()));
  return httpDecorator ? httpDecorator.getName().toUpperCase() : '';
}

function extractRoutePath(node: any): string {
  const decorators = node.getDecorators();
  const httpDecorators = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Head', 'Options'];
  const httpDecorator = decorators.find((d: any) => httpDecorators.includes(d.getName()));
  if (!httpDecorator) return '';
  const args = httpDecorator.getArguments();
  return args.length > 0 ? args[0].getText().replace(/['"]/g, '') : '';
}

function computeFullPath(node: any): string {
  const methodPath = extractRoutePath(node);
  // TODO: Would need to traverse up to controller to get base path
  return methodPath;
}

function extractStatusCode(node: any): number | null {
  const decorator = node.getDecorator('HttpCode');
  if (!decorator) return null;
  const args = decorator.getArguments();
  if (args.length > 0) {
    const status = parseInt(args[0].getText());
    return isNaN(status) ? null : status;
  }
  return null;
}

function hasAuthDecorators(node: any): boolean {
  const decorators = node.getDecorators();
  const authDecorators = ['UseGuards', 'Auth', 'Roles', 'Public'];
  return decorators.some((d: any) => authDecorators.includes(d.getName()));
}

function hasValidationDecorators(node: any): boolean {
  const decorators = node.getDecorators();
  const validationDecorators = ['UsePipes', 'ValidationPipe'];
  return decorators.some((d: any) => validationDecorators.includes(d.getName()));
}

function extractGuardNames(node: any): string[] {
  return extractDecoratorArguments(node, 'UseGuards');
}

function extractPipeNames(node: any): string[] {
  return extractDecoratorArguments(node, 'UsePipes');
}

function extractInterceptorNames(node: any): string[] {
  return extractDecoratorArguments(node, 'UseInterceptors');
}

function extractDecoratorArguments(node: any, decoratorName: string): string[] {
  const decorator = node.getDecorator(decoratorName);
  if (!decorator) return [];
  const args = decorator.getArguments();
  return args.map((arg: any) => arg.getText().replace(/[(),]/g, '').trim()).filter((name: string) => name.length > 0);
}

function extractTableName(node: any): string | null {
  const decorator = node.getDecorator('Entity');
  if (!decorator) return null;
  const args = decorator.getArguments();
  return args.length > 0 ? args[0].getText().replace(/['"]/g, '') : null;
}

function countColumns(node: any): number {
  const properties = node.getProperties();
  return properties.filter((prop: any) => {
    const decorators = prop.getDecorators();
    return decorators.some((d: any) => ['Column', 'PrimaryGeneratedColumn'].includes(d.getName()));
  }).length;
}

function hasRelationDecorators(node: any): boolean {
  const properties = node.getProperties();
  const relationDecorators = ['OneToOne', 'OneToMany', 'ManyToOne', 'ManyToMany'];
  return properties.some((prop: any) => {
    const decorators = prop.getDecorators();
    return decorators.some((d: any) => relationDecorators.includes(d.getName()));
  });
}

function extractValidationDecorators(node: any): string[] {
  const properties = node.getProperties();
  const validationDecorators: string[] = [];
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

  properties.forEach((prop: any) => {
    const decorators = prop.getDecorators();
    decorators.forEach((decorator: any) => {
      const name = decorator.getName();
      if (commonValidators.includes(name)) {
        validationDecorators.push(name);
      }
    });
  });

  return [...new Set(validationDecorators)];
}

function extendsPartialType(node: any): boolean {
  const baseClass = node.getBaseClass();
  return baseClass ? baseClass.getText().includes('PartialType') : false;
}

function extractBaseClass(node: any): string | null {
  const baseClass = node.getBaseClass();
  return baseClass ? baseClass.getText() : null;
}

function detectDependencyInjection(sourceNode: any, targetNode: any): boolean {
  if (sourceNode.properties?.coreType !== CoreNodeType.CLASS_DECLARATION) return false;
  if (targetNode.properties?.coreType !== CoreNodeType.CLASS_DECLARATION) return false;

  const constructors = sourceNode.sourceNode?.getConstructors();
  if (!constructors || constructors.length === 0) return false;

  const constructor = constructors[0];
  const parameters = constructor.getParameters();
  const targetName = targetNode.properties?.name;

  return parameters.some((param: any) => {
    const paramType = param.getTypeNode()?.getText();
    if (paramType === targetName) return true;

    const decorators = param.getDecorators();
    return decorators.some((decorator: any) => {
      if (decorator.getName() === 'Inject') {
        const args = decorator.getArguments();
        if (args.length > 0) {
          const token = args[0].getText().replace(/['"]/g, '');
          return token === targetName;
        }
      }
      return false;
    });
  });
}

function extractInjectionTokenFromRelation(sourceNode: any, targetNode: any): string | null {
  const constructors = sourceNode.sourceNode?.getConstructors();
  if (!constructors || constructors.length === 0) return null;

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

  return null;
}

function findParameterIndex(sourceNode: any, targetNode: any): number {
  const constructors = sourceNode.sourceNode?.getConstructors();
  if (!constructors || constructors.length === 0) return 0;

  const constructor = constructors[0];
  const parameters = constructor.getParameters();
  const targetName = targetNode.properties?.name;

  return parameters.findIndex((param: any) => {
    const paramType = param.getTypeNode()?.getText();
    return paramType === targetName;
  });
}

function computeFullPathFromNodes(sourceNode: any, targetNode: any): string {
  const basePath = sourceNode.properties?.context?.basePath || '';
  const methodPath = targetNode.properties?.context?.path || '';
  return `${basePath}/${methodPath}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function extractRelativePath(node: any): string {
  const filePath = node.getFilePath();
  const parts = filePath.split('/');
  return parts.slice(-3).join('/');
}

function countDeclarations({ node }: { node: any }): number {
  return node.getClasses().length + node.getInterfaces().length + node.getFunctions().length + node.getEnums().length;
}

function determineImportKind(node: any): string {
  if (node.getDefaultImport()) return 'default';
  if (node.getNamespaceImport()) return 'namespace';
  if (node.getNamedImports().length > 0) return 'named';
  return 'side-effect';
}

function determineDecoratorTarget(node: any): string {
  const parent = node.getParent();
  if (!parent) return 'unknown';

  const kind = parent.getKind();
  if (kind === 262) return 'class'; // ClassDeclaration
  if (kind === 172) return 'method'; // MethodDeclaration
  if (kind === 171) return 'property'; // PropertyDeclaration
  if (kind === 169) return 'parameter'; // Parameter

  return 'unknown';
}

// ============================================================================
// PARSE OPTIONS
// ============================================================================

export interface ParseOptions {
  files?: string[];
  directories?: string[];
  includePatterns?: string[];
  excludePatterns?: string[];
  maxFiles?: number;
  coreSchema?: CoreTypeScriptSchema;
  frameworkSchemas?: FrameworkSchema[];
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
