/**
 * Watch Manager Service
 * Manages file watchers for incremental graph updates across projects
 * Uses @parcel/watcher for high-performance file watching
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import * as watcher from '@parcel/watcher';
import type { AsyncSubscription } from '@parcel/watcher';

import { debugLog } from '../utils.js';

export type WatchEventType = 'add' | 'change' | 'unlink';

export interface WatchEvent {
  type: WatchEventType;
  filePath: string;
  timestamp: number;
}

export interface WatcherConfig {
  projectPath: string;
  projectId: string;
  tsconfigPath: string;
  debounceMs: number;
  excludePatterns: string[];
}

export interface WatcherState {
  projectId: string;
  projectPath: string;
  tsconfigPath: string;
  subscription: AsyncSubscription | null;
  config: WatcherConfig;
  pendingEvents: WatchEvent[];
  debounceTimer: ReturnType<typeof setTimeout> | null;
  isProcessing: boolean;
  isStopping: boolean;
  lastUpdateTime: Date | null;
  status: 'active' | 'paused' | 'error';
  errorMessage?: string;
  syncPromise?: Promise<void>;
}

export interface WatcherInfo {
  projectId: string;
  projectPath: string;
  status: 'active' | 'paused' | 'error';
  lastUpdateTime: string | null;
  pendingChanges: number;
  debounceMs: number;
  errorMessage?: string;
}

export interface WatchNotification {
  type:
    | 'file_change_detected'
    | 'incremental_parse_started'
    | 'incremental_parse_completed'
    | 'incremental_parse_failed';
  projectId: string;
  projectPath: string;
  data: {
    filesChanged?: string[];
    filesAdded?: string[];
    filesDeleted?: string[];
    nodesUpdated?: number;
    edgesUpdated?: number;
    elapsedMs?: number;
    error?: string;
  };
  timestamp: string;
}

export type IncrementalParseHandler = (
  projectPath: string,
  projectId: string,
  tsconfigPath: string,
) => Promise<{ nodesUpdated: number; edgesUpdated: number }>;

const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/*.d.ts',
  '**/*.js.map',
  '**/*.js',
];

const DEFAULT_DEBOUNCE_MS = 1000;
const MAX_WATCHERS = 10;
const MAX_PENDING_EVENTS = 1000;

class WatchManager {
  private watchers: Map<string, WatcherState> = new Map();
  private mcpServer: Server | null = null;
  private incrementalParseHandler: IncrementalParseHandler | null = null;

  /**
   * Set the MCP server instance for sending notifications
   */
  setMcpServer(server: Server): void {
    this.mcpServer = server;
  }

  /**
   * Set the incremental parse handler function
   */
  setIncrementalParseHandler(handler: IncrementalParseHandler): void {
    this.incrementalParseHandler = handler;
  }

  /**
   * Send a notification via MCP logging (if supported)
   */
  private sendNotification(notification: WatchNotification): void {
    if (!this.mcpServer) {
      return;
    }

    // sendLoggingMessage returns a Promise - use .catch() to handle rejection
    this.mcpServer
      .sendLoggingMessage({
        level: notification.type.includes('failed') ? 'error' : 'info',
        logger: 'file-watcher',
        data: notification,
      })
      .catch(() => {
        // MCP logging not supported - silently ignore
        // This is expected if the client doesn't support logging capability
      });
  }

  /**
   * Start watching a project for file changes
   */
  async startWatching(
    config: Partial<WatcherConfig> & { projectPath: string; projectId: string; tsconfigPath: string },
  ): Promise<WatcherInfo> {
    // Check if already watching this project
    if (this.watchers.has(config.projectId)) {
      const existing = this.watchers.get(config.projectId)!;
      return this.getWatcherInfoFromState(existing);
    }

    // Enforce maximum watcher limit
    if (this.watchers.size >= MAX_WATCHERS) {
      throw new Error(
        `Maximum watcher limit (${MAX_WATCHERS}) reached. ` + `Stop an existing watcher before starting a new one.`,
      );
    }

    const fullConfig: WatcherConfig = {
      projectPath: config.projectPath,
      projectId: config.projectId,
      tsconfigPath: config.tsconfigPath,
      debounceMs: config.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      excludePatterns: config.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS,
    };

    await debugLog('Creating @parcel/watcher subscription', {
      watchPath: fullConfig.projectPath,
      ignored: fullConfig.excludePatterns,
    });

    // Create state object first (subscription will be added after)
    const state: WatcherState = {
      projectId: fullConfig.projectId,
      projectPath: fullConfig.projectPath,
      tsconfigPath: fullConfig.tsconfigPath,
      subscription: null, // Will be set after successful subscription
      config: fullConfig,
      pendingEvents: [],
      debounceTimer: null,
      isProcessing: false,
      isStopping: false,
      lastUpdateTime: null,
      status: 'active',
    };

    try {
      // Subscribe to file changes using @parcel/watcher
      const subscription = await watcher.subscribe(
        fullConfig.projectPath,
        (err, events) => {
          if (err) {
            this.handleWatcherError(state, err);
            return;
          }

          for (const event of events) {
            try {
              // Filter for TypeScript files
              if (!event.path.endsWith('.ts') && !event.path.endsWith('.tsx')) {
                continue;
              }

              // Map parcel event types to our event types
              let eventType: WatchEventType;
              if (event.type === 'create') {
                eventType = 'add';
              } else if (event.type === 'delete') {
                eventType = 'unlink';
              } else {
                eventType = 'change';
              }

              this.handleFileEvent(state, eventType, event.path);
            } catch (error) {
              debugLog('Error processing file event', { error: String(error), path: event.path });
            }
          }
        },
        {
          ignore: fullConfig.excludePatterns,
        },
      );

      state.subscription = subscription;
      this.watchers.set(fullConfig.projectId, state);

      await debugLog('Watcher started', { projectId: fullConfig.projectId, projectPath: fullConfig.projectPath });

      // Check for changes that occurred while watcher was off (run in background)
      this.syncMissedChanges(state);

      return this.getWatcherInfoFromState(state);
    } catch (error) {
      await debugLog('Failed to start watcher', { error: String(error) });
      throw error;
    }
  }

