#!/usr/bin/env node
/**
 *
 * MCP Server - Main Entry Point
 * Clean, modular architecture for the Code Graph Context MCP Server
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env file - must run before other imports use env vars
// eslint-disable-next-line import/order
import dotenv from 'dotenv';

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

  // Initialize external services (non-blocking but with proper error handling)
  initializeServices().catch(async (error) => {
    // Await the debugLog to ensure it completes before potential exit
    await debugLog('Service initialization error', error);
    // Log to stderr so it's visible even if debug file fails
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Service initialization failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
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
