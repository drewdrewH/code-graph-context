/**
 * Parse Worker
 * Runs TypeScript parsing in a separate thread to avoid blocking the MCP server
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parentPort, workerData } from 'worker_threads';

// Load environment variables in worker thread
import dotenv from 'dotenv';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '..', '..', '.env') });

import { EmbeddingsService } from '../../core/embeddings/embeddings.service.js';
import { ParserFactory, ProjectType } from '../../core/parsers/parser-factory.js';
import { WorkspaceParser } from '../../core/parsers/workspace-parser.js';
import { debugLog } from '../../core/utils/file-utils.js';
import { getProjectName, UPSERT_PROJECT_QUERY, UPDATE_PROJECT_STATUS_QUERY } from '../../core/utils/project-id.js';
import { WorkspaceDetector } from '../../core/workspace/index.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';
import { GraphGeneratorHandler } from '../handlers/graph-generator.handler.js';
import { StreamingImportHandler } from '../handlers/streaming-import.handler.js';

interface WorkerData {
  projectPath: string;
  tsconfigPath: string;
  projectId: string;
  projectType: string;
  chunkSize: number;
}

interface ProgressMessage {
  type: 'progress';
  data: {
    phase: string;
    filesProcessed: number;
    filesTotal: number;
    nodesImported: number;
    edgesImported: number;
    currentChunk: number;
    totalChunks: number;
  };
}

interface CompleteMessage {
  type: 'complete';
  data: {
    nodesImported: number;
    edgesImported: number;
    elapsedMs: number;
  };
}

interface ErrorMessage {
  type: 'error';
  error: string;
}

type WorkerMessage = ProgressMessage | CompleteMessage | ErrorMessage;

const sendMessage = (msg: WorkerMessage): void => {
  parentPort?.postMessage(msg);
};

const runParser = async (): Promise<void> => {
  const config = workerData as WorkerData;
  const startTime = Date.now();

  // Declare outside try block so it's available in catch/finally
  let resolvedProjectId: string = config.projectId;
  let neo4jService: Neo4jService | null = null;

  try {
    sendMessage({
      type: 'progress',
      data: {
        phase: 'discovery',
        filesProcessed: 0,
        filesTotal: 0,
        nodesImported: 0,
        edgesImported: 0,
        currentChunk: 0,
        totalChunks: 0,
      },
    });

    neo4jService = new Neo4jService();
    const embeddingsService = new EmbeddingsService();
    const graphGeneratorHandler = new GraphGeneratorHandler(neo4jService, embeddingsService);

    // Use lazy loading to avoid OOM on large projects
    const lazyLoad = true;

    // Auto-detect workspace (Turborepo, pnpm, yarn, npm workspaces)
    const workspaceDetector = new WorkspaceDetector();
    await debugLog('Detecting workspace', { projectPath: config.projectPath });
    const workspaceConfig = await workspaceDetector.detect(config.projectPath);
    await debugLog('Workspace detection result', {
      type: workspaceConfig.type,
      rootPath: workspaceConfig.rootPath,
      packageCount: workspaceConfig.packages.length,
      packages: workspaceConfig.packages.map((p) => p.name),
    });

    // Use WorkspaceParser for monorepos, TypeScriptParser for single projects
    let parser: WorkspaceParser | ReturnType<typeof ParserFactory.createParser>;

    if (workspaceConfig.type !== 'single' && workspaceConfig.packages.length > 1) {
      await debugLog('Using WorkspaceParser', {
        type: workspaceConfig.type,
        packageCount: workspaceConfig.packages.length,
      });
      // for workspaces default to auto for now
      // TODO: allow worker config to specify projectType array to support multi-framework monorepos
      parser = new WorkspaceParser(workspaceConfig, config.projectId, lazyLoad, 'auto');
      resolvedProjectId = parser.getProjectId();
    } else {
      await debugLog('Using single project mode', {
        type: workspaceConfig.type,
        packageCount: workspaceConfig.packages.length,
      });
      parser =
        config.projectType === 'auto'
          ? await ParserFactory.createParserWithAutoDetection(
              config.projectPath,
              config.tsconfigPath,
              config.projectId,
              lazyLoad,
            )
          : ParserFactory.createParser({
              workspacePath: config.projectPath,
              tsConfigPath: config.tsconfigPath,
              projectType: config.projectType as ProjectType,
              projectId: config.projectId,
              lazyLoad,
            });
      resolvedProjectId = parser.getProjectId();
    }

    // Use async file discovery (works in lazy mode)
    const sourceFiles = await parser.discoverSourceFiles();
    const totalFiles = sourceFiles.length;

    sendMessage({
      type: 'progress',
      data: {
        phase: 'parsing',
        filesProcessed: 0,
        filesTotal: totalFiles,
        nodesImported: 0,
        edgesImported: 0,
        currentChunk: 0,
        totalChunks: Math.ceil(totalFiles / config.chunkSize),
      },
    });

    // Clear existing project data first
    graphGeneratorHandler.setProjectId(resolvedProjectId);
    await neo4jService.run(QUERIES.CLEAR_PROJECT, { projectId: resolvedProjectId });

    // Create/update Project node with 'parsing' status
    const projectName = await getProjectName(config.projectPath);
    await neo4jService.run(UPSERT_PROJECT_QUERY, {
      projectId: resolvedProjectId,
      name: projectName,
      path: config.projectPath,
      status: 'parsing',
    });
    await debugLog('Project node created', { projectId: resolvedProjectId, name: projectName });

    const streamingHandler = new StreamingImportHandler(graphGeneratorHandler);

    const result = await streamingHandler.importProjectStreaming(parser, {
      chunkSize: config.chunkSize > 0 ? config.chunkSize : 100,
      projectId: resolvedProjectId,
      onProgress: async (progress) => {
        sendMessage({
          type: 'progress',
          data: {
            phase: progress.phase,
            filesProcessed: progress.current,
            filesTotal: progress.total,
            nodesImported: progress.details?.nodesCreated ?? 0,
            edgesImported: progress.details?.edgesCreated ?? 0,
            currentChunk: progress.details?.chunkIndex ?? 0,
            totalChunks: progress.details?.totalChunks ?? 0,
          },
        });
      },
    });

    // Update Project node with 'complete' status and final counts
    await neo4jService.run(UPDATE_PROJECT_STATUS_QUERY, {
      projectId: resolvedProjectId,
      status: 'complete',
      nodeCount: result.nodesImported,
      edgeCount: result.edgesImported,
    });
    await debugLog('Project node updated', {
      projectId: resolvedProjectId,
      status: 'complete',
      nodeCount: result.nodesImported,
      edgeCount: result.edgesImported,
    });

    sendMessage({
      type: 'complete',
      data: {
        nodesImported: result.nodesImported,
        edgesImported: result.edgesImported,
        elapsedMs: Date.now() - startTime,
      },
    });
  } catch (error: any) {
    // Try to update Project node with 'failed' status
    try {
      // Use existing service if available, otherwise create temporary one
      const serviceForUpdate = neo4jService ?? new Neo4jService();
      await serviceForUpdate.run(UPDATE_PROJECT_STATUS_QUERY, {
        projectId: resolvedProjectId, // Use resolved ID, not config.projectId
        status: 'failed',
        nodeCount: 0,
        edgeCount: 0,
      });
      // Close temporary service if we created one
      if (!neo4jService) {
        await serviceForUpdate.close();
      }
    } catch {
      // Ignore errors updating project status on failure
    }

    sendMessage({
      type: 'error',
      error: error.message ?? String(error),
    });
  } finally {
    // Always close the Neo4j connection to prevent resource leaks
    if (neo4jService) {
      try {
        await neo4jService.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
};

// Run the parser
runParser().catch((err) => {
  sendMessage({
    type: 'error',
    error: err.message ?? String(err),
  });
});