  /**
   * Handle a file system event
   */
  private handleFileEvent(state: WatcherState, type: WatchEventType, filePath: string): void {
    debugLog('File event received', { type, filePath, projectId: state.projectId, status: state.status });

    // Ignore events if watcher is stopping or not active
    if (state.isStopping || state.status !== 'active') {
      debugLog('Ignoring event - watcher not active or stopping', {
        status: state.status,
        isStopping: state.isStopping,
      });
      return;
    }

    const event: WatchEvent = {
      type,
      filePath,
      timestamp: Date.now(),
    };

    // Prevent unbounded event accumulation - drop oldest events if buffer is full
    if (state.pendingEvents.length >= MAX_PENDING_EVENTS) {
      debugLog('Event buffer full, dropping oldest events', { projectId: state.projectId });
      state.pendingEvents = state.pendingEvents.slice(-Math.floor(MAX_PENDING_EVENTS / 2));
    }

    state.pendingEvents.push(event);
    debugLog('Event added to pending', { pendingCount: state.pendingEvents.length });

    // Clear existing debounce timer
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }

    // Send immediate notification about file change detected
    this.sendNotification({
      type: 'file_change_detected',
      projectId: state.projectId,
      projectPath: state.projectPath,
      data: {
        filesChanged: state.pendingEvents.filter((e) => e.type === 'change').map((e) => e.filePath),
        filesAdded: state.pendingEvents.filter((e) => e.type === 'add').map((e) => e.filePath),
        filesDeleted: state.pendingEvents.filter((e) => e.type === 'unlink').map((e) => e.filePath),
      },
      timestamp: new Date().toISOString(),
    });

