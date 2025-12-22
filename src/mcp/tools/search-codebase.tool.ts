/**
 * Search Codebase Tool
 * Semantic search using vector embeddings to find relevant code
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { EmbeddingsService } from '../../core/embeddings/embeddings.service.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';
import { TOOL_NAMES, TOOL_METADATA, DEFAULTS, MESSAGES } from '../constants.js';
import { TraversalHandler } from '../handlers/traversal.handler.js';
import { createErrorResponse, createSuccessResponse, debugLog } from '../utils.js';

export const createSearchCodebaseTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.searchCodebase,
    {
      title: TOOL_METADATA[TOOL_NAMES.searchCodebase].title,
      description: TOOL_METADATA[TOOL_NAMES.searchCodebase].description,
      inputSchema: {
        query: z.string().describe('Natural language query to search the codebase'),
        maxDepth: z
          .number()
          .int()
          .optional()
          .describe(`Maximum depth to traverse relationships (default: ${DEFAULTS.traversalDepth}, max: 10)`)
          .default(DEFAULTS.traversalDepth),
        maxNodesPerChain: z
          .number()
          .int()
          .optional()
          .describe('Maximum chains to show per depth level (default: 5, applied independently at each depth)')
          .default(5),
        skip: z.number().int().optional().describe('Number of results to skip for pagination (default: 0)').default(0),
        includeCode: z
          .boolean()
          .optional()
          .describe('Include source code snippets in results (default: true)')
          .default(true),
        snippetLength: z
          .number()
          .int()
          .optional()
          .describe(`Length of code snippets to include (default: ${DEFAULTS.codeSnippetLength})`)
          .default(DEFAULTS.codeSnippetLength),
        useWeightedTraversal: z
          .boolean()
          .optional()
          .describe('Use weighted traversal strategy that scores each node for relevance (default: false)')
          .default(true),
      },
    },
    async ({
      query,
      maxDepth = DEFAULTS.traversalDepth,
      maxNodesPerChain = 5,
      skip = 0,
      includeCode = true,
      snippetLength = DEFAULTS.codeSnippetLength,
      useWeightedTraversal = true,
    }) => {
      try {
        await debugLog('Search codebase started', { query });

        const neo4jService = new Neo4jService();
        const embeddingsService = new EmbeddingsService();
        const traversalHandler = new TraversalHandler(neo4jService);

        const embedding = await embeddingsService.embedText(query);

        const vectorResults = await neo4jService.run(QUERIES.VECTOR_SEARCH, {
          limit: 1,
          embedding,
        });

        if (vectorResults.length === 0) {
          await debugLog('No relevant code found', { query });
          return createSuccessResponse(MESSAGES.errors.noRelevantCode);
        }

        const startNode = vectorResults[0].node;
        const nodeId = startNode.properties.id;

        await debugLog('Vector search completed, starting traversal', {
          nodeId,
          resultsCount: vectorResults.length,
          maxDepth,
          maxNodesPerChain,
          skip,
          includeCode,
          snippetLength,
        });

        return await traversalHandler.traverseFromNode(nodeId, embedding, {
          maxDepth,
          direction: 'BOTH', // Show both incoming (who calls this) and outgoing (what this calls)
          includeCode,
          maxNodesPerChain,
          skip,
          summaryOnly: false,
          snippetLength,
          title: `Exploration from Node: ${nodeId}`,
          useWeightedTraversal,
        });
      } catch (error) {
        console.error('Search codebase error:', error);
        await debugLog('Search codebase error', error);
        return createErrorResponse(error);
      }
    },
  );
};
