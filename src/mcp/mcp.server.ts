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
import { performIncrementalParse } from './handlers/incremental-parse.handler.js';
import { watchManager } from './services/watch-manager.js';
import { initializeServices } from './service-init.js';
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

  // Configure watch manager with incremental parse handler and MCP server
  watchManager.setIncrementalParseHandler(performIncrementalParse);
  watchManager.setMcpServer(server.server);

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

/**
 * Graceful shutdown handler
 */
const shutdown = async (signal: string): Promise<void> => {
  console.error(JSON.stringify({ level: 'info', message: `Received ${signal}, shutting down...` }));
  try {
    await watchManager.stopAllWatchers();
    await debugLog('Shutdown complete', { signal });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'Error during shutdown', error: String(error) }));
  }
  process.exit(0);
};

// Register exception handlers to catch native crashes
process.on('uncaughtException', async (error) => {
  console.error(
    JSON.stringify({ level: 'error', message: 'Uncaught exception', error: String(error), stack: error.stack }),
  );
  await debugLog('Uncaught exception', { error: String(error), stack: error.stack });
});

process.on('unhandledRejection', async (reason) => {
  console.error(JSON.stringify({ level: 'error', message: 'Unhandled rejection', reason: String(reason) }));
  await debugLog('Unhandled rejection', { reason: String(reason) });
});

// Register shutdown handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start the server
console.error(JSON.stringify({ level: 'info', message: MESSAGES.server.startingServer }));
await startServer();
