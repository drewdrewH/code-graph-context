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

IMPORTANT: This tool returns a COMPACT view (no code snippets, maxDepth: 3, maxNodesPerChain: 4) to avoid context overflow. It shows file paths, node IDs, and relationship chains.

Parameters:
- query: Natural language description of what you're looking for
- limit (default: 10): Number of initial vector search results to consider

Use this for initial exploration. For detailed code inspection, use traverse_from_node with the returned node IDs and set includeCode: true.`,
  },
  [TOOL_NAMES.naturalLanguageToCypher]: {
    title: 'Natural Language to Cypher',
    description: 'Convert natural language queries into Cypher queries for Neo4j. This tool is useful for generating specific queries based on user requests about the codebase.',
  },
  [TOOL_NAMES.traverseFromNode]: {
    title: 'Traverse from Node',
    description: `Traverse the graph starting from a specific node ID to explore its connections and relationships in detail.

Parameters:
- nodeId (required): The node ID to start traversal from (obtained from search_codebase)
- maxDepth (default: 3): How many relationship hops to traverse (1-10)
- skip (default: 0): Number of results to skip for pagination

Advanced options (use when needed):
- includeCode: Set to true to see actual source code snippets (WARNING: uses more context)
- maxNodesPerChain: Limit nodes shown per relationship chain (default: varies)
- summaryOnly: Set to true for just file paths and statistics without detailed traversal

Best practices:
- Start with search_codebase to find initial nodes
- Use this tool with default params for detailed exploration
- Only set includeCode: true when you need to see actual code
- Use summaryOnly: true for a quick overview of many connections`,
  },
  [TOOL_NAMES.parseTypescriptProject]: {
    title: 'Parse TypeScript Project',
    description: 'Parse a TypeScript/NestJS project and store in Neo4j graph',
  },
  [TOOL_NAMES.testNeo4jConnection]: {
    title: 'Test Neo4j Connection & APOC',
    description: 'Test connection to Neo4j database and verify APOC plugin is available',
  },
} as const;

// Default Values
export const DEFAULTS = {
  searchLimit: 10,
  traversalDepth: 3,
  skipOffset: 0,
  batchSize: 500,
  maxResultsDisplayed: 20,
  codeSnippetLength: 800,
  chainSnippetLength: 800,
} as const;

// Messages
export const MESSAGES = {
  errors: {
    noRelevantCode: 'No relevant code found.',
    serviceNotInitialized: '❌ ERROR: Natural Language to Cypher service is not initialized yet. Please try again in a few moments.',
    connectionTestFailed: 'Connection test failed',
    neo4jRequirement: 'Note: This server requires Neo4j with APOC plugin installed',
    genericError: '❌ ERROR:',
  },
  success: {
    hello: 'Hello from codebase MCP!',
    parseSuccess: '✅ SUCCESS:',
    partialSuccess: '⚠️ PARTIAL SUCCESS:',
  },
  queries: {
    naturalLanguagePrefix: '# 🔍 Natural Language Query:',
    cypherQueryHeader: '## 📝 Generated Cypher Query',
    queryResultsHeader: '## 📊 Query Results',
    noResultsFound: '⚠️ No results found for this query.',
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

// Emojis for consistent formatting
export const EMOJIS = {
  search: '🔍',
  query: '📝',
  results: '📊',
  success: '✅',
  warning: '⚠️',
  error: '❌',
} as const;

// Logging Configuration
export const LOG_CONFIG = {
  timestampFormat: 'iso',
  logSeparator: '---',
  jsonIndentation: 2,
} as const;
