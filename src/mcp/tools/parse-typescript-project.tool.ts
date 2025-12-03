/**
 * Parse TypeScript Project Tool
 * Parses TypeScript/NestJS projects and builds Neo4j graph
 */

import { writeFileSync } from 'fs';
import { stat } from 'fs/promises';
import { join, resolve } from 'path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { glob } from 'glob';
import { z } from 'zod';

import { EXCLUDE_PATTERNS_GLOB } from '../../constants.js';
import { CORE_TYPESCRIPT_SCHEMA } from '../../core/config/schema.js';
import { EmbeddingsService } from '../../core/embeddings/embeddings.service.js';
import { ParserFactory, ProjectType } from '../../core/parsers/parser-factory.js';
import { ExistingNode } from '../../core/parsers/typescript-parser.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';
import { hashFile } from '../../utils/file-utils.js';
import { TOOL_NAMES, TOOL_METADATA, DEFAULTS, FILE_PATHS, LOG_CONFIG } from '../constants.js';
import { GraphGeneratorHandler } from '../handlers/graph-generator.handler.js';
import {
  createErrorResponse,
  createSuccessResponse,
  formatParseSuccess,
  formatParsePartialSuccess,
  debugLog,
} from '../utils.js';

export const createParseTypescriptProjectTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.parseTypescriptProject,
    {
      title: TOOL_METADATA[TOOL_NAMES.parseTypescriptProject].title,
      description: TOOL_METADATA[TOOL_NAMES.parseTypescriptProject].description,
      inputSchema: {
        projectPath: z.string().describe('Path to the TypeScript project root directory'),
        tsconfigPath: z.string().describe('Path to TypeScript project tsconfig.json file'),
        clearExisting: z.boolean().optional().describe('Clear existing graph data first'),
        excludeNodeTypes: z
          .array(z.string())
          .optional()
          .describe('Node types to skip during parsing, e.g. ["TestFile", "Parameter"]'),
        projectType: z
          .enum(['nestjs', 'fairsquare', 'both', 'vanilla', 'auto'])
          .optional()
          .default('auto')
          .describe('Project framework type (auto-detect by default)'),
      },
    },
    async ({ tsconfigPath, projectPath, clearExisting, projectType = 'auto' }) => {
      try {
        await debugLog('TypeScript project parsing started', {
          projectPath,
          tsconfigPath,
          clearExisting,
          projectType,
        });

        const neo4jService = new Neo4jService();
        const embeddingsService = new EmbeddingsService();
        const graphGeneratorHandler = new GraphGeneratorHandler(neo4jService, embeddingsService);

        const graphData = await parseProject({
          neo4jService,
          tsconfigPath,
          projectPath,
          clearExisting,
          projectType,
        });

        const { nodes, edges, savedCrossFileEdges } = graphData;

        console.log(`Parsed ${nodes.length} nodes / ${edges.length} edges`);
        await debugLog('Parsing completed', { nodeCount: nodes.length, edgeCount: edges.length });

        const outputPath = join(projectPath, FILE_PATHS.graphOutput);
        writeFileSync(outputPath, JSON.stringify(graphData, null, LOG_CONFIG.jsonIndentation));
        console.log(`Graph data written to ${outputPath}`);

        try {
          const result = await graphGeneratorHandler.generateGraph(outputPath, DEFAULTS.batchSize, clearExisting);

          // Recreate cross-file edges after incremental parse
          if (!clearExisting && savedCrossFileEdges.length > 0) {
            await debugLog('Recreating cross-file edges', { edgesToRecreate: savedCrossFileEdges.length });
            const recreateResult = await neo4jService.run(QUERIES.RECREATE_CROSS_FILE_EDGES, { edges: savedCrossFileEdges });
            const recreatedCount = recreateResult[0]?.recreatedCount ?? 0;
            await debugLog('Cross-file edges recreated', { recreatedCount, expected: savedCrossFileEdges.length });
          }

          console.log('Graph generation completed:', result);
          await debugLog('Neo4j import completed', result);

          return createSuccessResponse(formatParseSuccess(nodes.length, edges.length, result));
        } catch (neo4jError) {
          console.error('Neo4j import failed:', neo4jError);
          await debugLog('Neo4j import failed', neo4jError);

          return createSuccessResponse(
            formatParsePartialSuccess(nodes.length, edges.length, outputPath, neo4jError.message),
          );
        }
      } catch (error) {
        console.error('Parse tool error:', error);
        await debugLog('Parse tool error', { projectPath, tsconfigPath, error });
        return createErrorResponse(error);
      }
    },
  );
};

interface ParseProjectOptions {
  neo4jService: Neo4jService;
  tsconfigPath: string;
  projectPath: string;
  clearExisting?: boolean;
  projectType?: string;
}

interface CrossFileEdge {
  startNodeId: string;
  endNodeId: string;
  edgeType: string;
  edgeProperties: Record<string, any>;
}

interface ParseProjectResult {
  nodes: any[];
  edges: any[];
  savedCrossFileEdges: CrossFileEdge[];
  metadata: {
    coreSchema: string;
    frameworkSchemas: string[];
    projectType: string;
    generated: string;
    incremental?: {
      filesReparsed: number;
      filesDeleted: number;
    };
  };
}

