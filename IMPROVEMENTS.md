# Code Graph Context - Improvements TODO

## Goal
Make code retrieval for context highly targeted and efficient. Think "infinite scroll" for code context - only load what's visible/relevant, allow AI to traverse where it sees fit, but ensure initial responses provide maximum value.

---

## Current Problems

### Search Response Issues
1. **Too much noise** - Showing "... and 6 more nodes" without context isn't helpful
2. **Repetitive parameter info** - Depth 2 shows lots of method parameters which are low-value
3. **No code snippets** - Can't see what methods actually do (disabled by default to save tokens)
4. **Limited strategic context** - Missing the "why" - what does this controller/service do? What's its role?
5. **Poor signal-to-noise ratio** - High token cost with low information density

### Graph Building Issues
6. **Inefficient graph construction** - Currently iterating over every node combination (O(n²) or worse)
7. **No relationship prioritization** - All relationships treated equally during building and traversal
8. **Memory intensive** - Large codebases can exhaust memory during parsing
9. **No incremental updates** - Full re-parse required for any changes
10. **Batch operations not optimized** - Neo4j writes could be more efficient

---

## Improvement Tasks

### Strategy 1: Filter Low-Value Relationships

**Problem**: Current traversal returns all relationships equally, creating noise and wasting tokens.

**Tasks**:
- [ ] Skip `HAS_PARAMETER` at depth 2+ (parameters are noise unless specifically needed)
- [ ] Deprioritize `DECORATED_WITH` unless it's authentication/authorization decorators
- [ ] Focus on high-value relationships: `INJECTS`, `ROUTES_TO`, `CALLS_METHOD`, `USES_REPOSITORY`
- [ ] Implement relationship importance scoring system
  - Weight by: semantic value, distance from root, node centrality
  - Store weights in constants, make configurable per framework
- [ ] Add configurable relationship filters per query type
  - Different filters for "find dependencies" vs "find usage" vs "understand flow"

**Technical Details**:
- Add `relationshipPriority` map in constants
- Filter at Cypher query level (WHERE clause), not post-processing
- Add `minPriority` parameter to traversal API
- Implement relationship blacklist/whitelist per depth level

---

### Strategy 2: Add Semantic Summaries

**Problem**: Responses lack high-level understanding of what a node does and why it matters.

**Tasks**:
- [ ] Create node-type-specific summary generators:
  - **Controllers**: Extract HTTP routes from decorators, show method + path + handler
  - **Services**: Show injected dependencies, identify CRUD vs business logic patterns
  - **Entities**: Extract database schema info (fields, types, indexes, relations)
  - **DTOs**: Parse validation decorators, show required/optional fields
- [ ] Extract business domain from file paths/class names
  - Use path segments: `modules/account` → "Account Management"
  - Parse class name prefixes: `ApiKey*` → "API Key Management"
- [ ] Generate natural language description using:
  - JSDoc comments when available
  - Class/method names (camelCase → sentence)
  - Relationship patterns (Repository → "data access", Guard → "authorization")

**Technical Details**:
- Add `NodeSummaryGenerator` service with strategy pattern per node type
- Parse decorator AST to extract metadata (HTTP methods, paths, validators)
- Cache summaries in Neo4j as node properties during initial parse
- Use property graph model: `node.summary`, `node.domain`, `node.routes`

**Example Output**:
```
Node: ApiKeyController
Type: NestJS Controller
Domain: API Key Management
Routes:
  - GET /api-keys/:id (getById)
  - PUT /api-keys/:id (update)
  - DELETE /api-keys/:id (delete)
  - DELETE /api-keys/static/:id (deleteStaticToken)
Dependencies: ApiKeyService, StaticTokenService, AccountPermissionManager
Purpose: Manages API key CRUD operations and static token lifecycle
```

---

### Strategy 3: Implement Smart Traversal

**Problem**: Fixed-depth traversal misses important distant nodes and includes irrelevant nearby noise.

