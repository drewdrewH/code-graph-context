/* eslint-disable import/order */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'codebase-graph',
  version: '1.0.0',
});

server.registerTool(
  'hello',
  {
    title: 'Hello Tool',
    description: 'Test tool that says hello',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text', text: 'Hello from codebase MCP!' }],
  }),
);

console.log('Starting MCP server...');

const transport = new StdioServerTransport();
await server.connect(transport);
