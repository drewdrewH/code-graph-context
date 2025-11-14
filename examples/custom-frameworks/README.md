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

The FairSquare schema (`src/core/config/fairsquare-framework-schema.ts`) serves as a template for creating your own framework schemas. Here's what it detects:

### 1. Semantic Node Types

```typescript
export enum CustomSemanticNodeType {
  CUSTOM_CONTROLLER = 'Controller',
  CUSTOM_SERVICE = 'Service',
  CUSTOM_REPOSITORY = 'Repository',
  // ... your types
}
```

### 2. Semantic Edge Types

```typescript
export enum CustomSemanticEdgeType {
  CUSTOM_INJECTS = 'INJECTS',
  CUSTOM_ROUTES_TO = 'ROUTES_TO',
  // ... your relationships
}
```

### 3. Detection Rules

```typescript
{
  nodeType: CoreNodeType.CLASS_DECLARATION,
  detectionRules: [
    {
      condition: (node) => {
        // Your detection logic
        return node.getName().endsWith('Controller');
      },
      semanticType: CustomSemanticNodeType.CUSTOM_CONTROLLER,
      labels: ['YourFramework', 'Controller']
    }
  ]
}
```

### 4. Edge Generation

```typescript
{
  edgeType: CoreEdgeType.DECORATED_WITH,
  edgeGenerators: [
    {
      condition: (sourceNode, targetNode) => {
        // Your relationship logic
      },
      generateEdges: (sourceNode, targetNode, allNodes) => {
        // Return array of edges
      }
    }
  ]
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
