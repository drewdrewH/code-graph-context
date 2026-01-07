# Code Graph Context MCP Server

[![npm version](https://badge.fury.io/js/code-graph-context.svg)](https://www.npmjs.com/package/code-graph-context)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-007ACC?logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![Neo4j](https://img.shields.io/badge/Neo4j-5.23+-018bff?logo=neo4j&logoColor=white)](https://neo4j.com/)
[![NestJS](https://img.shields.io/badge/NestJS-Compatible-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![OpenAI](https://img.shields.io/badge/OpenAI-Powered-412991?logo=openai&logoColor=white)](https://openai.com/)
[![MCP](https://img.shields.io/badge/MCP-Server-blue)](https://modelcontextprotocol.io/)

A Model Context Protocol (MCP) server that builds rich code graphs to provide deep contextual understanding of TypeScript codebases to Large Language Models. This server parses your codebase using AST analysis, constructs a comprehensive graph representation in Neo4j, and provides intelligent querying capabilities through semantic search and graph traversal.

**Config-Driven & Extensible**: Define custom framework schemas to capture domain-specific patterns beyond the included NestJS support. The parser is fully configurable to recognize your architectural patterns, decorators, and relationships.

## Features

- **Multi-Project Support**: Parse and query multiple projects in a single database with complete isolation via `projectId`
- **Rich Code Graph Generation**: Parses TypeScript projects and creates detailed graph representations with AST-level precision
- **Semantic Search**: Vector-based semantic search using OpenAI embeddings to find relevant code patterns and implementations
- **Natural Language Querying**: Convert natural language questions into Cypher queries using OpenAI assistants API
- **Framework-Aware & Customizable**: Built-in NestJS schema with ability to define custom framework patterns via configuration
- **Weighted Graph Traversal**: Intelligent traversal that scores paths based on relationship importance, query relevance, and depth
- **Workspace & Monorepo Support**: Auto-detects Nx, Turborepo, pnpm, Yarn, and npm workspaces
- **Parallel Parsing**: Multi-threaded parsing with configurable worker pool for maximum CPU utilization
- **Async Parsing**: Background parsing with Worker threads for large codebases without blocking the MCP server
- **Streaming Import**: Chunked processing for projects with 100+ files to prevent memory issues
- **TypeAlias Support**: Full parsing of TypeScript type aliases into graph nodes
- **Incremental Parsing**: Only reparse changed files for faster updates
- **File Watching**: Real-time monitoring with automatic incremental graph updates on file changes
- **Impact Analysis**: Assess refactoring risk with dependency analysis (LOW/MEDIUM/HIGH/CRITICAL scoring)
- **Dead Code Detection**: Find unreferenced exports, uncalled private methods, unused interfaces with confidence scoring
- **Duplicate Code Detection**: Identify structural duplicates (identical AST) and semantic duplicates (similar logic via embeddings)
- **Swarm Coordination**: Multi-agent stigmergic coordination through pheromone markers with exponential decay
- **High Performance**: Optimized Neo4j storage with vector indexing for fast retrieval
- **MCP Integration**: Seamless integration with Claude Code and other MCP-compatible tools

## Architecture

The MCP server consists of several key components:

### Core Components

1. **TypeScript Parser** (`src/core/parsers/typescript-parser.ts`): Uses `ts-morph` to parse TypeScript AST and extract code entities
2. **Graph Storage** (`src/storage/neo4j/neo4j.service.ts`): Neo4j integration for storing and querying the code graph
3. **Embeddings Service** (`src/core/embeddings/embeddings.service.ts`): OpenAI integration for semantic search capabilities
4. **MCP Server** (`src/mcp/mcp.server.ts`): Main MCP server providing tools for code analysis

### Graph Schema

The system uses a dual-schema approach:

- **Core Schema**: AST-level nodes (Classes, Methods, Properties, Imports, etc.)
- **Framework Schema**: Semantic interpretations (NestJS Controllers, Services, HTTP Endpoints, etc.)

## Getting Started

### Prerequisites

- **Node.js** >= 18
- **Neo4j** >= 5.23 with APOC plugin
- **OpenAI API Key** (for embeddings and natural language processing)
- **Docker** (recommended for Neo4j setup)

### Installation

Choose the installation method that works best for you:

#### Option 1: NPM Install (Recommended)

```bash
# Install globally
npm install -g code-graph-context

# Set up Neo4j (requires Docker)
code-graph-context init

# Add to Claude Code (--scope user makes it available globally)
claude mcp add --scope user code-graph-context code-graph-context
```

Then configure your OpenAI API key in `~/.claude.json`:
```json
{
  "mcpServers": {
    "code-graph-context": {
      "command": "code-graph-context",
      "env": {
        "OPENAI_API_KEY": "sk-your-key-here"
      }
    }
  }
}
```

#### Option 2: From Source

```bash
# Clone and build
git clone https://github.com/drewdrewH/code-graph-context.git
cd code-graph-context
npm install
npm run build

# Set up Neo4j
code-graph-context init

# Add to Claude Code (use absolute path)
claude mcp add code-graph-context node /absolute/path/to/code-graph-context/dist/cli/cli.js
```

### CLI Commands

The package includes a CLI for managing Neo4j:

```bash
code-graph-context init [options]   # Set up Neo4j container
code-graph-context status           # Check Docker/Neo4j status
code-graph-context stop             # Stop Neo4j container
```

**Init options:**
```
-p, --port <port>       Bolt port (default: 7687)
--http-port <port>      Browser port (default: 7474)
--password <password>   Neo4j password (default: PASSWORD)
-m, --memory <size>     Heap memory (default: 2G)
-f, --force             Recreate container
```

### Alternative Neo4j Setup

If you prefer not to use the CLI, you can set up Neo4j manually:

**Docker Compose:**
```bash
docker-compose up -d
```

**Docker Run:**
```bash
docker run -d \
  --name code-graph-neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/PASSWORD \
  -e 'NEO4J_PLUGINS=["apoc"]' \
  neo4j:5.23
```

**Neo4j Desktop:** Download from [neo4j.com/download](https://neo4j.com/download/) and install APOC plugin.

**Neo4j Aura (Cloud):** Create account at [neo4j.com/cloud/aura](https://neo4j.com/cloud/platform/aura-graph-database/) and configure connection URI in env vars.

### Verify Installation

After installation, verify everything is working:

1. **Check Neo4j is running:**
```bash
# Open Neo4j Browser
open http://localhost:7474
# Login: neo4j / PASSWORD
```

2. **Test APOC plugin:**
```cypher
CALL apoc.help("apoc")
```
Should return a list of APOC functions.

3. **Test MCP server connection:**
```bash
claude mcp list
```
Should show: `code-graph-context: ✓ Connected`

## Tool Usage Guide

### Available Tools

| Tool | Description | Best For |
|------|-------------|----------|
| `list_projects` | List all parsed projects in database | **Discovery** - see available projects and their status |
| `search_codebase` | Semantic search using vector embeddings | **Starting point** - find code by describing what you need |
| `traverse_from_node` | Explore relationships from a specific node | **Deep dive** - understand dependencies and connections |
| `impact_analysis` | Analyze what depends on a node | **Pre-refactoring** - assess blast radius (LOW/MEDIUM/HIGH/CRITICAL) |
| `parse_typescript_project` | Parse project and build the graph | **Initial setup** - supports async mode for large projects |
| `check_parse_status` | Monitor async parsing job progress | **Monitoring** - track background parsing jobs |
| `start_watch_project` | Start file watching for a project | **Live updates** - auto-update graph on file changes |
| `stop_watch_project` | Stop file watching for a project | **Resource management** - stop monitoring |
| `list_watchers` | List all active file watchers | **Monitoring** - see what's being watched |
| `natural_language_to_cypher` | Convert natural language to Cypher | **Advanced queries** - complex graph queries |
| `detect_dead_code` | Find unreferenced exports, uncalled methods, unused interfaces | **Code cleanup** - identify potentially removable code |
| `detect_duplicate_code` | Find structural and semantic code duplicates | **Refactoring** - identify DRY violations |
| `swarm_pheromone` | Leave pheromone markers on code nodes | **Multi-agent** - stigmergic coordination |
| `swarm_sense` | Query pheromones in the code graph | **Multi-agent** - sense what other agents are doing |
| `swarm_cleanup` | Bulk delete pheromones | **Multi-agent** - cleanup after swarm completion |
| `test_neo4j_connection` | Verify database connectivity | **Health check** - troubleshooting |

> **Note**: All query tools (`search_codebase`, `traverse_from_node`, `impact_analysis`, `natural_language_to_cypher`) require a `projectId` parameter. Use `list_projects` to discover available projects.

### Tool Selection Guide

- **`list_projects`**: First step - discover what projects are available
- **`search_codebase`**: Find code by describing what you're looking for
- **`traverse_from_node`**: Use node IDs from search results to explore relationships
- **`impact_analysis`**: Before refactoring - understand what depends on the code you're changing

### Multi-Project Workflow

All query tools require a `projectId` parameter to ensure project isolation. You can provide:

1. **Project ID**: `proj_a1b2c3d4e5f6` (auto-generated from path)
2. **Project Name**: `my-backend` (extracted from package.json or directory name)
3. **Project Path**: `/path/to/my-backend` (resolved to project ID)

**Typical Workflow:**

```typescript
// Step 1: Discover available projects
list_projects()
// Returns: project names, IDs, status, node/edge counts

// Step 2: Parse a new project (if not already parsed)
parse_typescript_project({
  projectPath: '/path/to/project',
  tsconfigPath: '/path/to/project/tsconfig.json'
})
// Returns: projectId for use in queries

// Step 3: Query the project using any of these ID formats
search_codebase({ projectId: "my-backend", query: "authentication" })
search_codebase({ projectId: "proj_a1b2c3d4e5f6", query: "authentication" })
search_codebase({ projectId: "/path/to/my-backend", query: "authentication" })
```

**Pro Tips:**
- Use project names instead of full IDs for convenience
- Run `list_projects` first to see what's available
- Each project is completely isolated - queries never cross project boundaries

### Sequential Workflow Patterns

The MCP tools are designed to work together in powerful workflows. Here are the most effective patterns:

#### Pattern 1: Discovery → Focus → Deep Dive
```mermaid
graph LR
    A[search_codebase] --> B[traverse_from_node] --> C[traverse_from_node with skip]
    A --> D[traverse_from_node] --> E[traverse_from_node deeper]
```

#### Pattern 2: Broad Search → Targeted Analysis
1. **Start Broad**: Use `search_codebase` to find relevant starting points
2. **Focus**: Use `traverse_from_node` to explore specific relationships
3. **Paginate**: Use `skip` parameter to explore different sections of the graph

### Tool Deep Dive

#### 1. `search_codebase` - Your Starting Point
Semantic search using vector embeddings. Returns JSON:API normalized response.

```typescript
search_codebase({ projectId: "my-backend", query: "JWT token validation" })
```

**Response Structure**:
```json
{
  "projectRoot": "/path/to/project",
  "totalConnections": 22,
  "uniqueFiles": 5,
  "maxDepth": 3,
  "startNodeId": "proj_xxx:MethodDeclaration:abc123",
  "nodes": {
    "proj_xxx:MethodDeclaration:abc123": {
      "id": "proj_xxx:MethodDeclaration:abc123",
      "type": "HttpEndpoint",
      "filePath": "src/auth/auth.controller.ts",
      "name": "validate",
      "sourceCode": "async validate(payload) {...}",
      "hasMore": true,
      "truncated": 1250
    }
  },
  "depths": [
    {
      "depth": 1,
      "count": 8,
      "chains": [[{ "type": "HAS_MEMBER", "from": "nodeA", "to": "nodeB" }]],
      "hasMore": 3
    }
  ],
  "pagination": { "skip": 0, "limit": 50, "returned": 15, "hasNextPage": false }
}
```

**Tips**: Use specific domain terms. Node IDs from `nodes` map can be used with `traverse_from_node`.

#### 2. `traverse_from_node` - Deep Relationship Exploration
Explore connections from a specific node with depth, direction, and relationship filtering.

```typescript
traverse_from_node({
  projectId: "my-backend",
  nodeId: "proj_xxx:ClassDeclaration:abc123",  // From search results
  maxDepth: 3,              // 1-10, default 3
  direction: "OUTGOING",    // "INCOMING", "BOTH" (default)
  includeCode: true,        // false for structure-only
  summaryOnly: false,       // true for just file paths and stats
  relationshipTypes: ["INJECTS", "USES_REPOSITORY"]  // Optional filter
})
```

Returns the same JSON:API format as `search_codebase`.

#### 3. `parse_typescript_project` - Graph Generation
**Purpose**: Parse a TypeScript/NestJS project and build the graph database.

**Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | required | Path to project root directory |
| `tsconfigPath` | string | required | Path to tsconfig.json |
| `projectId` | string | auto | Override auto-generated project ID |
| `clearExisting` | boolean | true | Clear existing data (false = incremental) |
| `async` | boolean | false | Run in background Worker thread |
| `useStreaming` | enum | "auto" | "auto", "always", or "never" |
| `chunkSize` | number | 50 | Files per chunk for streaming |
| `projectType` | enum | "auto" | "auto", "nestjs", "vanilla" |
| `watch` | boolean | false | Start file watching after parse (requires `async: false`) |
| `watchDebounceMs` | number | 1000 | Debounce delay for watch mode in ms |

```typescript
// Standard parsing (blocking)
await mcp.call('parse_typescript_project', {
  projectPath: '/path/to/project',
  tsconfigPath: '/path/to/project/tsconfig.json'
});
// Returns: projectId for use in queries

// Async parsing for large projects (non-blocking)
await mcp.call('parse_typescript_project', {
  projectPath: '/path/to/large-project',
  tsconfigPath: '/path/to/large-project/tsconfig.json',
  async: true  // Returns immediately with job ID
});
// Returns: "Job ID: job_abc123... Use check_parse_status to monitor."

// Check async job progress
await mcp.call('check_parse_status', { jobId: 'job_abc123' });
// Returns: progress %, phase, nodes/edges imported

// Incremental parsing (only changed files)
await mcp.call('parse_typescript_project', {
  projectPath: '/path/to/project',
  tsconfigPath: '/path/to/project/tsconfig.json',
  clearExisting: false  // Keep existing, only reparse changed files
});

// Parse and start file watching
await mcp.call('parse_typescript_project', {
  projectPath: '/path/to/project',
  tsconfigPath: '/path/to/project/tsconfig.json',
  watch: true,           // Start watching after parse completes
  watchDebounceMs: 1000  // Wait 1s after last change before updating
});
// File changes now automatically trigger incremental graph updates
```

**Modes:**
- **Standard**: Blocks until complete, best for small-medium projects
- **Async**: Returns immediately, use `check_parse_status` to monitor
- **Streaming**: Auto-enabled for projects >100 files, prevents OOM
- **Incremental**: Set `clearExisting: false` to only reparse changed files
- **Watch**: Set `watch: true` to automatically update graph on file changes (requires sync mode)

**Performance Notes**:
- Large projects (>1000 files) should use `async: true`
- Streaming is auto-enabled for projects >100 files
- Incremental mode detects changes via mtime, size, and content hash
- Worker threads have 30-minute timeout and 8GB heap limit

#### 4. `test_neo4j_connection` - Health Check
**Purpose**: Verify database connectivity and APOC plugin availability.

```typescript
// Simple health check
await mcp.call('test_neo4j_connection');

// Response indicates database status
"Neo4j connected: Connected! at 2025-07-25T19:48:42.676Z
APOC plugin available with 438 functions"
```

#### 5. `detect_dead_code` - Code Cleanup Analysis
Find unreferenced exports, uncalled private methods, and unused interfaces.

```typescript
detect_dead_code({
  projectId: 'my-backend',
  minConfidence: 'HIGH',           // "LOW", "MEDIUM", "HIGH"
  excludePatterns: ['*.seed.ts'],  // Additional exclusions
  summaryOnly: false               // true for stats only
})
```

Returns items with `confidence` (HIGH/MEDIUM/LOW), `category` (internal-unused, library-export, ui-component), and `reason`. Automatically excludes NestJS entry points and common patterns.

#### 6. `detect_duplicate_code` - DRY Violation Detection
Find structural (identical AST) and semantic (similar embeddings) duplicates.

```typescript
detect_duplicate_code({
  projectId: 'my-backend',
  type: 'all',           // "structural", "semantic", "all"
  scope: 'methods',      // "methods", "functions", "classes", "all"
  minSimilarity: 0.85    // 0.5-1.0 threshold
})
```

Returns duplicate groups with `similarity` score, `confidence`, `category` (cross-file, same-file, cross-app), and `recommendation`.

#### 7. File Watching Tools
**Purpose**: Monitor file changes and automatically update the graph.

```typescript
// Option 1: Start watching during parse
await mcp.call('parse_typescript_project', {
  projectPath: '/path/to/project',
  tsconfigPath: '/path/to/project/tsconfig.json',
  watch: true  // Starts watching after parse completes
});

// Option 2: Start watching a previously parsed project
await mcp.call('start_watch_project', {
  projectId: 'my-backend',      // Project name, ID, or path
  debounceMs: 2000              // Optional: wait 2s after last change (default: 1000)
});

// List all active watchers
await mcp.call('list_watchers');
// Returns: watcher status, pending changes, last update time

// Stop watching a project
await mcp.call('stop_watch_project', {
  projectId: 'my-backend'
});
```

**How It Works:**
1. File watcher monitors `.ts` and `.tsx` files using native OS events
2. Changes are debounced to batch rapid edits
3. Only modified files are re-parsed (incremental)
4. Cross-file edges are preserved during updates
5. Graph updates happen automatically in the background

**Resource Limits:**
- Maximum 10 concurrent watchers
- 1000 pending events per watcher
- Graceful cleanup on server shutdown

#### 8. Swarm Coordination Tools
**Purpose**: Enable multiple parallel agents to coordinate work through stigmergic pheromone markers in the code graph—no direct messaging needed.

**Core Concepts:**
- **Pheromones**: Markers attached to graph nodes that decay over time
- **swarmId**: Groups related agents for bulk cleanup when done
- **Workflow States**: `exploring`, `claiming`, `modifying`, `completed`, `blocked` (mutually exclusive per agent+node)
- **Flags**: `warning`, `proposal`, `needs_review` (can coexist with workflow states)

**Pheromone Types & Decay:**
| Type | Half-Life | Use |
|------|-----------|-----|
| `exploring` | 2 min | Browsing/reading |
| `modifying` | 10 min | Active work |
| `claiming` | 1 hour | Ownership |
| `completed` | 24 hours | Done |
| `warning` | Never | Danger |
| `blocked` | 5 min | Stuck |
| `proposal` | 1 hour | Awaiting approval |
| `needs_review` | 30 min | Review requested |

```typescript
// Orchestrator: Generate swarm ID and spawn agents
const swarmId = `swarm_${Date.now()}`;

// Agent: Check what's claimed before working
await mcp.call('swarm_sense', {
  projectId: 'my-backend',
  swarmId,
  types: ['claiming', 'modifying']
});

// Agent: Claim a node before working
await mcp.call('swarm_pheromone', {
  projectId: 'my-backend',
  nodeId: 'proj_xxx:ClassDeclaration:abc123',  // From search_codebase or traverse_from_node
  type: 'claiming',
  agentId: 'agent_1',
  swarmId
});

// Agent: Mark complete when done
await mcp.call('swarm_pheromone', {
  projectId: 'my-backend',
  nodeId: 'proj_xxx:ClassDeclaration:abc123',
  type: 'completed',
  agentId: 'agent_1',
  swarmId,
  data: { summary: 'Added soft delete support' }
});

// Orchestrator: Clean up when swarm is done
await mcp.call('swarm_cleanup', {
  projectId: 'my-backend',
  swarmId,
  keepTypes: ['warning']  // Preserve warnings
});
```

**Important**: Node IDs must come from graph tool responses (`search_codebase`, `traverse_from_node`). Never fabricate node IDs—they are hash-based strings like `proj_xxx:ClassDeclaration:abc123`.

### Workflow Example

```typescript
// 1. Search for relevant code
const result = await search_codebase({
  projectId: 'my-backend',
  query: 'JWT token validation'
});

// 2. Get node ID from results and explore relationships
const nodeId = result.startNodeId;
const connections = await traverse_from_node({
  projectId: 'my-backend',
  nodeId,
  maxDepth: 3,
  direction: "OUTGOING"  // What this depends on
});

// 3. Assess refactoring impact
const impact = await impact_analysis({
  projectId: 'my-backend',
  nodeId
});
// Returns: risk level (LOW/MEDIUM/HIGH/CRITICAL), dependents, affected files
```

### Tips for Managing Large Responses
- Set `includeCode: false` for structure-only view
- Set `summaryOnly: true` for just file paths and statistics
- Use `relationshipTypes: ["INJECTS"]` to filter specific relationships
- Use `direction: "OUTGOING"` or `"INCOMING"` to focus exploration

## Framework Support

### NestJS Framework Schema

The server provides deep understanding of NestJS patterns:

#### Node Types
- **Controllers**: HTTP endpoint handlers with route analysis
- **Services**: Business logic providers with dependency injection mapping
- **Modules**: Application structure with import/export relationships
- **Guards**: Authentication and authorization components
- **Pipes**: Request validation and transformation
- **Interceptors**: Request/response processing middleware
- **DTOs**: Data transfer objects with validation decorators
- **Entities**: Database models with relationship mapping

#### Relationship Types
- **Module System**: `MODULE_IMPORTS`, `MODULE_PROVIDES`, `MODULE_EXPORTS`
- **Dependency Injection**: `INJECTS`, `PROVIDED_BY`
- **HTTP API**: `EXPOSES`, `ACCEPTS`, `RESPONDS_WITH`
- **Security**: `GUARDED_BY`, `TRANSFORMED_BY`, `INTERCEPTED_BY`

### Example Graph Structure

```
┌─────────────────┐    EXPOSES     ┌──────────────────┐
│   UserController│──────────────→│  POST /users     │
│   @Controller   │                │  @Post()         │
└─────────────────┘                └──────────────────┘
         │                                   │
      INJECTS                           ACCEPTS
         ↓                                   ↓
┌─────────────────┐                ┌──────────────────┐
│   UserService   │                │   CreateUserDto  │
│   @Injectable   │                │   @IsString()    │
└─────────────────┘                └──────────────────┘
         │
      MANAGES
         ↓
┌─────────────────┐
│   User Entity   │
│   @Entity()     │
└─────────────────┘
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for embeddings and LLM | Required |
| `OPENAI_ASSISTANT_ID` | Reuse existing OpenAI assistant | Optional |
| `NEO4J_URI` | Neo4j database URI | `bolt://localhost:7687` |
| `NEO4J_USER` | Neo4j username | `neo4j` |
| `NEO4J_PASSWORD` | Neo4j password | `PASSWORD` |
| `NEO4J_QUERY_TIMEOUT_MS` | Neo4j query timeout | `30000` (30s) |
| `NEO4J_CONNECTION_TIMEOUT_MS` | Neo4j connection timeout | `10000` (10s) |
| `OPENAI_EMBEDDING_TIMEOUT_MS` | Embedding API timeout | `60000` (60s) |
| `OPENAI_ASSISTANT_TIMEOUT_MS` | Assistant API timeout | `120000` (120s) |

### Parse Options

Customize parsing behavior:

```typescript
const parseOptions = {
  includePatterns: ['**/*.ts', '**/*.tsx'],
  excludePatterns: [
    'node_modules/',
    'dist/',
    'coverage/',
    '.d.ts',
    '.spec.ts',
    '.test.ts'
  ],
  maxFiles: 1000,
  frameworkSchemas: [NESTJS_FRAMEWORK_SCHEMA]
};
```

## Limitations

### Current Limitations

1. **Language Support**: Currently supports TypeScript/NestJS only
2. **Framework Support**: Primary focus on NestJS patterns (React, Angular, Vue planned)
3. **File Size**: Large files (>10MB) may cause parsing performance issues
4. **Memory Usage**: Mitigated by streaming import for large projects
5. **Vector Search**: Requires OpenAI API for semantic search functionality
6. **Response Size**: Large graph traversals can exceed token limits (25,000 tokens max)
7. **Neo4j Memory**: Database memory limits can cause query failures on large graphs

### Performance Considerations

- **Large Projects**: Use `async: true` for projects with >1000 files
- **Streaming**: Auto-enabled for >100 files to prevent memory issues
- **Graph Traversal**: Deep traversals (>5 levels) may be slow for highly connected graphs
- **Embedding Generation**: Initial parsing with embeddings can take several minutes for large codebases
- **Neo4j Memory**: Recommend at least 4GB RAM allocation for Neo4j with large graphs
- **Worker Timeout**: Async parsing has 30-minute timeout for safety

### Known Issues

1. **Complex Type Inference**: Advanced TypeScript type gymnastics may not be fully captured
2. **Dynamic Imports**: Runtime module loading not tracked in static analysis
3. **Decorator Arguments**: Complex decorator argument patterns may not be fully parsed

## Troubleshooting

### Common Issues

#### Neo4j Connection Failed
```bash
# Check if Neo4j is running
docker ps | grep neo4j

# Check Neo4j logs
docker logs codebase-neo4j

# Verify APOC plugin
curl -u neo4j:PASSWORD http://localhost:7474/db/neo4j/tx/commit \
  -H "Content-Type: application/json" \
  -d '{"statements":[{"statement":"CALL apoc.help(\"apoc\") YIELD name RETURN count(name) as count"}]}'
```

#### Neo4j Memory Issues
If you encounter errors like "allocation of an extra X MiB would use more than the limit":

```bash
# Increase Neo4j memory limits in docker-compose.yml
NEO4J_server_memory_heap_max__size=8G
NEO4J_server_memory_pagecache_size=4G
NEO4J_dbms_memory_transaction_total_max=8G

# Restart Neo4j
docker-compose restart neo4j
```

#### Token Limit Exceeded
If responses exceed token limits:

```typescript
// Reduce depth or use structure-only view
traverse_from_node({ nodeId: "...", maxDepth: 2, includeCode: false })

// Use pagination with skip
traverse_from_node({ nodeId: "...", maxDepth: 2, skip: 0 })
traverse_from_node({ nodeId: "...", maxDepth: 2, skip: 20 })
```

#### OpenAI API Issues
```bash
# Test API key
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Check embedding model availability
curl https://api.openai.com/v1/models/text-embedding-3-large \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

#### Parsing Failures
```bash
# Check TypeScript configuration
npx tsc --noEmit --project /path/to/tsconfig.json

# Verify file permissions
ls -la /path/to/project

# Check memory usage during parsing
node --max-old-space-size=8192 dist/mcp/mcp.server.js
```

### Debug Mode

Enable detailed logging:

```bash
export DEBUG=mcp:*
export NODE_ENV=development
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

## License

This project is proprietary software. All rights reserved - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- [Neo4j](https://neo4j.com/) for graph database technology
- [ts-morph](https://ts-morph.com/) for TypeScript AST manipulation
- [OpenAI](https://openai.com/) for embeddings and natural language processing
- [NestJS](https://nestjs.com/) for the framework patterns and conventions

## Support

- Create an [Issue](https://github.com/drewdrewH/code-graph-context/issues) for bug reports or feature requests
- Join the [MCP Discord](https://discord.gg/mcp) for community support
- Check the [MCP Documentation](https://modelcontextprotocol.io/docs) for MCP-specific questions

---
