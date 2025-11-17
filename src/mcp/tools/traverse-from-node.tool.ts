/**
 * Traverse From Node Tool
 * Deep graph traversal from a specific node with pagination support
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { MAX_TRAVERSAL_DEPTH } from '../../constants.js';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { TOOL_NAMES, TOOL_METADATA, DEFAULTS } from '../constants.js';
import { TraversalHandler } from '../handlers/traversal.handler.js';
import { createErrorResponse, sanitizeNumericInput, debugLog } from '../utils.js';

export const createTraverseFromNodeTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.traverseFromNode,
    {
      title: TOOL_METADATA[TOOL_NAMES.traverseFromNode].title,
      description: TOOL_METADATA[TOOL_NAMES.traverseFromNode].description,
      inputSchema: {
        nodeId: z.string().describe('The node ID to start traversal from'),
        maxDepth: z
          .number()
          .int()
          .optional()
          .describe(`Maximum depth to traverse (default: ${DEFAULTS.traversalDepth}, max: ${MAX_TRAVERSAL_DEPTH})`)
          .default(DEFAULTS.traversalDepth),
        skip: z
          .number()
          .int()
          .optional()
          .describe(`Number of results to skip for pagination (default: ${DEFAULTS.skipOffset})`)
          .default(DEFAULTS.skipOffset),
        direction: z
          .enum(['OUTGOING', 'INCOMING', 'BOTH'])
          .optional()
          .describe(
            'Filter by relationship direction: OUTGOING (what this calls), INCOMING (who calls this), BOTH (default)',
          )
          .default('BOTH'),
        relationshipTypes: z
          .array(z.string())
          .optional()
          .describe(
            'Filter by specific relationship types (e.g., ["INJECTS", "USES_REPOSITORY"]). If not specified, shows all relationships.',
          ),
        includeCode: z
          .boolean()
          .optional()
          .describe('Include source code snippets in results (default: true, set to false for structure-only view)')
          .default(true),
        maxNodesPerChain: z
          .number()
          .int()
          .optional()
          .describe('Maximum nodes to show per relationship chain (default: 8)')
          .default(8),
        summaryOnly: z
          .boolean()
          .optional()
          .describe('Return only summary with file paths and statistics (default: false)')
          .default(false),
        snippetLength: z
          .number()
          .int()
          .optional()
          .describe(`Code snippet character length when includeCode is true (default: ${DEFAULTS.codeSnippetLength})`)
          .default(DEFAULTS.codeSnippetLength),
      },
    },
    async ({
      nodeId,
      maxDepth = DEFAULTS.traversalDepth,
      skip = DEFAULTS.skipOffset,
      direction = 'BOTH',
      relationshipTypes,
      includeCode = true,
      maxNodesPerChain = 8,
      summaryOnly = false,
      snippetLength = DEFAULTS.codeSnippetLength,
    }) => {
      try {
        const sanitizedMaxDepth = sanitizeNumericInput(maxDepth, DEFAULTS.traversalDepth, MAX_TRAVERSAL_DEPTH);
        const sanitizedSkip = sanitizeNumericInput(skip, DEFAULTS.skipOffset);

        await debugLog('Node traversal started', {
          nodeId,
          maxDepth: sanitizedMaxDepth,
          skip: sanitizedSkip,
          direction,
          relationshipTypes,
          includeCode,
          maxNodesPerChain,
          summaryOnly,
          snippetLength,
        });

        const neo4jService = new Neo4jService();
        const traversalHandler = new TraversalHandler(neo4jService);

        return await traversalHandler.traverseFromNode(nodeId, {
          maxDepth: sanitizedMaxDepth,
          skip: sanitizedSkip,
          direction,
          relationshipTypes,
          includeStartNodeDetails: true,
          includeCode,
          maxNodesPerChain,
          summaryOnly,
          snippetLength,
          title: `Node Traversal from: ${nodeId}`,
        });
      } catch (error) {
        console.error('Node traversal error:', error);
        await debugLog('Node traversal error', { nodeId, error });
        return createErrorResponse(error);
      }
    },
  );
};
