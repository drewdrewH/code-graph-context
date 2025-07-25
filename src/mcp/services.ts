/**
 * Service Initialization
 * Handles initialization of external services like Neo4j schema and OpenAI assistant
 */

import fs from 'fs/promises';
import { join } from 'path';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';
import { initializeNaturalLanguageService } from './tools/natural-language-to-cypher.tool.js';
import { FILE_PATHS, LOG_CONFIG } from './constants.js';
import { debugLog } from './utils.js';

/**
 * Initialize all external services required by the MCP server
 */
export const initializeServices = async (): Promise<void> => {
  await Promise.all([
    initializeNeo4jSchema(),
    initializeNaturalLanguageService(),
  ]);
};

/**
 * Initialize Neo4j schema by fetching and caching it locally
 */
const initializeNeo4jSchema = async (): Promise<void> => {
  try {
    const neo4jService = new Neo4jService();
    const schema = await neo4jService.getSchema();
    
    const schemaPath = join(process.cwd(), FILE_PATHS.schemaOutput);
    await fs.writeFile(schemaPath, JSON.stringify(schema, null, LOG_CONFIG.jsonIndentation));
    
    await debugLog('Neo4j schema cached successfully', { schemaPath });
  } catch (error) {
    await debugLog('Failed to initialize Neo4j schema', error);
    // Don't throw - service can still function without cached schema
  }
};