/**
 * MCP Tool Factory
 * Centralized tool creation and registration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { debugLog } from '../utils.js';

import { createCheckParseStatusTool } from './check-parse-status.tool.js';
import { createDetectDeadCodeTool } from './detect-dead-code.tool.js';
import { createDetectDuplicateCodeTool } from './detect-duplicate-code.tool.js';
import { createHelloTool } from './hello.tool.js';
import { createImpactAnalysisTool } from './impact-analysis.tool.js';
import { createListProjectsTool } from './list-projects.tool.js';
import { createListWatchersTool } from './list-watchers.tool.js';
import { createNaturalLanguageToCypherTool } from './natural-language-to-cypher.tool.js';
import { createParseTypescriptProjectTool } from './parse-typescript-project.tool.js';
import { createSearchCodebaseTool } from './search-codebase.tool.js';
import { createStartWatchProjectTool } from './start-watch-project.tool.js';
import { createStopWatchProjectTool } from './stop-watch-project.tool.js';
import { createSwarmCleanupTool } from './swarm-cleanup.tool.js';
import { createSwarmPheromoneTool } from './swarm-pheromone.tool.js';
import { createSwarmSenseTool } from './swarm-sense.tool.js';
import { createTestNeo4jConnectionTool } from './test-neo4j-connection.tool.js';
import { createTraverseFromNodeTool } from './traverse-from-node.tool.js';

// Track tool calls for debugging
let globalToolCallCount = 0;

/**
 * Log tool call start (exported for use by individual tools)
 */
export const logToolCallStart = async (toolName: string, params?: any): Promise<number> => {
  globalToolCallCount++;
  const callId = globalToolCallCount;
  await debugLog(`Tool call START: ${toolName}`, {
    callId,
    totalCalls: globalToolCallCount,
    params: params ? JSON.stringify(params).substring(0, 500) : 'none',
  });
  return callId;
};

/**
 * Log tool call end (exported for use by individual tools)
 */
export const logToolCallEnd = async (toolName: string, callId: number, success: boolean, duration?: number): Promise<void> => {
  await debugLog(`Tool call END: ${toolName}`, {
    callId,
    success,
    duration: duration ? `${duration}ms` : 'unknown',
  });
};

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
  createDetectDeadCodeTool(server);
  createDetectDuplicateCodeTool(server);

  // Register project parsing tools
  createParseTypescriptProjectTool(server);
  createCheckParseStatusTool(server);

  // Register project management tools
  createListProjectsTool(server);

  // Register file watch tools
  createStartWatchProjectTool(server);
  createStopWatchProjectTool(server);
  createListWatchersTool(server);

  // Register swarm coordination tools
  createSwarmPheromoneTool(server);
  createSwarmSenseTool(server);
  createSwarmCleanupTool(server);
};
