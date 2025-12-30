/**
 * MCP Server Constants
 * All constants used throughout the MCP server implementation
 */

// Server Configuration
export const MCP_SERVER_CONFIG = {
  name: 'codebase-graph',
  version: '1.0.0',
} as const;

// File Paths
export const FILE_PATHS = {
  debugLog: 'debug-search.log',
  schemaOutput: 'neo4j-apoc-schema.json',
  graphOutput: 'graph.json',
} as const;

// Tool Names
export const TOOL_NAMES = {
  hello: 'hello',
  searchCodebase: 'search_codebase',
  naturalLanguageToCypher: 'natural_language_to_cypher',
  traverseFromNode: 'traverse_from_node',
  parseTypescriptProject: 'parse_typescript_project',
  testNeo4jConnection: 'test_neo4j_connection',
  impactAnalysis: 'impact_analysis',
  checkParseStatus: 'check_parse_status',
  listProjects: 'list_projects',
} as const;

// Tool Metadata
export const TOOL_METADATA = {
  [TOOL_NAMES.hello]: {
    title: 'Hello Tool',
    description: 'Test tool that says hello',
  },
  [TOOL_NAMES.searchCodebase]: {
    title: 'Search Codebase',
    description: `Search the codebase using semantic similarity to find relevant code, functions, classes, and implementations.

**Before searching:**
Use list_projects to see available projects and get the project name/ID to search.

Returns normalized JSON with source code snippets. Uses JSON:API pattern to deduplicate nodes.

**Default Usage (Recommended)**:
Start with default parameters for richest context in a single call. Most queries complete successfully.

Parameters:
- query: Natural language description of what you're looking for

**Token Optimization (Only if needed)**:
Use these parameters ONLY if you encounter token limit errors (>25,000 tokens):

- maxDepth (default: 3): Reduce to 1-2 for shallow exploration
- maxNodesPerChain (default: 5): Limit chains shown per depth level
- includeCode (default: true): Set false to get structure only, fetch code separately
- snippetLength (default: 700): Reduce to 400-600 for smaller code snippets
- skip (default: 0): For pagination (skip N results)

**Progressive Strategy**:
1. Try with defaults first
2. If token error: Use maxDepth=1, includeCode=false for structure
3. Then traverse deeper or Read specific files for full code

**Compact Mode** (for exploration without full source code):
- includeCode: false → Returns just names, types, and file paths
- snippetLength: 200 → Smaller code previews
- maxNodesPerChain: 2 → Fewer relationship chains per depth`,
  },
  [TOOL_NAMES.naturalLanguageToCypher]: {
    title: 'Natural Language to Cypher',
    description: `Convert natural language queries into Cypher queries for Neo4j.

**Before using:**
Use list_projects to see available projects and get the project name.

**When to use:**
- For complex queries that search_codebase can't handle
- When you need custom filtering or aggregation
- To explore specific relationship patterns

**Parameters:**
- projectId: Project name, path, or ID (use list_projects to find)
- query: Natural language description of what you want to find

**Examples:**
- "Find all classes with more than 5 methods"
- "List functions that have more than 3 parameters"
- "Find files that import from a path containing 'utils'"
- "Show interfaces with 'Response' in their name"
- "Find all exported functions"

**Tips:**
- Import nodes store file paths, not module names (use 'path containing X')
- Node types: SourceFile, ClassDeclaration, FunctionDeclaration, MethodDeclaration, InterfaceDeclaration
- Relationships: CONTAINS, IMPORTS, HAS_PARAMETER, IMPLEMENTS, EXTENDS, HAS_MEMBER
- For NestJS, use semanticType property instead of decorators (e.g., semanticType = 'NestController')

**Query Phrasing:**
Phrase queries using properties known to exist (filePath, name) rather than abstract concepts:
- Use "in account folder" or "filePath contains /account/" instead of "in account module"
- Use "classes extending DbService" not "services that extend DbService" (Service is a decorator, not a type)
- Use "with name containing 'Controller'" instead of "controllers"
The tool performs better with concrete, schema-aligned language.`,
  },
  [TOOL_NAMES.traverseFromNode]: {
    title: 'Traverse from Node',
    description: `Traverse the graph starting from a specific node ID to explore its connections and relationships in detail.

Parameters:
- nodeId (required): The node ID to start traversal from (obtained from search_codebase)
- maxDepth (default: 3): How many relationship hops to traverse (1-10)
- skip (default: 0): Number of results to skip for pagination

Advanced options (use when needed):
- includeCode (default: true): Set to false for structure-only view without source code
- maxNodesPerChain (default: 5): Limit chains shown per depth level (applied independently at each depth)
- summaryOnly: Set to true for just file paths and statistics without detailed traversal

Best practices:
- Use list_projects first to see available projects
- Start with search_codebase to find initial nodes
- Default includes source code snippets for immediate context
- Set includeCode: false for high-level architecture view only
- Use summaryOnly: true for a quick overview of many connections

**Compact Mode** (for exploration without full source code):
- summaryOnly: true → Returns only file paths and statistics
- includeCode: false → Structure without source code
- snippetLength: 200 → Smaller code previews
- maxTotalNodes: 20 → Limit total unique nodes returned`,
  },
  [TOOL_NAMES.parseTypescriptProject]: {
    title: 'Parse TypeScript Project',
    description: `Parse a TypeScript/NestJS project and build a code graph in Neo4j.

**IMPORTANT: Always use async mode for parsing:**
- Set async: true to avoid timeouts on large codebases
- Use check_parse_status to monitor progress

**Workflow:**
1. Call with async: true and projectPath
2. Note the returned jobId
3. Poll check_parse_status({ jobId }) until completed
4. Use list_projects to confirm the project was added

**Parameters:**
- projectPath (required): Absolute path to the project root
- async (recommended: true): Run parsing in background
- clearExisting: Set true to replace existing graph for this project
- projectId: Optional custom ID (auto-generated from path if omitted)

**Example:**
parse_typescript_project({ projectPath: "/path/to/project", async: true })
→ Returns jobId for polling`,
  },
  [TOOL_NAMES.testNeo4jConnection]: {
    title: 'Test Neo4j Connection & APOC',
    description: 'Test connection to Neo4j database and verify APOC plugin is available',
  },
  [TOOL_NAMES.impactAnalysis]: {
    title: 'Impact Analysis',
    description: `Analyze the impact of modifying a code node. Shows what depends on this node and helps assess risk before making changes.

**Before analyzing:**
Use list_projects to see available projects and get the project name.

Returns:
- Risk level (LOW/MEDIUM/HIGH/CRITICAL) based on dependency count and relationship types
- Direct dependents: nodes that directly reference the target
- Transitive dependents: nodes affected through dependency chains
- Affected files: list of files that would need review
- Critical paths: high-risk dependency chains

Parameters:
- nodeId: Node ID from search_codebase or traverse_from_node results
- filePath: Alternative - analyze all exports from a file
- maxDepth: How far to trace transitive dependencies (default: 4)

Use this before refactoring to understand blast radius of changes.`,
  },
  [TOOL_NAMES.checkParseStatus]: {
    title: 'Check Parse Status',
    description: `Check the status of an async parsing job started with parse_typescript_project({ async: true }).

Returns:
- Job status (pending/running/completed/failed)
- Progress: phase, files processed, chunks completed
- Nodes and edges imported so far
- Final result on completion or error message on failure

Use this to poll for progress when parsing large codebases asynchronously.`,
  },
  [TOOL_NAMES.listProjects]: {
    title: 'List Projects',
    description: `List all parsed projects in the database with their IDs, names, and paths.

Returns:
- projectId: The full project ID (e.g., "proj_a1b2c3d4e5f6")
- name: Friendly project name from package.json (e.g., "any-backend")
- path: Full filesystem path to the project
- updatedAt: When the project was last parsed

Use the name or path in other tools instead of the cryptic projectId.`,
  },
} as const;

