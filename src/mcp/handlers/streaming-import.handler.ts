/**
 * Streaming Import Handler
 * Orchestrates chunked parsing and import for large codebases
 */

import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';

import { Neo4jNode, Neo4jEdge } from '../../core/config/schema.js';
import { StreamingParser } from '../../core/parsers/typescript-parser.js';
import { ProgressCallback, ProgressReporter } from '../../core/utils/progress-reporter.js';
import { DEFAULTS } from '../constants.js';
import { debugLog } from '../utils.js';

/**
 * Generate a secure temporary file path using crypto random bytes
 * to avoid race conditions and predictable filenames
 */
const generateTempPath = (prefix: string): string => {
  const randomSuffix = randomBytes(16).toString('hex');
  return join(tmpdir(), `${prefix}-${Date.now()}-${randomSuffix}.json`);
};

import { GraphGeneratorHandler } from './graph-generator.handler.js';

export interface StreamingImportConfig {
  chunkSize: number; // Files per chunk (default: 50)
  projectId: string;
  onProgress?: ProgressCallback;
}

export interface StreamingImportResult {
  nodesImported: number;
  edgesImported: number;
  filesProcessed: number;
  chunksProcessed: number;
  elapsedMs: number;
}

export class StreamingImportHandler {
  private progressReporter: ProgressReporter;

  constructor(private readonly graphGeneratorHandler: GraphGeneratorHandler) {
    this.progressReporter = new ProgressReporter();
  }

  /**
   * Import a project using chunked parsing to reduce memory usage.
   * Files are parsed and imported in chunks, with progress reporting.
   * Supports both TypeScriptParser (single project) and WorkspaceParser (monorepo).
   */
  async importProjectStreaming(parser: StreamingParser, config: StreamingImportConfig): Promise<StreamingImportResult> {
    const startTime = Date.now();

    if (config.onProgress) {
      this.progressReporter.setCallback(config.onProgress);
    }

    // Set project ID on graph generator
    this.graphGeneratorHandler.setProjectId(config.projectId);

    // Phase 1: Get discovered files (already discovered by worker, this returns cached result)
    const allFilePaths = await parser.discoverSourceFiles();

    console.log(`📁 Found ${allFilePaths.length} files to parse`);
    await debugLog('Streaming import started', {
      totalFiles: allFilePaths.length,
      chunkSize: config.chunkSize,
    });

    // Create chunks
    const chunks: string[][] = [];
    for (let i = 0; i < allFilePaths.length; i += config.chunkSize) {
      chunks.push(allFilePaths.slice(i, i + config.chunkSize));
    }

    console.log(`📦 Split into ${chunks.length} chunks of ~${config.chunkSize} files each`);

    let totalNodesImported = 0;
    let totalEdgesImported = 0;

    // Phase 2: Parse and import chunks
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const filesProcessed = chunkIndex * config.chunkSize + chunk.length;

      console.log(`\n🔄 Processing chunk ${chunkIndex + 1}/${chunks.length} (${chunk.length} files)`);

      try {
        // Parse the chunk (skip edge resolution for streaming)
        const { nodes, edges } = await parser.parseChunk(chunk, true);

        // Add parsed nodes to existing nodes for cross-chunk edge resolution
        parser.addExistingNodesFromChunk(nodes);

        // Import to Neo4j if we have data
        if (nodes.length > 0 || edges.length > 0) {
          await debugLog('Importing chunk - generating embeddings', {
            chunkIndex: chunkIndex + 1,
            totalChunks: chunks.length,
            nodeCount: nodes.length,
          });
          await this.importChunkToNeo4j(nodes, edges);
          totalNodesImported += nodes.length;
          totalEdgesImported += edges.length;
        } else {
          console.warn(`⚠️ Chunk ${chunkIndex + 1} produced 0 nodes/edges from ${chunk.length} files`);
          await debugLog('Empty chunk result', {
            chunkIndex: chunkIndex + 1,
            fileCount: chunk.length,
            sampleFiles: chunk.slice(0, 3),
          });
        }

        // Report progress with all relevant data
        await this.progressReporter.report({
          phase: 'importing',
          current: filesProcessed,
          total: allFilePaths.length,
          message: `Processed chunk ${chunkIndex + 1}/${chunks.length}: ${totalNodesImported} nodes, ${totalEdgesImported} edges`,
          details: {
            filesProcessed,
            nodesCreated: totalNodesImported,
            edgesCreated: totalEdgesImported,
            currentFile: chunk[0],
            chunkIndex: chunkIndex + 1,
            totalChunks: chunks.length,
          },
        });

        console.log(`✅ Chunk ${chunkIndex + 1}: ${nodes.length} nodes, ${edges.length} edges imported`);
      } catch (chunkError) {
        console.error(`❌ Error processing chunk ${chunkIndex + 1}:`, chunkError);
        await debugLog('Chunk processing error', {
          chunkIndex: chunkIndex + 1,
          fileCount: chunk.length,
          sampleFiles: chunk.slice(0, 3),
          error: chunkError instanceof Error ? chunkError.message : String(chunkError),
          stack: chunkError instanceof Error ? chunkError.stack : undefined,
        });
        // Re-throw to fail the entire import - don't silently continue
        throw chunkError;
      }

      // Note: Don't clear parsed data during streaming - we need accumulated nodes for cross-chunk edge resolution
      // Memory usage is bounded because we only keep Neo4jNode references (not full AST)
    }

