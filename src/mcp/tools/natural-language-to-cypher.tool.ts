/**
 * Natural Language to Cypher Tool
 * Converts natural language queries to Cypher using OpenAI GPT-4
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { NaturalLanguageToCypherService } from '../../core/embeddings/natural-language-to-cypher.service.js';
import { resolveProjectIdFromInput } from '../../core/utils/project-id.js';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { TOOL_NAMES, TOOL_METADATA, MESSAGES } from '../constants.js';
import { createErrorResponse, createSuccessResponse, formatQueryResults, debugLog } from '../utils.js';

// Service instance - initialized asynchronously
let naturalLanguageToCypherService: NaturalLanguageToCypherService | null = null;

/**
 * Initialize the Natural Language to Cypher service
 */
export const initializeNaturalLanguageService = async (): Promise<void> => {
  try {
    const service = new NaturalLanguageToCypherService();
    const schemaPath = 'neo4j-apoc-schema.json';

    await service.getOrCreateAssistant(schemaPath);
    naturalLanguageToCypherService = service;

    await debugLog('Natural Language to Cypher service initialized successfully');
  } catch (error) {
    await debugLog('Failed to initialize Natural Language to Cypher service', error);
    naturalLanguageToCypherService = null;
  }
};

export const createNaturalLanguageToCypherTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.naturalLanguageToCypher,
    {
      title: TOOL_METADATA[TOOL_NAMES.naturalLanguageToCypher].title,
      description: TOOL_METADATA[TOOL_NAMES.naturalLanguageToCypher].description,
      inputSchema: {
        projectId: z.string().describe('Project ID, name, or path (e.g., "backend" or "proj_a1b2c3d4e5f6")'),
        query: z.string().describe('Natural language query to convert to Cypher'),
      },
    },
    async ({ projectId, query }) => {
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

        if (!naturalLanguageToCypherService) {
          await debugLog('Natural language service not available', { projectId: resolvedProjectId, query });
          return createSuccessResponse(MESSAGES.errors.serviceNotInitialized);
        }

        await debugLog('Natural language to Cypher conversion started', { projectId: resolvedProjectId, query });

        const cypherResult = await naturalLanguageToCypherService.promptToQuery(query, resolvedProjectId);

        // Validate Cypher syntax using EXPLAIN (no execution, just parse)
        const parameters = { ...cypherResult.parameters, projectId: resolvedProjectId };

        try {
          await neo4jService.run(`EXPLAIN ${cypherResult.cypher}`, parameters);
        } catch (validationError) {
          const message = validationError instanceof Error ? validationError.message : String(validationError);
          await debugLog('Generated Cypher validation failed', {
            cypher: cypherResult.cypher,
            error: message,
          });
          return createErrorResponse(
            `Generated Cypher query has syntax errors:\n\n` +
              `Query: ${cypherResult.cypher}\n\n` +
              `Error: ${message}\n\n` +
              `Try rephrasing your request or use a simpler query.`,
          );
        }

        // Execute the validated query
        const results = await neo4jService.run(cypherResult.cypher, parameters);

        await debugLog('Cypher query executed', {
          projectId: resolvedProjectId,
          cypher: cypherResult.cypher,
          resultsCount: results.length,
        });

        const formattedResponse = formatQueryResults(results, query, cypherResult);
        return createSuccessResponse(JSON.stringify(formattedResponse, null, 2));
      } catch (error) {
        console.error('Natural language to Cypher error:', error);
        await debugLog('Natural language to Cypher error', { query, error });
        return createErrorResponse(error);
      } finally {
        await neo4jService.close();
      }
    },
  );
};