const parseProject = async (options: ParseProjectOptions): Promise<ParseProjectResult> => {
  const { neo4jService, tsconfigPath, projectPath, clearExisting = true, projectType = 'auto' } = options;

  const parser =
    projectType === 'auto'
      ? await ParserFactory.createParserWithAutoDetection(projectPath, tsconfigPath)
      : ParserFactory.createParser({
          workspacePath: projectPath,
          tsConfigPath: tsconfigPath,
          projectType: projectType as ProjectType,
        });

  let incrementalStats: { filesReparsed: number; filesDeleted: number } | undefined;

  let savedCrossFileEdges: CrossFileEdge[] = [];

  if (clearExisting) {
    // Full rebuild: parse all files
    await parser.parseWorkspace();
  } else {
    // Incremental: detect changes and parse only affected files
    const { filesToReparse, filesToDelete } = await detectChangedFiles(projectPath, neo4jService);
    incrementalStats = { filesReparsed: filesToReparse.length, filesDeleted: filesToDelete.length };

    await debugLog('Incremental change detection', { filesToReparse, filesToDelete });

    const filesToRemoveFromGraph = [...filesToDelete, ...filesToReparse];
    if (filesToRemoveFromGraph.length > 0) {
      // Save cross-file edges before deletion (they'll be recreated after import)
      savedCrossFileEdges = await getCrossFileEdges(neo4jService, filesToRemoveFromGraph);
      await debugLog('Saved cross-file edges', { count: savedCrossFileEdges.length, edges: savedCrossFileEdges });

      await deleteSourceFileSubgraphs(neo4jService, filesToRemoveFromGraph);
    }

    if (filesToReparse.length > 0) {
      await debugLog('Incremental parse starting', { filesChanged: filesToReparse.length, filesDeleted: filesToDelete.length });

      // Load existing nodes from Neo4j for edge target matching
      const existingNodes = await loadExistingNodesForEdgeDetection(neo4jService, filesToRemoveFromGraph);
      await debugLog('Loaded existing nodes for edge detection', { count: existingNodes.length });
      parser.setExistingNodes(existingNodes);

      await parser.parseWorkspace(filesToReparse);
    } else {
      await debugLog('Incremental parse: no changes detected');
    }
  }

  const { nodes, edges } = parser.exportToJson();
  const frameworkSchemas = parser['frameworkSchemas']?.map((s: any) => s.name) ?? ['Auto-detected'];

  return {
    nodes,
    edges,
    savedCrossFileEdges,
    metadata: {
      coreSchema: CORE_TYPESCRIPT_SCHEMA.name,
      frameworkSchemas,
      projectType,
      generated: new Date().toISOString(),
      ...(incrementalStats && { incremental: incrementalStats }),
    },
  };
};

const deleteSourceFileSubgraphs = async (neo4jService: Neo4jService, filePaths: string[]): Promise<void> => {
  await neo4jService.run(QUERIES.DELETE_SOURCE_FILE_SUBGRAPHS, { filePaths });
};

const loadExistingNodesForEdgeDetection = async (
  neo4jService: Neo4jService,
  excludeFilePaths: string[],
): Promise<ExistingNode[]> => {
  const queryResult = await neo4jService.run(QUERIES.GET_EXISTING_NODES_FOR_EDGE_DETECTION, { excludeFilePaths });
  return queryResult as ExistingNode[];
};

interface IndexedFileInfo {
  filePath: string;
  mtime: number;
  size: number;
  contentHash: string;
}

const getCrossFileEdges = async (neo4jService: Neo4jService, filePaths: string[]): Promise<CrossFileEdge[]> => {
  const queryResult = await neo4jService.run(QUERIES.GET_CROSS_FILE_EDGES, { filePaths });
  return queryResult as CrossFileEdge[];
};

interface ChangedFilesResult {
  filesToReparse: string[];
  filesToDelete: string[];
}

const detectChangedFiles = async (projectPath: string, neo4jService: Neo4jService): Promise<ChangedFilesResult> => {
  const relativeFiles = await glob('**/*.ts', { cwd: projectPath, ignore: EXCLUDE_PATTERNS_GLOB });
  const currentFiles = new Set(relativeFiles.map((f) => resolve(projectPath, f)));

  const queryResult = await neo4jService.run(QUERIES.GET_SOURCE_FILE_TRACKING_INFO);
  const indexedFiles = queryResult as IndexedFileInfo[];
  const indexedMap = new Map(indexedFiles.map((f) => [f.filePath, f]));

  const filesToReparse: string[] = [];
  const filesToDelete: string[] = [];

  for (const absolutePath of currentFiles) {
    const indexed = indexedMap.get(absolutePath);

    if (!indexed) {
      filesToReparse.push(absolutePath);
      continue;
    }

    const fileStats = await stat(absolutePath);
    if (fileStats.mtimeMs === indexed.mtime && fileStats.size === indexed.size) {
      continue;
    }

    const currentHash = await hashFile(absolutePath);
    if (currentHash !== indexed.contentHash) {
      filesToReparse.push(absolutePath);
    }
  }

  for (const indexedPath of indexedMap.keys()) {
    if (!currentFiles.has(indexedPath)) {
      filesToDelete.push(indexedPath);
    }
  }

  return { filesToReparse, filesToDelete };
};
