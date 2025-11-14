/**
 *
 * MCP Server - Main Entry Point
 * Clean, modular architecture for the Code Graph Context MCP Server
 */

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { MCP_SERVER_CONFIG, MESSAGES } from './constants.js';
import { initializeServices } from './services.js';
import { registerAllTools } from './tools/index.js';
import { debugLog } from './utils.js';

/**
 * Main server initialization and startup
 */
const startServer = async (): Promise<void> => {
  console.error(MESSAGES.server.starting);

  // Create MCP server instance
  const server = new McpServer({
    name: MCP_SERVER_CONFIG.name,
    version: MCP_SERVER_CONFIG.version,
  });

  // Register all tools
  registerAllTools(server);

  // Initialize external services (non-blocking)
  initializeServices().catch((error) => {
    debugLog('Service initialization error', error);
  });

  // Create and connect transport
  console.error(MESSAGES.server.creatingTransport);
  const transport = new StdioServerTransport();

  console.error(MESSAGES.server.connectingTransport);
  await server.connect(transport);

  console.error(MESSAGES.server.connected);
};

// Start the server
console.error(MESSAGES.server.startingServer);
await startServer();
