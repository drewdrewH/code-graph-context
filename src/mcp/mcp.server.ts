/* eslint-disable @typescript-eslint/no-explicit-any */
import { writeFileSync } from 'fs';
import fs from 'fs/promises';
import { join } from 'path';
import path from 'path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { CORE_TYPESCRIPT_SCHEMA, NESTJS_FRAMEWORK_SCHEMA } from '../core/config/graph-v2.js';
import { EmbeddingsService } from '../core/embeddings/embeddings.service.js';
import { TypeScriptParser } from '../core/parsers/typescript-parser-v2.js';
import { Neo4jService, QUERIES } from '../storage/neo4j/neo4j.service.js';

import { GraphGeneratorHandler } from './handlers/graph-generator.handler.js';
import { TraversalHandler } from './handlers/traversal.handler.js';

// Add this helper function at the top of your file
const debugLog = async (message: string, data?: any) => {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n${data ? JSON.stringify(data, null, 2) : ''}\n---\n`;

  try {
    await fs.appendFile(path.join(process.cwd(), 'debug-search.log'), logEntry);
  } catch (error) {
    console.error('Failed to write debug log:', error);
  }
};

console.error('=== MCP Server Starting ===');

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

server.registerTool(
  'search_codebase',
  {
    title: 'Search Codebase',
    description:
      'Search the codebase using semantic similarity to find relevant code, functions, classes, and implementations based on natural language descriptions. Use this when the user asks about specific functionality, code patterns, or wants to understand how something works in the project.',
    inputSchema: {
      query: z.string().describe('Natural language query to search the codebase'),
      limit: z.number().optional().describe('Maximum number of results to return (default: 10)').default(10),
    },
  },
  async ({ query, limit = 10 }) => {
    try {
      const neo4jService = new Neo4jService();
      const embeddingsService = new EmbeddingsService();
      const traversalHandler = new TraversalHandler(neo4jService);
      
      const embedding = await embeddingsService.embedText(query);

      const vectorResults = await neo4jService.run(QUERIES.VECTOR_SEARCH, {
        limit,
        embedding,
      });

      if (vectorResults.length === 0) {
        return {
          content: [{ type: 'text', text: 'No relevant code found.' }],
        };
      }

      const startNode = vectorResults[0].node;
      const nodeId = startNode.properties.id;

      return await traversalHandler.traverseFromNode(nodeId, {
        maxDepth: 10,
        limit: 8,
        title: `Exploration from Node: ${nodeId}`
      });
    } catch (error) {
      console.error('Search codebase error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `❌ ERROR: ${error.message}`,
          },
        ],
      };
    }
  },
);

server.registerTool(
  'traverse_from_node',
  {
    title: 'Traverse from Node',
    description:
      'Traverse the graph starting from a specific node ID to explore its connections and relationships. This tool is useful for doing targeted exploration after finding a significant node through search_codebase.',
    inputSchema: {
      nodeId: z.string().describe('The node ID to start traversal from'),
      maxDepth: z.number().optional().describe('Maximum depth to traverse (default: 3, max: 10)').default(3),
      limit: z.number().optional().describe('Maximum number of connections to return per depth (default: 20)').default(20),
    },
  },
  async ({ nodeId, maxDepth = 3, limit = 20 }) => {
    try {
      const neo4jService = new Neo4jService();
      const traversalHandler = new TraversalHandler(neo4jService);
      
      return await traversalHandler.traverseFromNode(nodeId, {
        maxDepth,
        limit,
        includeStartNodeDetails: true,
        title: `Node Traversal from: ${nodeId}`
      });
    } catch (error) {
      console.error('Node traversal error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `❌ ERROR: ${error.message}`,
          },
        ],
      };
    }
  },
);

server.registerTool(
  'parse_typescript_project',
  {
    title: 'Parse TypeScript Project',
    description: 'Parse a TypeScript/NestJS project and store in Neo4j graph',
    inputSchema: {
      projectPath: z.string().describe('Path to the TypeScript project root directory'),
      tsconfigPath: z.string().describe('Path to TypeScript project tsconfig.json file'),
      clearExisting: z.boolean().optional().describe('Clear existing graph data first'),
    },
  },
  async ({ tsconfigPath, projectPath, clearExisting }) => {
    try {
      const parser = new TypeScriptParser(projectPath, tsconfigPath, undefined, [NESTJS_FRAMEWORK_SCHEMA]);
      const { nodes, edges } = await parser.parseWorkspace();
      const { nodes: cleanNodes, edges: cleanEdges } = parser.exportToJson();
      console.log(`Parsed ${cleanNodes.length} nodes / ${cleanEdges.length} edges`);

      // Write file INSIDE the project directory
      const outputPath = join(projectPath, 'graph.json');
      writeFileSync(
        outputPath,
        JSON.stringify(
          {
            nodes: cleanNodes,
            edges: cleanEdges,
            metadata: {
              coreSchema: CORE_TYPESCRIPT_SCHEMA.name,
              frameworkSchemas: [NESTJS_FRAMEWORK_SCHEMA.name],
              generated: new Date().toISOString(),
            },
          },
          null,
          2,
        ),
      );

      console.log(`Graph data written to ${outputPath}`);

      try {
        const neo4jService = new Neo4jService();
        const embeddingsService = new EmbeddingsService();
        const graphGeneratorHandler = new GraphGeneratorHandler(neo4jService, embeddingsService);
        const result = await graphGeneratorHandler.generateGraph(outputPath, 500, clearExisting);

        console.log('Graph generation completed:', result);

        return {
          content: [
            {
              type: 'text',
              text: `✅ SUCCESS: Parsed ${cleanNodes.length} nodes and ${cleanEdges.length} edges. Graph imported to Neo4j. Result: ${JSON.stringify(result)}`,
            },
          ],
        };
      } catch (neo4jError) {
        console.error('Neo4j import failed:', neo4jError);
        return {
          content: [
            {
              type: 'text',
              text: `⚠️ PARTIAL SUCCESS: Parsed ${cleanNodes.length} nodes and ${cleanEdges.length} edges. JSON saved to ${outputPath}. Neo4j import failed: ${neo4jError.message}`,
            },
          ],
        };
      }
    } catch (error) {
      console.error('Parse tool error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `❌ ERROR: ${error.message}`,
          },
        ],
      };
    }
  },
);
server.registerTool(
  'test_neo4j_connection',
  {
    title: 'Test Neo4j Connection & APOC',
    description: 'Test connection to Neo4j database and verify APOC plugin is available',
    inputSchema: {},
  },
  async () => {
    const driver = new Neo4jService().getDriver();
    try {
      const session = driver.session();

      try {
        const basicResult = await session.run('RETURN "Connected!" as message, datetime() as timestamp');

        const apocResult = await session.run('CALL apoc.help("apoc") YIELD name RETURN count(name) as apocFunctions');
        const apocCount = apocResult.records[0].get('apocFunctions').toNumber();

        return {
          content: [
            {
              type: 'text',
              text: `Neo4j connected: ${basicResult.records[0].get('message')} at ${basicResult.records[0].get('timestamp')}\nAPOC plugin available with ${apocCount} functions`,
            },
          ],
        };
      } finally {
        await session.close();
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Connection test failed: ${error.message}\nNote: This server requires Neo4j with APOC plugin installed`,
          },
        ],
      };
    } finally {
      await driver.close();
    }
  },
);
console.log('Starting MCP server...');
console.error('Creating transport...');
const transport = new StdioServerTransport();

console.error('Connecting server to transport...');
await server.connect(transport);

console.error('=== MCP Server Connected and Running ===');
