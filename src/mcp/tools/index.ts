/**
 * MCP Tool Factory
 * Centralized tool creation and registration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createCheckParseStatusTool } from './check-parse-status.tool.js';
import { createHelloTool } from './hello.tool.js';
import { createImpactAnalysisTool } from './impact-analysis.tool.js';
import { createListProjectsTool } from './list-projects.tool.js';
import { createNaturalLanguageToCypherTool } from './natural-language-to-cypher.tool.js';
import { createParseTypescriptProjectTool } from './parse-typescript-project.tool.js';
import { createSearchCodebaseTool } from './search-codebase.tool.js';
import { createTestNeo4jConnectionTool } from './test-neo4j-connection.tool.js';
import { createTraverseFromNodeTool } from './traverse-from-node.tool.js';

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
  createImpactAnalysisTool(server);

  // Register project parsing tools
  createParseTypescriptProjectTool(server);
  createCheckParseStatusTool(server);

  // Register project management tools
  createListProjectsTool(server);
};
