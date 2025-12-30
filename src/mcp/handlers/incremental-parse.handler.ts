/**
 * Incremental Parse Handler
 * Handles incremental graph updates triggered by file watchers
 */

import { writeFileSync, unlinkSync } from 'fs';
import { stat, realpath } from 'fs/promises';
import { join, resolve, sep } from 'path';

import { glob } from 'glob';

import { EXCLUDE_PATTERNS_GLOB } from '../../constants.js';
import { CORE_TYPESCRIPT_SCHEMA } from '../../core/config/schema.js';
import { EmbeddingsService } from '../../core/embeddings/embeddings.service.js';
import { ParserFactory } from '../../core/parsers/parser-factory.js';
import type { ExistingNode } from '../../core/parsers/typescript-parser.js';
import { resolveProjectId, getProjectName, UPSERT_PROJECT_QUERY } from '../../core/utils/project-id.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';
import { hashFile } from '../../utils/file-utils.js';
import { DEFAULTS, FILE_PATHS, LOG_CONFIG } from '../constants.js';
import { debugLog } from '../utils.js';

import { GraphGeneratorHandler } from './graph-generator.handler.js';

interface CrossFileEdge {
  startNodeId: string;
  endNodeId: string;
  edgeType: string;
  edgeProperties: Record<string, unknown>;
}

interface IncrementalParseResult {
  nodesUpdated: number;
  edgesUpdated: number;
  filesReparsed: number;
  filesDeleted: number;
}

/**
 * Performs incremental parsing for a project
 * This is used by the WatchManager when files change
 */
export const performIncrementalParse = async (
  projectPath: string,
  projectId: string,
  tsconfigPath: string,
): Promise<IncrementalParseResult> => {
  const neo4jService = new Neo4jService();
  const embeddingsService = new EmbeddingsService();
  const graphHandler = new GraphGeneratorHandler(neo4jService, embeddingsService);

  try {
    await debugLog('Incremental parse started (watch)', { projectPath, projectId });

    // Resolve project ID
    const resolvedId = resolveProjectId(projectPath, projectId);
    const projectName = await getProjectName(projectPath);

    // Create parser with auto-detection and lazy loading enabled for memory efficiency
    const parser = await ParserFactory.createParserWithAutoDetection(projectPath, tsconfigPath, resolvedId, true);

    // Detect changed files
    const { filesToReparse, filesToDelete } = await detectChangedFilesForWatch(projectPath, neo4jService, resolvedId);

    await debugLog('Watch incremental change detection', {
      filesToReparse: filesToReparse.length,
      filesToDelete: filesToDelete.length,
    });

    // If no changes, return early
    if (filesToReparse.length === 0 && filesToDelete.length === 0) {
      await debugLog('Watch incremental: no changes detected');
      return {
        nodesUpdated: 0,
        edgesUpdated: 0,
        filesReparsed: 0,
        filesDeleted: filesToDelete.length,
      };
    }

    let savedCrossFileEdges: CrossFileEdge[] = [];
    const filesToRemoveFromGraph = [...filesToDelete, ...filesToReparse];

    if (filesToRemoveFromGraph.length > 0) {
      // Save cross-file edges before deletion
      savedCrossFileEdges = await getCrossFileEdges(neo4jService, filesToRemoveFromGraph, resolvedId);
      await debugLog('Watch: saved cross-file edges', { count: savedCrossFileEdges.length });

      // Delete old subgraphs
      await deleteSourceFileSubgraphs(neo4jService, filesToRemoveFromGraph, resolvedId);
    }

    let nodesImported = 0;
    let edgesImported = 0;

    if (filesToReparse.length > 0) {
      // Load existing nodes for edge detection
      const existingNodes = await loadExistingNodesForEdgeDetection(neo4jService, filesToRemoveFromGraph, resolvedId);
      parser.setExistingNodes(existingNodes);

      // Parse only changed files
      await parser.parseWorkspace(filesToReparse);

      // Export graph data
      const { nodes, edges } = parser.exportToJson();
      // Get framework schemas if available (use unknown as intermediate to access private property)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parserAny = parser as any;
      const frameworkSchemas: string[] = Array.isArray(parserAny.frameworkSchemas)
        ? parserAny.frameworkSchemas.map((s: { name: string }) => s.name)
        : ['Auto-detected'];

      const graphData = {
        nodes,
        edges,
        metadata: {
          coreSchema: CORE_TYPESCRIPT_SCHEMA.name,
          frameworkSchemas,
          projectType: 'auto',
          projectId: resolvedId,
          generated: new Date().toISOString(),
        },
      };

      // Write to JSON file (required by GraphGeneratorHandler)
      const outputPath = join(projectPath, FILE_PATHS.graphOutput);
      writeFileSync(outputPath, JSON.stringify(graphData, null, LOG_CONFIG.jsonIndentation));

      // Update Project node
      await neo4jService.run(UPSERT_PROJECT_QUERY, {
        projectId: resolvedId,
        path: projectPath,
        name: projectName,
        status: 'complete',
      });

      // Import nodes and edges (clearExisting = false for incremental)
      graphHandler.setProjectId(resolvedId);
      try {
        const result = await graphHandler.generateGraph(outputPath, DEFAULTS.batchSize, false);
        nodesImported = result.nodesImported;
        edgesImported = result.edgesImported;
      } finally {
        // Clean up temporary graph.json file
        try {
          unlinkSync(outputPath);
        } catch {
          // Ignore cleanup errors - file may not exist or be inaccessible
        }
      }

      // Recreate cross-file edges
      if (savedCrossFileEdges.length > 0) {
        const recreateResult = await neo4jService.run(QUERIES.RECREATE_CROSS_FILE_EDGES, {
          projectId: resolvedId,
          edges: savedCrossFileEdges.map((e) => ({
            startNodeId: e.startNodeId,
            endNodeId: e.endNodeId,
            edgeType: e.edgeType,
            edgeProperties: e.edgeProperties,
          })),
        });
        // Safely extract recreatedCount with runtime validation
        const firstResult = recreateResult[0];
        const recreatedCount =
          firstResult && typeof firstResult === 'object' && 'recreatedCount' in firstResult
            ? Number(firstResult.recreatedCount) || 0
            : 0;
        edgesImported += recreatedCount;
        await debugLog('Watch: cross-file edges recreated', { recreatedCount });
      }
    }

    await debugLog('Watch incremental parse completed', {
      nodesImported,
      edgesImported,
      filesReparsed: filesToReparse.length,
      filesDeleted: filesToDelete.length,
    });

    return {
      nodesUpdated: nodesImported,
      edgesUpdated: edgesImported,
      filesReparsed: filesToReparse.length,
      filesDeleted: filesToDelete.length,
    };
  } finally {
    await neo4jService.close();
  }
};

