# Custom Framework Examples

This directory contains examples of how to use the FairSquare custom framework schema with the Code Graph Context MCP server.

## What is FairSquare?

FairSquare is a custom TypeScript framework (inspired by NestJS) that uses specific patterns for dependency injection, routing, and repository access. This example demonstrates how to create custom framework schemas to detect your own framework patterns.

## Files

- **`fairsquare-framework-schema.ts`** - Located in `src/core/config/` - The actual schema definition
- **`test-fairsquare.ts`** - Example script to parse a FairSquare codebase
- **`test-credit-module.ts`** - Example parsing a specific FairSquare module
- **`test_query.cypher`** - Sample Cypher query for Neo4j

## How to Use the FairSquare Schema

The FairSquare schema is already integrated into the parser factory. You can use it in three ways:

### 1. Via MCP Tool (Automatic)

```typescript
// The parse_typescript_project tool supports auto-detection
await mcp.call('parse_typescript_project', {
  projectPath: '/path/to/fairsquare/project',
  tsconfigPath: '/path/to/tsconfig.json',
  projectType: 'fairsquare'  // or 'auto' for auto-detection
});
```

### 2. Programmatically with Auto-Detection

```typescript
import { ParserFactory } from './src/core/parsers/parser-factory.js';

const parser = await ParserFactory.createParserWithAutoDetection(
  '/path/to/project',
  '/path/to/tsconfig.json'
);

const result = await parser.parseWorkspace();
```

### 3. Explicitly Specify FairSquare

```typescript
import { ParserFactory, ProjectType } from './src/core/parsers/parser-factory.js';

const parser = ParserFactory.createParser({
  workspacePath: '/path/to/project',
  tsConfigPath: '/path/to/tsconfig.json',
  projectType: ProjectType.FAIRSQUARE
});

const result = await parser.parseWorkspace();
```

## Running the Examples

### Prerequisites

1. Build the project:
```bash
npm run build
```

2. Update the paths in the test files to point to your FairSquare codebase

### Run Full Codebase Parse

```bash
node examples/custom-frameworks/test-fairsquare.ts
```

### Run Single Module Parse

```bash
node examples/custom-frameworks/test-credit-module.ts
```

## Creating Your Own Custom Framework Schema

The FairSquare schema (`src/core/config/fairsquare-framework-schema.ts`) serves as a template for creating your own framework schemas. Here's the actual structure:

### 1. Define Semantic Types and Labels

```typescript
// Define semantic node types for your framework entities
export enum YourFrameworkSemanticNodeType {
  CUSTOM_CONTROLLER = 'Controller',
  CUSTOM_SERVICE = 'Service',
  CUSTOM_REPOSITORY = 'Repository',
}

// Define semantic edge types for relationships
export enum YourFrameworkSemanticEdgeType {
  INJECTS = 'INJECTS',
  USES_REPOSITORY = 'USES_REPOSITORY',
}

// Define Neo4j labels for categorization
export enum YourFrameworkLabel {
  YOUR_FRAMEWORK = 'YourFramework',
  BUSINESS_LOGIC = 'BusinessLogic',
  DATA_ACCESS = 'DataAccess',
}
```

### 2. Create Context Extractors

Context extractors analyze AST nodes and extract metadata into the `context` property:

```typescript
/**
 * Extract dependencies from decorator arguments
 * @Injectable([Dep1, Dep2]) → { dependencies: ['Dep1', 'Dep2'] }
 */
const extractDependencies = (
  parsedNode: ParsedNode,
  allNodes?: Map<string, ParsedNode>,
  sharedContext?: ParsingContext,
): Record<string, any> => {
  const node = parsedNode.sourceNode;
  if (!node || !Node.isClassDeclaration(node)) return {};

  const decorators = node.getDecorators();

  for (const decorator of decorators) {
    if (decorator.getName() === 'Injectable') {
      const args = decorator.getArguments();

      if (args.length > 0 && Node.isArrayLiteralExpression(args[0])) {
        const elements = args[0].getElements();
        const dependencies = elements.map((el) => el.getText());

        return {
          dependencies,
          dependencyCount: dependencies.length,
        };
      }
    }
  }

  return {};
};
```