    // Phase 3: Resolve cross-chunk deferred edges
    await this.progressReporter.reportResolving(0, totalEdgesImported);
    console.log('\n🔗 Resolving cross-chunk edges...');

    const resolvedEdges = await parser.resolveDeferredEdgesManually();
    if (resolvedEdges.length > 0) {
      await this.importEdgesToNeo4j(resolvedEdges);
      totalEdgesImported += resolvedEdges.length;
      console.log(`✅ Resolved ${resolvedEdges.length} cross-chunk edges`);
    } else {
      console.log('ℹ️ No cross-chunk edges to resolve');
    }

    // Clear accumulated data now that edge resolution is complete
    parser.clearParsedData();

    await this.progressReporter.reportResolving(resolvedEdges.length, resolvedEdges.length);

    // Phase 4: Complete
    const elapsedMs = Date.now() - startTime;
    await this.progressReporter.reportComplete(totalNodesImported, totalEdgesImported);

    const result: StreamingImportResult = {
      nodesImported: totalNodesImported,
      edgesImported: totalEdgesImported,
      filesProcessed: allFilePaths.length,
      chunksProcessed: chunks.length,
      elapsedMs,
    };

    console.log(`\n🎉 Streaming import complete!`);
    console.log(`   Files: ${allFilePaths.length}`);
    console.log(`   Nodes: ${totalNodesImported}`);
    console.log(`   Edges: ${totalEdgesImported}`);
    console.log(`   Time: ${(elapsedMs / 1000).toFixed(2)}s`);

    await debugLog('Streaming import completed', result);

    return result;
  }

  /**
   * Import a chunk of nodes and edges to Neo4j using the graph generator handler
   */
  private async importChunkToNeo4j(nodes: Neo4jNode[], edges: Neo4jEdge[]): Promise<void> {
    // Write to temporary JSON and use existing import mechanism
    // This reuses the batched embedding and import logic
    const tempPath = generateTempPath('chunk');
    const fs = await import('fs/promises');

    try {
      await fs.writeFile(
        tempPath,
        JSON.stringify({
          nodes,
          edges,
          metadata: { chunked: true },
        }),
      );

      await this.graphGeneratorHandler.generateGraph(tempPath, DEFAULTS.batchSize, false);
    } finally {
      // Clean up temp file
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Import resolved edges to Neo4j
   */
  private async importEdgesToNeo4j(edges: Neo4jEdge[]): Promise<void> {
    if (edges.length === 0) return;

    const tempPath = generateTempPath('edges');
    const fs = await import('fs/promises');

    try {
      await fs.writeFile(
        tempPath,
        JSON.stringify({
          nodes: [],
          edges,
          metadata: { edgesOnly: true },
        }),
      );

      await this.graphGeneratorHandler.generateGraph(tempPath, DEFAULTS.batchSize, false);
    } finally {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
