/**
 * Search Codebase Tool
 * Semantic search using vector embeddings to find relevant code
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { EmbeddingsService } from '../../core/embeddings/embeddings.service.js';
import { resolveProjectIdFromInput } from '../../core/utils/project-id.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';
import { TOOL_NAMES, TOOL_METADATA, DEFAULTS } from '../constants.js';
import { TraversalHandler } from '../handlers/traversal.handler.js';
import { createErrorResponse, createSuccessResponse, debugLog, sanitizeNumericInput } from '../utils.js';

export const createSearchCodebaseTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.searchCodebase,
    {
      title: TOOL_METADATA[TOOL_NAMES.searchCodebase].title,
      description: TOOL_METADATA[TOOL_NAMES.searchCodebase].description,
      inputSchema: {
        projectId: z.string().describe('Project ID, name, or path (e.g., "any-backend" or "proj_a1b2c3d4e5f6")'),
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
        minSimilarity: z
          .number()
          .optional()
          .describe('Minimum similarity score threshold (0.0-1.0). Results below this are filtered out. Default: 0.65')
          .default(0.65),
        useWeightedTraversal: z
          .boolean()
          .optional()
          .describe('Use weighted traversal strategy that scores each node for relevance (default: false)')
          .default(true),
      },
    },
    async ({
      projectId,
      query,
      maxDepth = DEFAULTS.traversalDepth,
      maxNodesPerChain = 5,
      skip = 0,
      includeCode = true,
      snippetLength = DEFAULTS.codeSnippetLength,
      minSimilarity = 0.65,
      useWeightedTraversal = true,
    }) => {
      const neo4jService = new Neo4jService();
      try {
        // Resolve project ID from name, path, or ID
        let resolvedProjectId: string;
        try {
          resolvedProjectId = await resolveProjectIdFromInput(projectId, neo4jService);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return createErrorResponse(message);
        }

        // Sanitize numeric inputs to ensure integers (Neo4j LIMIT requires integers)
        const sanitizedMaxDepth = sanitizeNumericInput(maxDepth, DEFAULTS.traversalDepth, 10);
        const sanitizedMaxNodesPerChain = sanitizeNumericInput(maxNodesPerChain, 5);
        const sanitizedSkip = sanitizeNumericInput(skip, 0);
        const sanitizedSnippetLength = sanitizeNumericInput(snippetLength, DEFAULTS.codeSnippetLength);

        await debugLog('Search codebase started', { projectId: resolvedProjectId, query });

        const embeddingsService = new EmbeddingsService();
        const traversalHandler = new TraversalHandler(neo4jService);

        const embedding = await embeddingsService.embedText(query);

        const vectorResults = await neo4jService.run(QUERIES.VECTOR_SEARCH, {
          limit: 1,
          embedding,
          projectId: resolvedProjectId,
          fetchMultiplier: 10,
          minSimilarity,
        });

        if (vectorResults.length === 0) {
          await debugLog('No relevant code found', { projectId: resolvedProjectId, query, minSimilarity });
          return createSuccessResponse(
            `No code found with similarity >= ${minSimilarity}. ` +
              `Try rephrasing your query or lowering the minSimilarity threshold. Query: "${query}"`,
          );
        }

        const startNode = vectorResults[0].node;
        const nodeId = startNode.properties.id;
        const similarityScore = vectorResults[0].score;

        // Check if best match meets threshold - prevents traversing low-relevance results
        if (similarityScore < minSimilarity) {
          await debugLog('Best match below similarity threshold', {
            projectId: resolvedProjectId,
            query,
            score: similarityScore,
            threshold: minSimilarity,
          });
          return createSuccessResponse(
            `No sufficiently relevant code found. Best match score: ${similarityScore.toFixed(3)} ` +
              `(threshold: ${minSimilarity}). Try rephrasing your query.`,
          );
        }

        await debugLog('Vector search completed, starting traversal', {
          projectId: resolvedProjectId,
          nodeId,
          similarityScore,
          resultsCount: vectorResults.length,
          maxDepth: sanitizedMaxDepth,
          maxNodesPerChain: sanitizedMaxNodesPerChain,
          skip: sanitizedSkip,
          includeCode,
          snippetLength: sanitizedSnippetLength,
        });

        // Include similarity score in the title so users can see relevance
        const scoreDisplay = typeof similarityScore === 'number' ? similarityScore.toFixed(3) : 'N/A';

        return await traversalHandler.traverseFromNode(nodeId, embedding, {
          projectId: resolvedProjectId,
          maxDepth: sanitizedMaxDepth,
          direction: 'BOTH', // Show both incoming (who calls this) and outgoing (what this calls)
          includeCode,
          maxNodesPerChain: sanitizedMaxNodesPerChain,
          skip: sanitizedSkip,
          summaryOnly: false,
          snippetLength: sanitizedSnippetLength,
          title: `Search Results (similarity: ${scoreDisplay}) - Starting from: ${nodeId}`,
          useWeightedTraversal,
        });
      } catch (error) {
        console.error('Search codebase error:', error);
        await debugLog('Search codebase error', error);
        return createErrorResponse(error);
      } finally {
        await neo4jService.close();
      }
    },
  );
};