### 3. Define Node Enhancements

Node enhancements detect and enrich specific node types:

```typescript
export const YOUR_FRAMEWORK_SCHEMA: FrameworkSchema = {
  name: 'Your Custom Framework',
  version: '1.0.0',
  description: 'Custom framework patterns',
  enhances: [CoreNodeType.CLASS_DECLARATION],

  metadata: {
    targetLanguages: ['typescript'],
    dependencies: ['@your-framework/core'],
  },

  // Global context extractors run on ALL nodes
  contextExtractors: [
    {
      nodeType: CoreNodeType.CLASS_DECLARATION,
      extractor: extractDependencies,
      priority: 10,
    },
  ],

  enhancements: {
    // Define a Controller enhancement
    customController: {
      name: 'Custom Controller',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: YourFrameworkSemanticNodeType.CUSTOM_CONTROLLER as any,
      priority: 100,

      // Detection patterns determine if a node matches this enhancement
      detectionPatterns: [
        {
          type: 'classname',
          pattern: /Controller$/,  // Matches classes ending with "Controller"
          confidence: 0.7,
          priority: 5,
        },
        {
          type: 'function',
          pattern: (parsedNode: ParsedNode) => {
            const node = parsedNode.sourceNode;
            if (!node || !Node.isClassDeclaration(node)) return false;

            // Check if extends base Controller class
            const baseClass = node.getExtends();
            return baseClass?.getText() === 'Controller';
          },
          confidence: 1.0,
          priority: 10,
        },
      ],

      // Context extractors specific to this enhancement
      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          extractor: extractDependencies,
          priority: 10,
        },
      ],

      // Additional relationships this node type can have
      additionalRelationships: [
        YourFrameworkSemanticEdgeType.INJECTS as any,
      ],

      // Neo4j configuration
      neo4j: {
        additionalLabels: [
          YourFrameworkLabel.YOUR_FRAMEWORK,
          YourFrameworkLabel.BUSINESS_LOGIC
        ],
        primaryLabel: YourFrameworkSemanticNodeType.CUSTOM_CONTROLLER,
      },
    },

    // Define a Service enhancement
    customService: {
      name: 'Custom Service',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: YourFrameworkSemanticNodeType.CUSTOM_SERVICE as any,
      priority: 90,

      detectionPatterns: [
        {
          type: 'classname',
          pattern: /Service$/,
          confidence: 0.8,
          priority: 5,
        },
        {
          type: 'decorator',
          pattern: 'Injectable',
          confidence: 0.9,
          priority: 8,
        },
      ],

      contextExtractors: [],
      additionalRelationships: [YourFrameworkSemanticEdgeType.USES_REPOSITORY as any],

      neo4j: {
        additionalLabels: [YourFrameworkLabel.YOUR_FRAMEWORK],
        primaryLabel: YourFrameworkSemanticNodeType.CUSTOM_SERVICE,
      },
    },
  },

  // Edge enhancements detect relationships between nodes
  edgeEnhancements: {
    // Detect dependency injection relationships
    injectsDependency: {
      name: 'Injects Dependency',
      semanticType: YourFrameworkSemanticEdgeType.INJECTS as any,

      // Detection pattern runs for every pair of nodes
      detectionPattern: (
        parsedSourceNode: ParsedNode,
        parsedTargetNode: ParsedNode,
        allParsedNodes: Map<string, ParsedNode>,
        sharedContext: ParsingContext
      ) => {
        // Only create edges between class declarations
        if (
          parsedSourceNode.coreType !== CoreNodeType.CLASS_DECLARATION ||
          parsedTargetNode.coreType !== CoreNodeType.CLASS_DECLARATION
        ) {
          return false;
        }

        // Check if source has target in its dependencies array
        const sourceContext = parsedSourceNode.properties.context;
        const targetName = parsedTargetNode.properties.name;

        if (!sourceContext?.dependencies) return false;

        return sourceContext.dependencies.some((dep: string) => {
          const cleanDep = dep.replace(/['"]/g, '').trim();
          return cleanDep === targetName;
        });
      },

      // Extract additional context for this relationship
      contextExtractor: (
        parsedSourceNode: ParsedNode,
        parsedTargetNode: ParsedNode,
        allParsedNodes: Map<string, ParsedNode>,
        sharedContext: ParsingContext
      ) => ({
        injectionType: 'constructor',
        framework: 'your-framework',
        targetDependency: parsedTargetNode.properties.name,
      }),

      neo4j: {
        relationshipType: 'INJECTS',
        direction: 'OUTGOING',
      },
    },

    // Service uses Repository relationship
    usesRepository: {
      name: 'Uses Repository',
      semanticType: YourFrameworkSemanticEdgeType.USES_REPOSITORY as any,

      detectionPattern: (
        parsedSourceNode: ParsedNode,
        parsedTargetNode: ParsedNode,
        allParsedNodes: Map<string, ParsedNode>,
        sharedContext: ParsingContext
      ) => {
        // Only Service → Repository edges
        const isSourceService =
          parsedSourceNode.semanticType === YourFrameworkSemanticNodeType.CUSTOM_SERVICE;
        const isTargetRepository =
          parsedTargetNode.semanticType === YourFrameworkSemanticNodeType.CUSTOM_REPOSITORY;

        if (!isSourceService || !isTargetRepository) return false;

        // Check if Service injects this Repository
        const sourceDeps = parsedSourceNode.properties.context?.dependencies ?? [];
        const targetName = parsedTargetNode.properties.name;

        return sourceDeps.some((dep: string) => {
          const cleanDep = dep.replace(/['"]/g, '').trim();
          return cleanDep === targetName;
        });
      },

      contextExtractor: (source, target, allNodes, sharedContext) => ({
        repositoryName: target.properties.name,
        serviceName: source.properties.name,
      }),

      neo4j: {
        relationshipType: 'USES_REPOSITORY',
        direction: 'OUTGOING',
      },
    },
  },
};
```

