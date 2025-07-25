/**
 * Hello Tool
 * Simple test tool to verify MCP connection
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_NAMES, TOOL_METADATA, MESSAGES } from '../constants.js';
import { createSuccessResponse } from '../utils.js';

export const createHelloTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.hello,
    {
      title: TOOL_METADATA[TOOL_NAMES.hello].title,
      description: TOOL_METADATA[TOOL_NAMES.hello].description,
      inputSchema: {},
    },
    async () => createSuccessResponse(MESSAGES.success.hello)
  );
};