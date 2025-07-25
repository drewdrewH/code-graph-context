/**
 * Test Neo4j Connection Tool
 * Verifies Neo4j connectivity and APOC plugin availability
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { TOOL_NAMES, TOOL_METADATA, MESSAGES } from '../constants.js';
import { createErrorResponse, createSuccessResponse } from '../utils.js';

export const createTestNeo4jConnectionTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.testNeo4jConnection,
    {
      title: TOOL_METADATA[TOOL_NAMES.testNeo4jConnection].title,
      description: TOOL_METADATA[TOOL_NAMES.testNeo4jConnection].description,
      inputSchema: {},
    },
    async () => {
      const driver = new Neo4jService().getDriver();
      
      try {
        const session = driver.session();

        try {
          const basicResult = await session.run(MESSAGES.neo4j.connectionTest);
          const apocResult = await session.run(MESSAGES.neo4j.apocTest);
          const apocCount = apocResult.records[0].get('apocFunctions').toNumber();

          const message = MESSAGES.neo4j.connectionSuccess
            .replace('{}', basicResult.records[0].get('message'))
            .replace('{}', basicResult.records[0].get('timestamp'))
            .replace('{}', apocCount.toString());

          return createSuccessResponse(message);
        } finally {
          await session.close();
        }
      } catch (error) {
        const errorMessage = `${MESSAGES.errors.connectionTestFailed}: ${error.message}\n${MESSAGES.errors.neo4jRequirement}`;
        return createErrorResponse(errorMessage);
      } finally {
        await driver.close();
      }
    }
  );
};