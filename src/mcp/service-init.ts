/**
 * Service Initialization
 * Handles initialization of external services like Neo4j schema and OpenAI assistant
 */

import fs from 'fs/promises';
import { join } from 'path';

import {
  ensureNeo4jRunning,
  isDockerInstalled,
  isDockerRunning,
} from '../cli/neo4j-docker.js';
import { Neo4jService, QUERIES } from '../storage/neo4j/neo4j.service.js';

import { FILE_PATHS, LOG_CONFIG } from './constants.js';
import { initializeNaturalLanguageService } from './tools/natural-language-to-cypher.tool.js';
import { debugLog } from './utils.js';

/**
 * Log startup warnings for missing configuration
 */
const checkConfiguration = async (): Promise<void> => {
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      JSON.stringify({
        level: 'warn',
        message:
          '[code-graph-context] OPENAI_API_KEY not set. Semantic search and NL queries unavailable.',
      }),
    );
    await debugLog('Configuration warning', { warning: 'OPENAI_API_KEY not set' });
  }
};

/**
 * Ensure Neo4j is running - auto-start if Docker available, fail if not
 */
const ensureNeo4j = async (): Promise<void> => {
  // Check if Docker is available
  if (!isDockerInstalled()) {
    const msg = 'Docker not installed. Install Docker or run: code-graph-context init';
    console.error(JSON.stringify({ level: 'error', message: `[code-graph-context] ${msg}` }));
    throw new Error(msg);
  }

  if (!isDockerRunning()) {
    const msg = 'Docker not running. Start Docker or run: code-graph-context init';
    console.error(JSON.stringify({ level: 'error', message: `[code-graph-context] ${msg}` }));
    throw new Error(msg);
  }

  const result = await ensureNeo4jRunning();

  if (!result.success) {
    const msg = `Neo4j failed to start: ${result.error}. Run: code-graph-context init`;
    console.error(JSON.stringify({ level: 'error', message: `[code-graph-context] ${msg}` }));
    throw new Error(msg);
  }

  if (result.action === 'created') {
    console.error(
      JSON.stringify({
        level: 'info',
        message: '[code-graph-context] Neo4j container created and started',
      }),
    );
  } else if (result.action === 'started') {
    console.error(
      JSON.stringify({
        level: 'info',
        message: '[code-graph-context] Neo4j container started',
      }),
    );
  }

  await debugLog('Neo4j ready', result);
};

/**
 * Initialize all external services required by the MCP server
 */
export const initializeServices = async (): Promise<void> => {
  // Check for missing configuration (non-fatal warnings)
  await checkConfiguration();

  // Ensure Neo4j is running (fatal if not)
  await ensureNeo4j();

  // Initialize services
  await Promise.all([initializeNeo4jSchema(), initializeNaturalLanguageService()]);
};

/**
 * Dynamically discover schema from the actual graph contents.
 * This is framework-agnostic - it discovers what's actually in the graph.
 */
const discoverSchemaFromGraph = async (neo4jService: Neo4jService) => {
  try {
    // Discover actual node types, relationships, and patterns from the graph
    const [nodeTypes, relationshipTypes, semanticTypes, commonPatterns] = await Promise.all([
      neo4jService.run(QUERIES.DISCOVER_NODE_TYPES),
      neo4jService.run(QUERIES.DISCOVER_RELATIONSHIP_TYPES),
      neo4jService.run(QUERIES.DISCOVER_SEMANTIC_TYPES),
      neo4jService.run(QUERIES.DISCOVER_COMMON_PATTERNS),
    ]);

    return {
      nodeTypes: nodeTypes.map((r: any) => ({
        label: r.label,
        count: typeof r.nodeCount === 'object' ? r.nodeCount.toNumber() : r.nodeCount,
        properties: r.sampleProperties ?? [],
      })),
      relationshipTypes: relationshipTypes.map((r: any) => ({
        type: r.relationshipType,
        count: typeof r.relCount === 'object' ? r.relCount.toNumber() : r.relCount,
        connections: r.connections ?? [],
      })),
      semanticTypes: semanticTypes.map((r: any) => ({
        type: r.semanticType,
        count: typeof r.count === 'object' ? r.count.toNumber() : r.count,
      })),
      commonPatterns: commonPatterns.map((r: any) => ({
        from: r.fromType,
        relationship: r.relType,
        to: r.toType,
        count: typeof r.count === 'object' ? r.count.toNumber() : r.count,
      })),
    };
  } catch (error) {
    await debugLog('Failed to discover schema from graph', error);
    return null;
  }
};

/**
 * Initialize Neo4j schema by fetching from APOC and discovering actual graph structure
 */
const initializeNeo4jSchema = async (): Promise<void> => {
  try {
    const neo4jService = new Neo4jService();
    const rawSchema = await neo4jService.getSchema();

    // Dynamically discover what's actually in the graph
    const discoveredSchema = await discoverSchemaFromGraph(neo4jService);

    const schema = {
      rawSchema,
      discoveredSchema,
    };

    const schemaPath = join(process.cwd(), FILE_PATHS.schemaOutput);
    await fs.writeFile(schemaPath, JSON.stringify(schema, null, LOG_CONFIG.jsonIndentation));

    await debugLog('Neo4j schema cached successfully', { schemaPath });
  } catch (error) {
    await debugLog('Failed to initialize Neo4j schema', error);
    // Don't throw - service can still function without cached schema
  }
};
