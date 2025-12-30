# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - Multi-Project Support - 2024-12-30

### Added

#### Multi-Project Isolation
- **Project ID System**: All nodes now include a `projectId` prefix (`proj_<12-hex-chars>`) enabling complete data isolation between projects in a single Neo4j database
- **Deterministic ID Generation**: Same project path always generates the same projectId, ensuring reproducibility across reparses
- **Flexible Project Resolution**: All query tools accept project ID, project name, or project path - resolved automatically via `resolveProjectIdFromInput()`

#### New MCP Tools
- **`list_projects`**: List all parsed projects in the database with status, node/edge counts, and timestamps
- **`check_parse_status`**: Monitor async parsing jobs with real-time progress (phase, files processed, chunks, nodes/edges created)
- **`start_watch_project`**: Start file watching for a parsed project with configurable debounce
- **`stop_watch_project`**: Stop file watching for a project by ID
- **`list_watchers`**: List all active file watchers with status, pending changes, and last update time

#### File Watching & Live Updates
- **Real-Time File Monitoring**: Uses `@parcel/watcher` for cross-platform native file watching
- **Watch Mode in parse_typescript_project**: New `watch: true` parameter starts watching after synchronous parse (requires `async: false`)
- **Automatic Incremental Updates**: File changes trigger re-parsing of only affected files
- **Debounced Processing**: Configurable debounce delay (`watchDebounceMs`, default 1000ms) batches rapid file changes
- **Cross-File Edge Preservation**: Edges between changed and unchanged files are preserved during incremental updates
- **Graceful Shutdown**: SIGINT/SIGTERM handlers ensure watchers are properly cleaned up
- **Resource Limits**: Maximum 10 concurrent watchers, 1000 pending events per watcher

#### Async & Streaming Parsing
- **Async Parsing Mode**: New `async: true` parameter runs parsing in Worker threads without blocking the MCP server. Returns job ID for status monitoring
- **Streaming Import**: Large projects (>100 files) automatically use chunked processing to prevent OOM errors. Configurable via `useStreaming` and `chunkSize` parameters
- **Worker Thread Isolation**: Background parsing with 8GB heap limit and 30-minute timeout protection
- **Progress Reporting**: Real-time progress updates through all phases: discovery → parsing → importing → resolving → complete

#### Workspace & Monorepo Support
- **Auto-Detection**: Automatically detects workspace type (Turborepo, pnpm, Yarn workspaces, npm workspaces, or single project)
- **WorkspaceParser**: New parser that handles monorepo structures, discovering and parsing all packages
- **Package Discovery**: Reads workspace configuration from `turbo.json`, `pnpm-workspace.yaml`, or `package.json` workspaces field

#### Incremental Parsing
- **Change Detection**: Detects file changes using mtime, size, and content hash comparison
- **Selective Reparse**: Only reparses files that have actually changed when `clearExisting: false`
- **Cross-File Edge Preservation**: Saves and recreates edges between changed and unchanged files

#### Impact Analysis Enhancements
- **File-Based Analysis**: Analyze impact of entire files, not just individual nodes
- **Risk Scoring System**: Four-factor scoring (dependent count, relationship weights, high-risk types, transitive impact) producing LOW/MEDIUM/HIGH/CRITICAL risk levels
- **Relationship Weights**: Configurable weights for different relationship types (EXTENDS: 0.95, CALLS: 0.75, IMPORTS: 0.5, etc.)
- **Framework Configuration**: Custom `frameworkConfig` parameter for framework-specific risk assessment

#### New Utility Modules
- **`src/core/utils/project-id.ts`**: Project ID generation, validation, and resolution utilities
- **`src/core/utils/retry.ts`**: Generic retry wrapper with exponential backoff and jitter
- **`src/core/utils/progress-reporter.ts`**: Structured progress tracking through parsing phases
- **`src/core/utils/path-utils.ts`**: Path normalization, relative path conversion, common root detection
- **`src/core/config/timeouts.ts`**: Centralized timeout configuration with environment variable overrides

#### Infrastructure
- **Project Node Tracking**: Creates `Project` nodes in Neo4j tracking status (parsing/complete/failed), node counts, edge counts, and timestamps
- **Job Manager**: In-memory job tracking with automatic cleanup (1 hour TTL, 100 job max limit)
- **Cross-Chunk Edge Resolution**: Handles edges that span multiple parse chunks in streaming mode

### Changed

#### Tool Parameter Changes
- **`search_codebase`**: Now requires `projectId` parameter; added `useWeightedTraversal` (default: true) and improved similarity scoring
- **`traverse_from_node`**: Now requires `projectId` parameter; added `filePath` as alternative to `nodeId` for file-based traversal
- **`impact_analysis`**: Now requires `projectId` parameter; added `frameworkConfig` for custom relationship weights and high-risk type configuration
- **`natural_language_to_cypher`**: Now requires `projectId` parameter; added security validations and framework detection

#### Parser Improvements
- **Lazy Loading Mode**: New `lazyLoad` constructor option enables just-in-time file loading for large projects
- **Streaming Interface**: New `StreamingParser` interface with `discoverSourceFiles()`, `parseChunk()`, `resolveDeferredEdgesManually()` methods
- **Existing Nodes Support**: Parser can now load existing nodes from Neo4j for accurate edge target matching during incremental parsing