### 4. Detection Pattern Types

The framework supports multiple detection pattern types:

```typescript
// Pattern by class name (regex)
{
  type: 'classname',
  pattern: /Controller$/,
  confidence: 0.7,
  priority: 5,
}

// Pattern by decorator name (string)
{
  type: 'decorator',
  pattern: 'Injectable',
  confidence: 0.9,
  priority: 8,
}

// Pattern by filename (regex)
{
  type: 'filename',
  pattern: /vendor-client/,
  confidence: 0.9,
  priority: 8,
}

// Pattern by custom function (most flexible)
{
  type: 'function',
  pattern: (parsedNode: ParsedNode) => {
    const node = parsedNode.sourceNode;
    if (!node || !Node.isClassDeclaration(node)) return false;

    // Custom logic - check extends, decorators, file path, etc.
    const baseClass = node.getExtends();
    return baseClass?.getText() === 'Controller';
  },
  confidence: 1.0,
  priority: 10,
}
```

## Key Patterns in FairSquare Schema

### Dependency Injection via Decorators
```typescript
@Injectable([CreditCheckService, PermissionManager])
export class CreditCheckController extends Controller {
  // ...
}
```
**Detected as**: `INJECTS` relationships from Controller → Services

### Route Definitions
```typescript
export const CreditCheckRoutes: ModuleRoute[] = [
  {
    method: 'POST',
    path: '/v1/credit/check',
    controller: CreditCheckController,
    handler: 'post',
  }
];
```
**Detected as**: `ROUTES_TO_HANDLER` relationships from Route → Handler Method

### Repository Pattern
```typescript
export class UserRepository extends Repository<User> {
  // ...
}
```
**Detected as**: `Repository` semantic type with data access patterns

## Next Steps

1. **Copy the FairSquare schema** as a starting point
2. **Modify detection rules** for your framework's patterns
3. **Add it to parser-factory.ts** (or use as custom schema)
4. **Test with your codebase**

For more details, see the main [README.md](../../README.md#creating-custom-framework-schemas).