    // Set new debounce timer
    state.debounceTimer = setTimeout(() => {
      this.processEvents(state).catch((error) => {
        console.error('[WatchManager] Error in processEvents:', error);
      });
    }, state.config.debounceMs);
  }

  /**
   * Process accumulated file events after debounce period
   */
  private async processEvents(state: WatcherState): Promise<void> {
    // Don't process if already processing, no events, or watcher is stopping
    if (state.isProcessing || state.pendingEvents.length === 0 || state.isStopping) return;

    state.isProcessing = true;
    const events = [...state.pendingEvents];
    state.pendingEvents = [];
    state.debounceTimer = null;

    const startTime = Date.now();

    this.sendNotification({
      type: 'incremental_parse_started',
      projectId: state.projectId,
      projectPath: state.projectPath,
      data: {
        filesChanged: events.filter((e) => e.type === 'change').map((e) => e.filePath),
        filesAdded: events.filter((e) => e.type === 'add').map((e) => e.filePath),
        filesDeleted: events.filter((e) => e.type === 'unlink').map((e) => e.filePath),
      },
      timestamp: new Date().toISOString(),
    });

    try {
      if (!this.incrementalParseHandler) {
        throw new Error('Incremental parse handler not configured');
      }

      const result = await this.incrementalParseHandler(state.projectPath, state.projectId, state.tsconfigPath);

      state.lastUpdateTime = new Date();
      const elapsedMs = Date.now() - startTime;

      this.sendNotification({
        type: 'incremental_parse_completed',
        projectId: state.projectId,
        projectPath: state.projectPath,
        data: {
          filesChanged: events.filter((e) => e.type === 'change').map((e) => e.filePath),
          filesAdded: events.filter((e) => e.type === 'add').map((e) => e.filePath),
          filesDeleted: events.filter((e) => e.type === 'unlink').map((e) => e.filePath),
          nodesUpdated: result.nodesUpdated,
          edgesUpdated: result.edgesUpdated,
          elapsedMs,
        },
        timestamp: new Date().toISOString(),
      });

      console.log(
        `[WatchManager] Incremental parse completed for ${state.projectId}: ` +
          `${result.nodesUpdated} nodes, ${result.edgesUpdated} edges in ${elapsedMs}ms`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.sendNotification({
        type: 'incremental_parse_failed',
        projectId: state.projectId,
        projectPath: state.projectPath,
        data: {
          error: errorMessage,
          elapsedMs: Date.now() - startTime,
        },
        timestamp: new Date().toISOString(),
      });

      console.error(`[WatchManager] Incremental parse failed for ${state.projectId}:`, error);
    } finally {
      state.isProcessing = false;
    }
  }

  /**
   * Handle watcher error
   */
  private handleWatcherError(state: WatcherState, error: unknown): void {
    state.status = 'error';
    state.errorMessage = error instanceof Error ? error.message : String(error);
    debugLog('Watcher error', { projectId: state.projectId, error: state.errorMessage });

    // Clean up the failed watcher to prevent it from staying in error state indefinitely
    this.stopWatching(state.projectId).catch((cleanupError) => {
      console.error(`[WatchManager] Failed to cleanup errored watcher ${state.projectId}:`, cleanupError);
    });
  }

  /**
   * Sync any changes that occurred while the watcher was off
   * Runs in the background without blocking watcher startup
   * Promise is tracked on state to allow cleanup during stop
   */
  private syncMissedChanges(state: WatcherState): void {
    if (!this.incrementalParseHandler) return;

    // Track the promise on state so stopWatching can wait for it
    state.syncPromise = this.incrementalParseHandler(state.projectPath, state.projectId, state.tsconfigPath)
      .then((result) => {
        if (result.nodesUpdated > 0 || result.edgesUpdated > 0) {
          console.log(
            `[WatchManager] Synced missed changes for ${state.projectId}: ` +
              `${result.nodesUpdated} nodes, ${result.edgesUpdated} edges`,
          );
        }
      })
      .catch((error) => {
        // Only log if watcher hasn't been stopped
        if (!state.isStopping) {
          console.error(`[WatchManager] Failed to sync missed changes for ${state.projectId}:`, error);
        }
      })
      .finally(() => {
        state.syncPromise = undefined;
      });
  }

  /**
   * Stop watching a project
   * Waits for any in-progress processing to complete before cleanup
   */
  async stopWatching(projectId: string): Promise<boolean> {
    const state = this.watchers.get(projectId);
    if (!state) {
      return false;
    }

    // Mark as stopping to prevent new event processing
    state.isStopping = true;
    state.status = 'paused';

    // Clear debounce timer
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }

    // Wait for any in-progress processing to complete (with timeout)
    const maxWaitMs = 30000; // 30 second timeout
    const startTime = Date.now();
    while (state.isProcessing && Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Wait for sync promise if it exists (with timeout)
    if (state.syncPromise) {
      try {
        await Promise.race([
          state.syncPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 5000)),
        ]);
      } catch {
        // Timeout or error - continue with cleanup
      }
    }

    // Unsubscribe from @parcel/watcher (only if subscription exists)
    if (state.subscription) {
      try {
        await state.subscription.unsubscribe();
      } catch (error) {
        console.warn(`[WatchManager] Error unsubscribing watcher for ${projectId}:`, error);
      }
    }

    this.watchers.delete(projectId);

    console.log(`[WatchManager] Stopped watching project: ${projectId}`);

    return true;
  }

  /**
   * Get watcher info for a project
   */
  getWatcherInfo(projectId: string): WatcherInfo | undefined {
    const state = this.watchers.get(projectId);
    if (!state) return undefined;
    return this.getWatcherInfoFromState(state);
  }

  /**
   * List all active watchers
   */
  listWatchers(): WatcherInfo[] {
    return Array.from(this.watchers.values()).map((state) => this.getWatcherInfoFromState(state));
  }

  /**
   * Stop all watchers (for shutdown)
   */
  async stopAllWatchers(): Promise<void> {
    const projectIds = Array.from(this.watchers.keys());
    await Promise.all(projectIds.map((id) => this.stopWatching(id)));
    console.log(`[WatchManager] Stopped all ${projectIds.length} watchers`);
  }

  /**
   * Convert internal state to public info
   */
  private getWatcherInfoFromState(state: WatcherState): WatcherInfo {
    return {
      projectId: state.projectId,
      projectPath: state.projectPath,
      status: state.status,
      lastUpdateTime: state.lastUpdateTime?.toISOString() ?? null,
      pendingChanges: state.pendingEvents.length,
      debounceMs: state.config.debounceMs,
      errorMessage: state.errorMessage,
    };
  }
}

// Singleton instance
export const watchManager = new WatchManager();
