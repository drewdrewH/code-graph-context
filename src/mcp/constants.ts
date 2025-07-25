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
    description: 'Search the codebase using semantic similarity to find relevant code, functions, classes, and implementations based on natural language descriptions. Use this when the user asks about specific functionality, code patterns, or wants to understand how something works in the project.',
  },
  [TOOL_NAMES.naturalLanguageToCypher]: {
    title: 'Natural Language to Cypher',
    description: 'Convert natural language queries into Cypher queries for Neo4j. This tool is useful for generating specific queries based on user requests about the codebase.',
  },
  [TOOL_NAMES.traverseFromNode]: {
    title: 'Traverse from Node',
    description: 'Traverse the graph starting from a specific node ID to explore its connections and relationships. This tool is useful for doing targeted exploration after finding a significant node through search_codebase.',
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
  codeSnippetLength: 150,
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