**Tasks**:
- [ ] Create relationship priority system with three tiers:
  - **High priority** (always traverse, depth 1-5): `INJECTS`, `CALLS_METHOD`, `USES_REPOSITORY`, `ROUTES_TO`
  - **Medium priority** (depth 1-2 only): `HAS_MEMBER`, `RETURNS`, `THROWS`
  - **Low priority** (only on demand): `HAS_PARAMETER`, `DECORATED_WITH`, `IMPORTS`
- [ ] Implement adaptive depth based on relationship importance
  - High priority: traverse deeper automatically
  - Low priority: stop earlier unless explicitly requested
- [ ] Add "expand this path" capability for drilling down specific relationships
  - Return node IDs with "expandable" flag
  - Provide `expandPath(nodeId, relationshipType)` API
- [ ] Create relationship filtering at query time (not just display time)
  - Build dynamic Cypher queries based on relationship priorities
  - Use `apoc.path.expandConfig` with relationship filters

**Technical Details**:
- Modify Cypher query to use `apoc.path.expandConfig` with relationship type filters
- Add `relationshipPriorities` config:
  ```typescript
  const RELATIONSHIP_PRIORITIES = {
    INJECTS: { priority: 'HIGH', maxDepth: 5 },
    HAS_PARAMETER: { priority: 'LOW', maxDepth: 1 },
    // ...
  };
  ```
- Implement variable depth per relationship type in single query
- Add `traversalStrategy` parameter: 'COMPREHENSIVE' | 'FOCUSED' | 'MINIMAL'

---

### Strategy 4: Add Code Snippets Strategically

