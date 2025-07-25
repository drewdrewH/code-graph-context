/**
 * Traverse From Node Tool
 * Deep graph traversal from a specific node with pagination support
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { MAX_TRAVERSAL_DEPTH } from '../../constants.js';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { TraversalHandler } from '../handlers/traversal.handler.js';
import { TOOL_NAMES, TOOL_METADATA, DEFAULTS } from '../constants.js';
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
      },
    },
    async ({ nodeId, maxDepth = DEFAULTS.traversalDepth, skip = DEFAULTS.skipOffset }) => {
      try {
        const sanitizedMaxDepth = sanitizeNumericInput(maxDepth, DEFAULTS.traversalDepth, MAX_TRAVERSAL_DEPTH);
        const sanitizedSkip = sanitizeNumericInput(skip, DEFAULTS.skipOffset);

        await debugLog('Node traversal started', { 
          nodeId, 
          maxDepth: sanitizedMaxDepth, 
          skip: sanitizedSkip 
        });

        const neo4jService = new Neo4jService();
        const traversalHandler = new TraversalHandler(neo4jService);

        return await traversalHandler.traverseFromNode(nodeId, {
          maxDepth: sanitizedMaxDepth,
          skip: sanitizedSkip,
          includeStartNodeDetails: true,
          title: `Node Traversal from: ${nodeId}`,
        });
      } catch (error) {
        console.error('Node traversal error:', error);
        await debugLog('Node traversal error', { nodeId, error });
        return createErrorResponse(error);
      }
    }
  );
};