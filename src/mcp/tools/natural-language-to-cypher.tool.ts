/**
 * Natural Language to Cypher Tool
 * Converts natural language queries to Cypher using OpenAI GPT-4
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { NaturalLanguageToCypherService } from '../../core/embeddings/natural-language-to-cypher.service.js';
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
        query: z.string().describe('Natural language query to convert to Cypher'),
      },
    },
    async ({ query }) => {
      try {
        if (!naturalLanguageToCypherService) {
          await debugLog('Natural language service not available', { query });
          return createSuccessResponse(MESSAGES.errors.serviceNotInitialized);
        }

        await debugLog('Natural language to Cypher conversion started', { query });

        const cypherResult = await naturalLanguageToCypherService.promptToQuery(query);
        const neo4jService = new Neo4jService();

        // Execute the generated Cypher query
        const results = await neo4jService.run(cypherResult.cypher, cypherResult.parameters ?? {});

        await debugLog('Cypher query executed', {
          cypher: cypherResult.cypher,
          resultsCount: results.length,
        });

        const formattedResponse = formatQueryResults(results, query, cypherResult);
        return createSuccessResponse(formattedResponse);
      } catch (error) {
        console.error('Natural language to Cypher error:', error);
        await debugLog('Natural language to Cypher error', { query, error });
        return createErrorResponse(error);
      }
    },
  );
};
