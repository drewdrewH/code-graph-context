/**
 * Progress Reporter
 * Provides progress updates during long-running operations like parsing large codebases
 */

export interface ProgressUpdate {
  phase: 'discovery' | 'parsing' | 'importing' | 'resolving' | 'complete';
  current: number;
  total: number;
  message: string;
  details?: {
    filesProcessed?: number;
    nodesCreated?: number;
    edgesCreated?: number;
    currentFile?: string;
    chunkIndex?: number;
    totalChunks?: number;
    elapsedMs?: number;
  };
}

export type ProgressCallback = (progress: ProgressUpdate) => Promise<void>;

export class ProgressReporter {
  private callback?: ProgressCallback;
  private startTime: number = Date.now();

  /**
   * Set the progress callback function
   */
  setCallback(callback: ProgressCallback): void {
    this.callback = callback;
    this.startTime = Date.now();
  }

  /**
   * Report progress update
   */
  async report(update: ProgressUpdate): Promise<void> {
    if (!this.callback) return;

    // Add elapsed time to details
    const enrichedUpdate: ProgressUpdate = {
      ...update,
      details: {
        ...update.details,
        elapsedMs: Date.now() - this.startTime,
      },
    };

    try {
      await this.callback(enrichedUpdate);
    } catch (error) {
      // Don't let progress reporting errors interrupt the main operation
      console.warn('Progress callback error:', error);
    }
  }

  /**
   * Report discovery phase progress
   */
  async reportDiscovery(filesFound: number, message?: string): Promise<void> {
    await this.report({
      phase: 'discovery',
      current: filesFound,
      total: filesFound,
      message: message ?? `Discovered ${filesFound} files`,
    });
  }

  /**
   * Report parsing phase progress
   */
  async reportParsing(
    current: number,
    total: number,
    currentFile?: string,
    chunkIndex?: number,
    totalChunks?: number,
  ): Promise<void> {
    await this.report({
      phase: 'parsing',
      current,
      total,
      message: `Parsing files: ${current}/${total}`,
      details: {
        filesProcessed: current,
        currentFile,
        chunkIndex,
        totalChunks,
      },
    });
  }

  /**
   * Report importing phase progress
   */
  async reportImporting(nodesCreated: number, edgesCreated: number, total: number): Promise<void> {
    await this.report({
      phase: 'importing',
      current: nodesCreated + edgesCreated,
      total,
      message: `Importing: ${nodesCreated} nodes, ${edgesCreated} edges`,
      details: {
        nodesCreated,
        edgesCreated,
      },
    });
  }

  /**
   * Report edge resolution phase
   */
  async reportResolving(resolved: number, total: number): Promise<void> {
    await this.report({
      phase: 'resolving',
      current: resolved,
      total,
      message: `Resolving cross-file edges: ${resolved}/${total}`,
    });
  }

  /**
   * Report completion
   */
  async reportComplete(nodesCreated: number, edgesCreated: number): Promise<void> {
    await this.report({
      phase: 'complete',
      current: 1,
      total: 1,
      message: `Complete: ${nodesCreated} nodes, ${edgesCreated} edges`,
      details: {
        nodesCreated,
        edgesCreated,
      },
    });
  }

  /**
   * Reset the start time (call when starting a new operation)
   */
  reset(): void {
    this.startTime = Date.now();
  }
}
