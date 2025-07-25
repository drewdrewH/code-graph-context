/**
 * MCP Tool Factory
 * Centralized tool creation and registration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createHelloTool } from './hello.tool.js';
import { createSearchCodebaseTool } from './search-codebase.tool.js';
import { createNaturalLanguageToCypherTool } from './natural-language-to-cypher.tool.js';
import { createTraverseFromNodeTool } from './traverse-from-node.tool.js';
import { createParseTypescriptProjectTool } from './parse-typescript-project.tool.js';
import { createTestNeo4jConnectionTool } from './test-neo4j-connection.tool.js';

/**
 * Register all MCP tools with the server
 */
export const registerAllTools = (server: McpServer): void => {
  // Register basic tools
  createHelloTool(server);
  createTestNeo4jConnectionTool(server);
  
  // Register core functionality tools
  createSearchCodebaseTool(server);
  createTraverseFromNodeTool(server);
  createNaturalLanguageToCypherTool(server);
  
  // Register project parsing tool
  createParseTypescriptProjectTool(server);
};