// Helper functions (similar to parse-typescript-project.tool.ts)

const deleteSourceFileSubgraphs = async (
  neo4jService: Neo4jService,
  filePaths: string[],
  projectId: string,
): Promise<void> => {
  await neo4jService.run(QUERIES.DELETE_SOURCE_FILE_SUBGRAPHS, { filePaths, projectId });
};

const loadExistingNodesForEdgeDetection = async (
  neo4jService: Neo4jService,
  excludeFilePaths: string[],
  projectId: string,
): Promise<ExistingNode[]> => {
  const queryResult = await neo4jService.run(QUERIES.GET_EXISTING_NODES_FOR_EDGE_DETECTION, {
    excludeFilePaths,
    projectId,
  });
  return queryResult as ExistingNode[];
};

const getCrossFileEdges = async (
  neo4jService: Neo4jService,
  filePaths: string[],
  projectId: string,
): Promise<CrossFileEdge[]> => {
  const queryResult = await neo4jService.run(QUERIES.GET_CROSS_FILE_EDGES, { filePaths, projectId });
  return queryResult as CrossFileEdge[];
};

interface IndexedFileInfo {
  filePath: string;
  mtime: number;
  size: number;
  contentHash: string;
}

interface ChangedFilesResult {
  filesToReparse: string[];
  filesToDelete: string[];
}

const detectChangedFilesForWatch = async (
  projectPath: string,
  neo4jService: Neo4jService,
  projectId: string,
): Promise<ChangedFilesResult> => {
  const realProjectPath = await realpath(projectPath);
  const relativeFiles = await glob('**/*.{ts,tsx}', { cwd: projectPath, ignore: EXCLUDE_PATTERNS_GLOB });

  const validatedFiles: string[] = [];
  for (const relFile of relativeFiles) {
    const absolutePath = resolve(projectPath, relFile);
    try {
      const realFilePath = await realpath(absolutePath);
      if (realFilePath.startsWith(realProjectPath + sep) || realFilePath === realProjectPath) {
        validatedFiles.push(realFilePath);
      }
    } catch {
      // File may have been deleted
    }
  }

  const currentFiles = new Set(validatedFiles);

  const queryResult = await neo4jService.run(QUERIES.GET_SOURCE_FILE_TRACKING_INFO, { projectId });
  const indexedFiles = queryResult as IndexedFileInfo[];
  const indexedMap = new Map(indexedFiles.map((f) => [f.filePath, f]));

  const filesToReparse: string[] = [];
  const filesToDelete: string[] = [];

  for (const filePath of currentFiles) {
    const indexed = indexedMap.get(filePath);

    if (!indexed) {
      filesToReparse.push(filePath);
      continue;
    }

    try {
      const fileStats = await stat(filePath);
      const currentHash = await hashFile(filePath);

      if (
        fileStats.mtimeMs === indexed.mtime &&
        fileStats.size === indexed.size &&
        currentHash === indexed.contentHash
      ) {
        continue;
      }

      filesToReparse.push(filePath);
    } catch (error: unknown) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        // Will be caught in deletion logic
      } else if (nodeError.code === 'EACCES') {
        filesToReparse.push(filePath);
      } else {
        throw error;
      }
    }
  }

  for (const indexedPath of indexedMap.keys()) {
    if (!currentFiles.has(indexedPath)) {
      filesToDelete.push(indexedPath);
    }
  }

  return { filesToReparse, filesToDelete };
};