#### Neo4j Service
- Added 15+ new Cypher queries for:
  - Project management (`CLEAR_PROJECT`, `UPSERT_PROJECT_QUERY`, `UPDATE_PROJECT_STATUS_QUERY`)
  - Incremental parsing (`GET_CROSS_FILE_EDGES`, `DELETE_SOURCE_FILE_SUBGRAPHS`, `RECREATE_CROSS_FILE_EDGES`)
  - Discovery (`DISCOVER_NODE_TYPES`, `DISCOVER_RELATIONSHIP_TYPES`, `DISCOVER_SEMANTIC_TYPES`, `DISCOVER_COMMON_PATTERNS`)
  - Impact analysis (`GET_NODE_IMPACT`, `GET_FILE_IMPACT`, `GET_TRANSITIVE_DEPENDENTS`)
  - Weighted traversal with scoring (edge weight × node similarity × depth penalty)

#### Natural Language to Cypher
- Enhanced prompt instructions with multi-project isolation requirements
- Auto-detects framework type based on graph composition
- Schema context injection for better query generation
- Improved handling of class/service names vs labels

### Security

- **Path Traversal Protection**: Symlink resolution and project boundary validation prevents escaping project directory
- **Cypher Injection Prevention**: Relationship type validation using regex pattern `/^[A-Z_]+$/`
- **ReDoS Protection**: Regex character escaping in decorator parsing
- **Worker Thread Timeout**: 30-minute timeout prevents indefinitely hanging workers
- **Job Manager Limits**: Maximum 100 concurrent jobs prevents memory exhaustion
- **Session Closure Fix**: Neo4j session close wrapped in try-catch to preserve original errors
- **Log Sanitization**: Sensitive data (prompts, API errors) no longer logged in full
- **Input Validation**: Path existence validation before processing in parse tool
- **Neo4j Connection Cleanup**: All tools now properly close Neo4j connections in finally blocks

### Breaking Changes

#### projectId Required
All query tools now require a `projectId` parameter:
```typescript
search_codebase({ projectId, query, ... })
traverse_from_node({ projectId, nodeId, ... })
impact_analysis({ projectId, nodeId, ... })
natural_language_to_cypher({ projectId, prompt })
```

#### Node ID Format Change
Node IDs now include project prefix:
- **Old format**: `CoreType:hash` (e.g., `ClassDeclaration:abc123`)
- **New format**: `proj_xxx:CoreType:hash` (e.g., `proj_a1b2c3d4e5f6:ClassDeclaration:abc123`)

#### Database Incompatibility
Existing graphs created with previous versions are **not compatible** with this release:
- Old node IDs won't match new query patterns
- Queries will fail to find nodes without projectId filter

### Migration Guide

1. **Clear and Re-parse**: Clear your Neo4j database and re-parse all projects
   ```bash
   # Projects will auto-generate projectId from path
   ```

2. **Update Tool Calls**: Add `projectId` to all query tool invocations
   ```typescript
   // Before
   search_codebase({ query: "UserService" })

   // After
   search_codebase({ projectId: "my-project", query: "UserService" })
   ```

3. **Discover Projects**: Use `list_projects` to see available projects and their IDs
   ```
   list_projects()
   → Shows: name, projectId, path, status, node/edge counts
   ```

4. **Use Friendly Names**: You can use project names instead of full IDs
   ```typescript
   // These are equivalent:
   search_codebase({ projectId: "proj_a1b2c3d4e5f6", query: "..." })
   search_codebase({ projectId: "my-backend", query: "..." })
   search_codebase({ projectId: "/path/to/my-backend", query: "..." })
   ```

---

## [1.1.0] - 2024-12-15

### Added
- `impact_analysis` tool for dependency risk assessment
- Graph efficiency improvements

---

## [0.1.0] - 2025-01-13

### Added
- Initial release of Code Graph Context MCP server
- TypeScript codebase parsing with AST analysis
- Neo4j graph storage with vector indexing
- Semantic search using OpenAI embeddings
- 6 MCP tools for code exploration:
  - `hello` - Test connection
  - `test_neo4j_connection` - Verify Neo4j connectivity
  - `parse_typescript_project` - Parse codebases into graph
  - `search_codebase` - Vector-based semantic search
  - `traverse_from_node` - Graph relationship traversal
  - `natural_language_to_cypher` - AI-powered Cypher query generation
- Framework-aware parsing with customizable patterns
- Custom framework schema system (with FairSquare example)
- Auto-detection of project framework types
- Docker Compose setup for Neo4j with APOC plugin
- Comprehensive README with examples and workflows

### Framework Support
- Decorator-based frameworks (Controllers, Services, Modules, Guards, Pipes, Interceptors, DTOs, Entities)
- Custom framework schema system (see FairSquare example)
- Vanilla TypeScript projects

### Infrastructure
- MIT License
- Contributing guidelines
- Example projects and custom framework templates
- Environment configuration via `.env`
- Debug logging for troubleshooting

---

[1.2.0]: https://github.com/drewdrewH/code-graph-context/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/drewdrewH/code-graph-context/compare/v0.1.0...v1.1.0
[0.1.0]: https://github.com/drewdrewH/code-graph-context/releases/tag/v0.1.0
