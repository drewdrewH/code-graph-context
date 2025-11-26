#!/usr/bin/env node
/**
 *
 * MCP Server - Main Entry Point
 * Clean, modular architecture for the Code Graph Context MCP Server
 */

// Load environment variables from .env file
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Go up two levels from dist/mcp/mcp.server.js to the root
const rootDir = join(__dirname, '..', '..');
dotenv.config({ path: join(rootDir, '.env') });

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
  console.error(JSON.stringify({ level: 'info', message: MESSAGES.server.starting }));

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
  console.error(JSON.stringify({ level: 'info', message: MESSAGES.server.creatingTransport }));
  const transport = new StdioServerTransport();

  console.error(JSON.stringify({ level: 'info', message: MESSAGES.server.connectingTransport }));
  await server.connect(transport);

  console.error(JSON.stringify({ level: 'info', message: MESSAGES.server.connected }));
};

// Start the server
console.error(JSON.stringify({ level: 'info', message: MESSAGES.server.startingServer }));
await startServer();
