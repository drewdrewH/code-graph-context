/**
 * Job Manager Service
 * Tracks background parsing jobs for async mode
 */

import { randomBytes } from 'crypto';
import { JOBS } from '../constants.js';

export type JobPhase = 'pending' | 'discovery' | 'parsing' | 'importing' | 'resolving' | 'complete';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface JobProgress {
  phase: JobPhase;
  filesTotal: number;
  filesProcessed: number;
  nodesImported: number;
  edgesImported: number;
  currentChunk: number;
  totalChunks: number;
}

export interface JobResult {
  nodesImported: number;
  edgesImported: number;
  elapsedMs: number;
}

export interface ParseJob {
  id: string;
  status: JobStatus;
  projectId: string;
  projectPath: string;
  progress: JobProgress;
  result?: JobResult;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const generateJobId = (): string => {
  return `job_${randomBytes(8).toString('hex')}`;
};

const createInitialProgress = (): JobProgress => ({
  phase: 'pending',
  filesTotal: 0,
  filesProcessed: 0,
  nodesImported: 0,
  edgesImported: 0,
  currentChunk: 0,
  totalChunks: 0,
});


class JobManager {
  private jobs: Map<string, ParseJob> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start automatic cleanup scheduler
    this.startCleanupScheduler();
  }

  /**
   * Start the automatic cleanup scheduler.
   * Runs every 5 minutes to remove old completed/failed jobs.
   */
  private startCleanupScheduler(): void {
    if (this.cleanupInterval) return; // Already running

    this.cleanupInterval = setInterval(() => {
      const cleaned = this.cleanupOldJobs();
      if (cleaned > 0) {
        console.error(`[JobManager] Cleaned up ${cleaned} old jobs`);
      }
    }, JOBS.cleanupIntervalMs);

    // Don't prevent Node.js from exiting if this is the only timer
    this.cleanupInterval.unref();
  }

  /**
   * Stop the cleanup scheduler (useful for testing or shutdown)
   */
  stopCleanupScheduler(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Create a new parsing job
   * @throws Error if maximum job limit is reached
   */
  createJob(projectPath: string, projectId: string): string {
    // SECURITY: Enforce maximum job limit to prevent memory exhaustion
    if (this.jobs.size >= JOBS.maxJobs) {
      // Try to cleanup old jobs first
      const cleaned = this.cleanupOldJobs(0); // Remove all completed/failed jobs
      if (this.jobs.size >= JOBS.maxJobs) {
        throw new Error(
          `Maximum job limit (${JOBS.maxJobs}) reached. ` +
            `${this.listJobs('running').length} jobs are currently running. ` +
            `Please wait for jobs to complete or cancel existing jobs.`,
        );
      }
      if (cleaned > 0) {
        console.error(`[JobManager] Auto-cleaned ${cleaned} old jobs to make room for new job`);
      }
    }

    const id = generateJobId();
    const now = new Date();

    const job: ParseJob = {
      id,
      status: 'pending',
      projectId,
      projectPath,
      progress: createInitialProgress(),
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(id, job);
    return id;
  }

  /**
   * Start a job (transition from pending to running)
   */
  startJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'running';
      job.updatedAt = new Date();
    }
  }

  /**
   * Update job progress
   */
  updateProgress(jobId: string, progress: Partial<JobProgress>): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.progress = { ...job.progress, ...progress };
      job.updatedAt = new Date();
    }
  }

  /**
   * Mark job as completed with results
   */
  completeJob(jobId: string, result: JobResult): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'completed';
      job.result = result;
      job.progress.phase = 'complete';
      job.updatedAt = new Date();
    }
  }

  /**
   * Mark job as failed with error message
   */
  failJob(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.error = error;
      job.updatedAt = new Date();
    }
  }

  /**
   * Get a job by ID
   */
  getJob(jobId: string): ParseJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * List all jobs (optionally filter by status)
   */
  listJobs(status?: JobStatus): ParseJob[] {
    const jobs = Array.from(this.jobs.values());
    if (status) {
      return jobs.filter((job) => job.status === status);
    }
    return jobs;
  }

  /**
   * Clean up old completed/failed jobs
   * @param maxAgeMs Maximum age in milliseconds (default: 1 hour)
   */
  cleanupOldJobs(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, job] of this.jobs.entries()) {
      if (job.status === 'completed' || job.status === 'failed') {
        const age = now - job.updatedAt.getTime();
        if (age > maxAgeMs) {
          this.jobs.delete(id);
          cleaned++;
        }
      }
    }

    return cleaned;
  }
}

// Singleton instance
export const jobManager = new JobManager();
