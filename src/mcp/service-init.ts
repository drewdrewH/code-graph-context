/**
 * Service Initialization
 * Handles initialization of external services like Neo4j schema and OpenAI assistant
 */

import fs from 'fs/promises';
import { join } from 'path';

import { ensureNeo4jRunning, isDockerInstalled, isDockerRunning } from '../cli/neo4j-docker.js';
import { isOpenAIEnabled, isOpenAIAvailable, getEmbeddingDimensions } from '../core/embeddings/embeddings.service.js';
import { LIST_PROJECTS_QUERY } from '../core/utils/project-id.js';
import { Neo4jService, QUERIES } from '../storage/neo4j/neo4j.service.js';

import { FILE_PATHS, LOG_CONFIG } from './constants.js';
import { initializeNaturalLanguageService } from './tools/natural-language-to-cypher.tool.js';
import { debugLog } from './utils.js';

/**
 * Log startup warnings for missing configuration
 */
const checkConfiguration = async (): Promise<void> => {
  const openai = isOpenAIEnabled();
  const dims = getEmbeddingDimensions();
  const provider = openai ? 'openai' : 'local';

  console.error(
    JSON.stringify({
      level: 'info',
      message: `[code-graph-context] Embedding provider: ${provider} (${dims} dimensions)`,
    }),
  );
  await debugLog('Embedding configuration', { provider, dimensions: dims });

  if (openai && !isOpenAIAvailable()) {
    console.error(
      JSON.stringify({
        level: 'warn',
        message:
          '[code-graph-context] OPENAI_EMBEDDINGS_ENABLED=true but OPENAI_API_KEY not set. Embedding calls will fail.',
      }),
    );
    await debugLog('Configuration warning', { warning: 'OPENAI_EMBEDDINGS_ENABLED=true but OPENAI_API_KEY not set' });
  }

  if (!openai) {
    console.error(
      JSON.stringify({
        level: 'info',
        message: '[code-graph-context] Using local embeddings (Python sidecar). Starts on first embedding request.',
      }),
    );
  }

  if (!isOpenAIAvailable()) {
    console.error(
      JSON.stringify({
        level: 'info',
        message: '[code-graph-context] natural_language_to_cypher unavailable: OPENAI_API_KEY not set.',
      }),
    );
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

  // Initialize services sequentially - schema must be written before NL service reads it
  await initializeNeo4jSchema();

  if (isOpenAIAvailable()) {
    await initializeNaturalLanguageService();
  } else {
    console.error(
      JSON.stringify({
        level: 'info',
        message: '[code-graph-context] natural_language_to_cypher unavailable: OPENAI_API_KEY not set',
      }),
    );
  }
};

/**
 * Dynamically discover schema from the actual graph contents.
 * This is framework-agnostic - it discovers what's actually in the graph.
 */
const discoverSchemaFromGraph = async (neo4jService: Neo4jService, projectId: string) => {
  try {
    // Discover actual node types, relationships, and patterns from the graph
    const [nodeTypes, relationshipTypes, semanticTypes, commonPatterns] = await Promise.all([
      neo4jService.run(QUERIES.DISCOVER_NODE_TYPES, { projectId }),
      neo4jService.run(QUERIES.DISCOVER_RELATIONSHIP_TYPES, { projectId }),
      neo4jService.run(QUERIES.DISCOVER_SEMANTIC_TYPES, { projectId }),
      neo4jService.run(QUERIES.DISCOVER_COMMON_PATTERNS, { projectId }),
    ]);

    return {
      nodeTypes: nodeTypes.map((r: any) => ({
        label: r.label,
        count: typeof r.nodeCount === 'object' ? r.nodeCount.toNumber() : r.nodeCount,
        properties: r.properties ?? [],
      })),
      relationshipTypes: relationshipTypes.map((r: any) => ({
        type: r.relationshipType,
        count: typeof r.relCount === 'object' ? r.relCount.toNumber() : r.relCount,
        connections: r.connections ?? [],
      })),
      semanticTypes: semanticTypes.map((r: any) => ({
        type: r.semanticType,
        label: r.nodeLabel,
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

    // Find the most recently updated project to scope discovery queries
    const projects = await neo4jService.run(LIST_PROJECTS_QUERY, {});
    const projectId = projects.length > 0 ? (projects[0].projectId as string) : null;

    // Dynamically discover what's actually in the graph
    const schema = projectId ? await discoverSchemaFromGraph(neo4jService, projectId) : null;

    const schemaPath = join(process.cwd(), FILE_PATHS.schemaOutput);
    await fs.writeFile(schemaPath, JSON.stringify(schema, null, LOG_CONFIG.jsonIndentation));

    await debugLog('Neo4j schema cached successfully', { schemaPath });
  } catch (error) {
    await debugLog('Failed to initialize Neo4j schema', error);
    // Don't throw - service can still function without cached schema
  }
};