// Default Values
export const DEFAULTS = {
  traversalDepth: 3,
  skipOffset: 0,
  batchSize: 500,
  maxResultsDisplayed: 30,
  codeSnippetLength: 500, // Reduced from 1000 to control output size
  chainSnippetLength: 700,
  maxEmbeddingChars: 30000, // ~7500 tokens, under 8192 limit for text-embedding-3-large
} as const;

// Messages
export const MESSAGES = {
  errors: {
    noRelevantCode: 'No relevant code found.',
    serviceNotInitialized:
      'ERROR: Natural Language to Cypher service is not initialized yet. Please try again in a few moments.',
    connectionTestFailed: 'Connection test failed',
    neo4jRequirement: 'Note: This server requires Neo4j with APOC plugin installed',
    genericError: 'ERROR:',
  },
  success: {
    hello: 'Hello from codebase MCP!',
    parseSuccess: 'SUCCESS:',
    partialSuccess: 'PARTIAL SUCCESS:',
  },
  queries: {
    naturalLanguagePrefix: 'Natural Language Query:',
    cypherQueryHeader: 'Generated Cypher Query',
    queryResultsHeader: 'Query Results',
    noResultsFound: 'No results found for this query.',
    moreResultsIndicator: '_... and {} more results_',
    summaryPrefix: '**Summary:** Executed query and found {} results.',
  },
  neo4j: {
    connectionTest: 'RETURN "Connected!" as message, datetime() as timestamp',
    apocTest: 'CALL apoc.help("apoc") YIELD name RETURN count(name) as apocFunctions',
    connectionSuccess: 'Neo4j connected: {} at {}\nAPOC plugin available with {} functions',
  },
  server: {
    starting: '=== MCP Server Starting ===',
    connected: '=== MCP Server Connected and Running ===',
    creatingTransport: 'Creating transport...',
    connectingTransport: 'Connecting server to transport...',
    startingServer: 'Starting MCP server...',
  },
} as const;

// Logging Configuration
export const LOG_CONFIG = {
  timestampFormat: 'iso',
  logSeparator: '---',
  jsonIndentation: 2,
} as const;