**Problem**: Either no code (can't understand implementation) or full code (token waste).

**Tasks**:
- [ ] Show method signatures (not full implementation) by default
  - Parse AST to extract: name, parameters, return type, modifiers
  - Format: `async getById(id: string): Promise<ApiKey>`
- [ ] Add "preview" mode with first 3-5 lines of method body
  - Skip variable declarations, focus on logic (conditionals, calls, returns)
- [ ] Only show full code when specifically requested via `includeCode: true`
- [ ] Implement smart snippet extraction
  - Skip imports/comments
  - Identify and extract key logic blocks (if/else, loops, error handling)
  - Show method calls to other services (high value for understanding flow)
- [ ] Add syntax highlighting hints for better readability
  - Return code with language tag: ` ```typescript `
  - Include line numbers from original file

**Technical Details**:
- Use `ts-morph` to extract method signatures without implementation
- Implement snippet extraction at parse time, store in `node.signature` property
- Add `snippetMode` parameter: 'SIGNATURE' | 'PREVIEW' | 'FULL'
- For preview mode: parse method body AST, extract first N statements excluding declarations
- Token estimation: signature ~20 tokens, preview ~100 tokens, full ~500+ tokens

---

### Strategy 5: Response Format Improvements

**Problem**: Long flat lists are hard to scan, important information buried in noise.

**Tasks**:
- [ ] Make output more scannable with better markdown structure
  - Use tables for structured data (routes, dependencies)
  - Add clear section hierarchy
- [ ] Add collapsible sections for low-priority information
  - Mark sections with priority level
  - LLM can choose to skip low-priority sections
- [ ] Include quick stats at the top
  - "10 methods, 4 dependencies, 5 routes"
  - "High complexity: 3 critical paths identified"
- [ ] Add relevance indicators
  - HIGH / MEDIUM / LOW prefix on each connection
  - Sort by relevance within each section
- [ ] Group connections by semantic meaning, not just relationship type
  - "Data Access Layer" (repositories)
  - "Business Logic" (service calls)
  - "API Surface" (routes, controllers)

**Technical Details**:
- Refactor `TraversalHandler.formatTraversalResult()` method
- Create markdown table generator utility
- Add grouping logic: analyze relationship chains to identify patterns
- Implement progressive disclosure: summary → details → full code
- Token budget: aim for 80% reduction in default output vs current

---

### Strategy 6: Add Relevance Scoring

**Problem**: All nodes treated equally regardless of importance to understanding the codebase.

**Tasks**:
- [ ] Implement scoring algorithm for nodes based on:
  - **Relationship type importance**: INJECTS (0.9) > HAS_MEMBER (0.5) > HAS_PARAMETER (0.1)
  - **Distance from starting node**: score = 1.0 / (1 + depth * 0.3)
  - **Node type**: Controller (0.9) > Service (0.8) > Utility (0.5) > Interface (0.3)
  - **Centrality in graph**: PageRank or betweenness centrality
  - **Code metrics**: Lines of code, cyclomatic complexity
- [ ] Sort connections by relevance score (descending)
- [ ] Add "Top 5 Most Relevant" section to traversal results
  - Show highest-scoring nodes regardless of relationship type
  - Useful for "what's important here?" questions
- [ ] Use scores to auto-filter noise
  - Set threshold: only show nodes with score > 0.3
  - Make threshold configurable per query

**Technical Details**:
- Calculate scores in Cypher query:
  ```cypher
  MATCH path = (start)-[*1..3]-(connected)
  WITH connected, length(path) as depth,
       relationships(path) as rels
  RETURN connected,
         reduce(score = 1.0, r in rels |
           score * RELATIONSHIP_WEIGHT[type(r)]) / (1 + depth * 0.3)
         as relevanceScore
  ORDER BY relevanceScore DESC
  ```
- Pre-calculate centrality metrics during graph building
- Store as node properties: `node.pageRank`, `node.betweenness`
- Add `minRelevanceScore` parameter to traversal API

---

## Graph Building Optimizations

### Smart Graph Construction

**Problem**: Current approach has O(n²) complexity, doesn't scale to large codebases.

**Tasks**:
- [ ] **Stop iterating over every node combination**
  - Current: Nested loops checking all node pairs for relationships
  - Target: Single-pass relationship detection using AST visitor pattern
- [ ] Use AST visitor pattern more efficiently
  - Only traverse relevant parts of AST (skip types, interfaces unless referenced)
  - Skip node_modules, test files, generated code by default
  - Add configurable include/exclude patterns
- [ ] Implement incremental parsing
  - Track file modification times / git diff
  - Only re-parse changed files
  - Keep existing graph structure for unchanged files
  - Handle cascading updates (if interface changes, update implementers)
- [ ] Add parsing performance metrics/logging
  - Track time per file, relationships/second
  - Identify bottlenecks with profiling
  - Log slow files (>1s parse time) for investigation

**Technical Details**:
- Refactor `TypeScriptParserV2.parseWorkspace()`:
  - Remove nested loops over nodes
  - Build relationship detection into AST visitor itself
  - Use symbol resolver to find references (built-in to ts-morph)
- Add `IncrementalParseStrategy`:
  - Query Neo4j for existing file hashes
  - Compare with current file hashes (SHA-256)
  - Build dependency graph of files (imports)
  - Re-parse changed files + direct dependents
- Implement `ParsingMetrics` class:
  - Track: filesProcessed, nodesCreated, relationshipsCreated, totalTime
  - Log percentiles: p50, p95, p99 parse times
  - Export metrics to structured log for analysis

---

### Relationship Building Optimization

**Problem**: Relationship creation is inefficient, multiple passes, not utilizing Neo4j batch capabilities.

**Tasks**:
- [ ] Build relationships in single pass where possible
  - Detect relationships during AST traversal, not post-processing
  - Use visitor pattern that emits relationship events
- [ ] Use caching for frequently looked-up nodes
  - In-memory Map: `symbolName -> nodeId`
  - LRU cache with configurable size (default 10k nodes)
- [ ] Batch Neo4j writes more efficiently
  - Current batch size: 500, may be too small
  - Benchmark and tune: test 1k, 5k, 10k batch sizes
  - Use `UNWIND` for bulk relationship creation
- [ ] Create indexes on frequently queried fields
  - Index `node.id` (unique)
  - Index `node.name` for symbol lookup
  - Index `node.filePath` for file-based queries
  - Composite index on `(type, name)` for type-specific queries
- [ ] Implement lazy relationship creation
  - Build only high-priority relationships during parse
  - Create low-priority relationships on-demand during query
  - Example: `HAS_PARAMETER` only created when specifically requested

**Technical Details**:
- Refactor `GraphBuilder` to emit relationship events:
  ```typescript
  class RelationshipBuilder {
    private buffer: Relationship[] = [];

    addRelationship(from: string, to: string, type: string) {
      this.buffer.push({ from, to, type });
      if (this.buffer.length >= BATCH_SIZE) {
        this.flush();
      }
    }
  }
  ```
- Add Neo4j indexes at startup:
  ```cypher
  CREATE INDEX node_id IF NOT EXISTS FOR (n:Node) ON (n.id);
  CREATE INDEX node_name IF NOT EXISTS FOR (n:Node) ON (n.name);
  CREATE CONSTRAINT unique_node_id IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE;
  ```
- Benchmark batch sizes with timing metrics
- Implement lazy relationship loading:
  - Mark relationship types as lazy in schema
  - Create on first access via traversal query
  - Cache result in graph

---

### Memory Optimization

**Problem**: Large codebases cause OOM errors during parsing.

**Tasks**:
- [ ] Stream large files instead of loading entirely
  - Use streaming JSON parser for large AST
  - Process file in chunks if >1MB
- [ ] Process in chunks for large codebases
  - Break codebase into modules/packages
  - Parse one module at a time
  - Clear memory between modules
- [ ] Add memory usage monitoring
  - Track: `process.memoryUsage().heapUsed`
  - Log memory before/after each file parse
  - Alert if memory usage exceeds 80% of limit
- [ ] Implement garbage collection hints for large parsing operations
  - Call `global.gc()` between large batches (if --expose-gc enabled)
  - Clear caches periodically during long-running parses
- [ ] Add configurable memory limits with graceful degradation
  - Env var: `MAX_MEMORY_MB` (default: 4096)
  - If approaching limit: skip non-critical nodes (tests, mocks)
  - Fallback to minimal parsing mode (only classes/functions, no details)

**Technical Details**:
- Add `MemoryMonitor` class:
  ```typescript
  class MemoryMonitor {
    checkMemoryUsage() {
      const used = process.memoryUsage().heapUsed / 1024 / 1024;
      const limit = parseInt(process.env.MAX_MEMORY_MB || '4096');
      if (used > limit * 0.8) {
        this.triggerGracefulDegradation();
      }
    }
  }
  ```
- Implement streaming parser for large files using `ts-morph` lazy loading
- Add chunking strategy:
  - Group files by module (package.json workspaces)
  - Parse module 1 → write to Neo4j → clear AST → parse module 2
- Enable explicit GC:
  - Run node with `--expose-gc` flag
  - Call `global.gc()` after each module
- Add memory profiling with `--inspect` and Chrome DevTools

---

## Implementation Priority

### Phase 1: Quick Wins (High Impact, Low Effort)
**Goal**: Immediate improvement in response quality with minimal refactoring.

1. Filter `HAS_PARAMETER` at depth 2+
   - Modify Cypher query to exclude this relationship type at depth > 1
   - Estimated time: 2 hours
2. Add basic node type summaries (Controller, Service)
   - Extract route info from decorator AST
   - Store in `node.summary` property
   - Estimated time: 4 hours
3. Sort by relationship importance
   - Add ORDER BY clause based on relationship type weights
   - Estimated time: 1 hour

**Expected Impact**: 50% reduction in token usage, 2x improvement in information density

---

### Phase 2: Core Improvements (High Impact, Medium Effort)
**Goal**: Fundamentally improve graph building and traversal algorithms.

1. Implement relationship priority system
   - Define priority levels for all relationship types
   - Build dynamic Cypher queries based on priorities
   - Estimated time: 8 hours
2. Add relevance scoring
   - Calculate scores in Cypher query
   - Store centrality metrics in graph
   - Estimated time: 12 hours
3. Create smart summary generators
   - Build NodeSummaryGenerator service
   - Implement strategy pattern for each node type
   - Estimated time: 16 hours
4. Optimize graph building (stop node combination iteration)
   - Refactor to single-pass visitor pattern
   - Remove O(n²) nested loops
   - Estimated time: 20 hours

**Expected Impact**: 10x faster parsing, 3x improvement in response quality

---

### Phase 3: Advanced Features (Medium Impact, High Effort)
**Goal**: Production-ready scalability and usability improvements.

1. Incremental parsing
   - File hash tracking in Neo4j
   - Dependency graph for cascading updates
   - Estimated time: 24 hours
2. Advanced semantic analysis
   - Business domain extraction
   - Pattern recognition (CRUD, auth, etc.)
   - Estimated time: 32 hours
3. Interactive expansion/drilling
   - Add expandPath API
   - Frontend integration support
   - Estimated time: 16 hours
4. Performance profiling and optimization
   - Add metrics collection
   - Benchmark suite
   - Continuous optimization based on metrics
   - Estimated time: 20 hours

**Expected Impact**: Support for codebases >100k LOC, sub-second query response times

---

## Technical Notes

### Token Budget Awareness
- Target: <2000 tokens per response (currently ~5000+)
- Calculate token cost for each output element
- Provide configurable verbosity levels: MINIMAL | NORMAL | VERBOSE
- Add token estimation to response metadata

### Progressive Disclosure
- Start with minimal summary (200 tokens)
- Provide node IDs for expansion
- Allow drilling down specific paths on demand
- Cache expanded results for session

### Context-Aware Responses
- Different query intents need different information:
  - "Find dependencies" → focus on INJECTS, USES_REPOSITORY
  - "Understand flow" → focus on CALLS_METHOD chains
  - "Find usage" → focus on incoming relationships
- Implement query intent detection or explicit query type parameter

### Performance First
- Target metrics:
  - Parse time: <10s per 1000 files
  - Query response: <500ms for depth 3 traversal
  - Memory usage: <2GB for 50k LOC codebase
- Fast responses > comprehensive responses
- Use async/streaming where possible

### Lazy Loading Strategy
- Don't compute what won't be used
- Example: Only calculate PageRank if relevance scoring is enabled
- Example: Only extract code snippets if includeCode is true
- Cache expensive computations

---

## Open Questions

### Technical Questions
1. **Caching strategy**: Should we cache popular traversal paths in Redis? Or rely on Neo4j query cache?
2. **Circular dependencies**: How to handle in traversal? Mark as "circular" and stop? Or continue with visited set?
3. **Optimal default depth**: What's the right default for Controllers vs Services vs Utilities?
4. **ML/AI integration**: Should we use embeddings to learn which relationships are most valuable per query type?
5. **Token efficiency**: How to balance comprehensive context vs token limits in LLM context windows?

### Architecture Questions
6. **Incremental updates**: Should we use file watchers for real-time updates? Or manual refresh?
7. **Distributed parsing**: For very large codebases, should we support distributed parsing across multiple workers?
8. **Schema evolution**: How to handle breaking changes to graph schema without re-parsing everything?
9. **Multi-language support**: Should we abstract parser interface for future non-TypeScript support?

### Product Questions
10. **User feedback loop**: How do we measure which improvements actually help LLM understanding?
11. **Configuration complexity**: Too many options = hard to use. What are essential vs advanced options?
12. **Default behavior**: Should defaults optimize for speed or comprehensiveness?
