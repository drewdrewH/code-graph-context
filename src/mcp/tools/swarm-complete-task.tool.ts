/**
 * Swarm Complete Task Tool
 * Mark a task as completed, failed, or needs_review with artifacts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { TOOL_NAMES, TOOL_METADATA } from '../constants.js';
import { createErrorResponse, createSuccessResponse, resolveProjectIdOrError, debugLog } from '../utils.js';

/**
 * Query to complete a task with artifacts
 */
const COMPLETE_TASK_QUERY = `
  MATCH (t:SwarmTask {id: $taskId, projectId: $projectId})
  WHERE t.status = 'in_progress' AND t.claimedBy = $agentId

  SET t.status = 'completed',
      t.completedAt = timestamp(),
      t.updatedAt = timestamp(),
      t.summary = $summary,
      t.artifacts = $artifacts,
      t.filesChanged = $filesChanged,
      t.linesAdded = $linesAdded,
      t.linesRemoved = $linesRemoved

  // Check for tasks that were blocked by this one
  WITH t
  OPTIONAL MATCH (waiting:SwarmTask)-[:DEPENDS_ON]->(t)
  WHERE waiting.status = 'blocked'

  // Check if waiting tasks now have all dependencies completed
  WITH t, collect(waiting) as waitingTasks
  UNWIND (CASE WHEN size(waitingTasks) = 0 THEN [null] ELSE waitingTasks END) as waiting
  OPTIONAL MATCH (waiting)-[:DEPENDS_ON]->(otherDep:SwarmTask)
  WHERE otherDep.status <> 'completed' AND otherDep.id <> t.id
  WITH t, waiting, count(otherDep) as remainingDeps
  WHERE waiting IS NOT NULL AND remainingDeps = 0

  // Unblock tasks that now have all dependencies met
  SET waiting.status = 'available',
      waiting.updatedAt = timestamp()

  WITH t, collect(waiting.id) as unblockedTaskIds

  RETURN t.id as id,
         t.title as title,
         t.status as status,
         t.completedAt as completedAt,
         t.summary as summary,
         t.claimedBy as claimedBy,
         unblockedTaskIds
`;

/**
 * Query to mark task as failed
 */
const FAIL_TASK_QUERY = `
  MATCH (t:SwarmTask {id: $taskId, projectId: $projectId})
  WHERE t.status IN ['in_progress', 'claimed'] AND t.claimedBy = $agentId

  SET t.status = 'failed',
      t.failedAt = timestamp(),
      t.updatedAt = timestamp(),
      t.failureReason = $reason,
      t.errorDetails = $errorDetails,
      t.retryable = $retryable

  RETURN t.id as id,
         t.title as title,
         t.status as status,
         t.failedAt as failedAt,
         t.failureReason as failureReason,
         t.retryable as retryable
`;

/**
 * Query to mark task as needs_review
 */
const REVIEW_TASK_QUERY = `
  MATCH (t:SwarmTask {id: $taskId, projectId: $projectId})
  WHERE t.status = 'in_progress' AND t.claimedBy = $agentId

  SET t.status = 'needs_review',
      t.reviewRequestedAt = timestamp(),
      t.updatedAt = timestamp(),
      t.summary = $summary,
      t.artifacts = $artifacts,
      t.filesChanged = $filesChanged,
      t.reviewNotes = $reviewNotes

  RETURN t.id as id,
         t.title as title,
         t.status as status,
         t.reviewRequestedAt as reviewRequestedAt,
         t.summary as summary,
         t.claimedBy as claimedBy
`;

/**
 * Query to approve a reviewed task (transition to completed)
 */
const APPROVE_TASK_QUERY = `
  MATCH (t:SwarmTask {id: $taskId, projectId: $projectId})
  WHERE t.status = 'needs_review'

  SET t.status = 'completed',
      t.completedAt = timestamp(),
      t.updatedAt = timestamp(),
      t.approvedBy = $reviewerId,
      t.approvalNotes = $notes

  // Check for tasks that were blocked by this one
  WITH t
  OPTIONAL MATCH (waiting:SwarmTask)-[:DEPENDS_ON]->(t)
  WHERE waiting.status = 'blocked'

  // Check if waiting tasks now have all dependencies completed
  WITH t, collect(waiting) as waitingTasks
  UNWIND (CASE WHEN size(waitingTasks) = 0 THEN [null] ELSE waitingTasks END) as waiting
  OPTIONAL MATCH (waiting)-[:DEPENDS_ON]->(otherDep:SwarmTask)
  WHERE otherDep.status <> 'completed' AND otherDep.id <> t.id
  WITH t, waiting, count(otherDep) as remainingDeps
  WHERE waiting IS NOT NULL AND remainingDeps = 0

  SET waiting.status = 'available',
      waiting.updatedAt = timestamp()

  WITH t, collect(waiting.id) as unblockedTaskIds

  RETURN t.id as id,
         t.title as title,
         t.status as status,
         t.completedAt as completedAt,
         t.approvedBy as approvedBy,
         unblockedTaskIds
`;

/**
 * Query to reject a reviewed task (back to in_progress or failed)
 */
const REJECT_TASK_QUERY = `
  MATCH (t:SwarmTask {id: $taskId, projectId: $projectId})
  WHERE t.status = 'needs_review'

  SET t.status = CASE WHEN $markAsFailed THEN 'failed' ELSE 'in_progress' END,
      t.updatedAt = timestamp(),
      t.rejectedBy = $reviewerId,
      t.rejectionNotes = $notes,
      t.rejectedAt = timestamp()

  RETURN t.id as id,
         t.title as title,
         t.status as status,
         t.claimedBy as claimedBy,
         t.rejectionNotes as rejectionNotes
`;

/**
 * Query to retry a failed task
 */
const RETRY_TASK_QUERY = `
  MATCH (t:SwarmTask {id: $taskId, projectId: $projectId})
  WHERE t.status = 'failed' AND t.retryable = true

  SET t.status = 'available',
      t.claimedBy = null,
      t.claimedAt = null,
      t.startedAt = null,
      t.failedAt = null,
      t.failureReason = null,
      t.errorDetails = null,
      t.updatedAt = timestamp(),
      t.retryCount = COALESCE(t.retryCount, 0) + 1

  RETURN t.id as id,
         t.title as title,
         t.status as status,
         t.retryCount as retryCount
`;

export const createSwarmCompleteTaskTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.swarmCompleteTask,
    {
      title: TOOL_METADATA[TOOL_NAMES.swarmCompleteTask].title,
      description: TOOL_METADATA[TOOL_NAMES.swarmCompleteTask].description,
      inputSchema: {
        projectId: z.string().describe('Project ID, name, or path'),
        taskId: z.string().describe('Task ID to complete'),
        agentId: z.string().describe('Your agent ID (must match the agent who claimed the task)'),
        action: z
          .enum(['complete', 'fail', 'request_review', 'approve', 'reject', 'retry'])
          .describe('Action to take on the task'),
        summary: z
          .string()
          .optional()
          .describe('Summary of what was done (required for complete/request_review)'),
        artifacts: z
          .record(z.unknown())
          .optional()
          .describe('Artifacts produced: { files: [], commits: [], pullRequests: [], notes: string }'),
        filesChanged: z
          .array(z.string())
          .optional()
          .describe('List of files that were modified'),
        linesAdded: z.number().int().optional().describe('Number of lines added'),
        linesRemoved: z.number().int().optional().describe('Number of lines removed'),
        reason: z
          .string()
          .optional()
          .describe('Reason for failure (required if action=fail)'),
        errorDetails: z
          .string()
          .optional()
          .describe('Technical error details for debugging'),
        retryable: z
          .boolean()
          .optional()
          .default(true)
          .describe('Whether the task can be retried after failure'),
        reviewNotes: z
          .string()
          .optional()
          .describe('Notes for the reviewer (for request_review)'),
        reviewerId: z
          .string()
          .optional()
          .describe('ID of the reviewer (required for approve/reject)'),
        notes: z
          .string()
          .optional()
          .describe('Approval/rejection notes'),
        markAsFailed: z
          .boolean()
          .optional()
          .default(false)
          .describe('If rejecting, mark as failed instead of returning to in_progress'),
      },
    },
    async ({
      projectId,
      taskId,
      agentId,
      action,
      summary,
      artifacts,
      filesChanged,
      linesAdded,
      linesRemoved,
      reason,
      errorDetails,
      retryable = true,
      reviewNotes,
      reviewerId,
      notes,
      markAsFailed = false,
    }) => {
      const neo4jService = new Neo4jService();

      // Resolve project ID
      const projectResult = await resolveProjectIdOrError(projectId, neo4jService);
      if (!projectResult.success) {
        await neo4jService.close();
        return projectResult.error;
      }
      const resolvedProjectId = projectResult.projectId;

      try {
        await debugLog('Swarm complete task', {
          action,
          taskId,
          projectId: resolvedProjectId,
          agentId,
        });

        let result;
        let responseData: any = { success: true, action };

        switch (action) {
          case 'complete':
            if (!summary) {
              return createErrorResponse('summary is required for complete action');
            }

            result = await neo4jService.run(COMPLETE_TASK_QUERY, {
              taskId,
              projectId: resolvedProjectId,
              agentId,
              summary,
              artifacts: artifacts ? JSON.stringify(artifacts) : null,
              filesChanged: filesChanged || [],
              linesAdded: linesAdded || 0,
              linesRemoved: linesRemoved || 0,
            });

            if (result.length === 0) {
              return createErrorResponse(
                `Cannot complete task ${taskId}. It may not exist, not be in_progress, or you don't own it.`,
              );
            }

            responseData.task = {
              id: result[0].id,
              title: result[0].title,
              status: result[0].status,
              completedAt: typeof result[0].completedAt === 'object'
                ? result[0].completedAt.toNumber()
                : result[0].completedAt,
              summary: result[0].summary,
              claimedBy: result[0].claimedBy,
            };
            responseData.unblockedTasks = result[0].unblockedTaskIds || [];
            responseData.message = responseData.unblockedTasks.length > 0
              ? `Task completed. ${responseData.unblockedTasks.length} dependent task(s) are now available.`
              : 'Task completed successfully.';
            break;

          case 'fail':
            if (!reason) {
              return createErrorResponse('reason is required for fail action');
            }

            result = await neo4jService.run(FAIL_TASK_QUERY, {
              taskId,
              projectId: resolvedProjectId,
              agentId,
              reason,
              errorDetails: errorDetails || null,
              retryable,
            });

            if (result.length === 0) {
              return createErrorResponse(
                `Cannot fail task ${taskId}. It may not exist, not be in_progress/claimed, or you don't own it.`,
              );
            }

            responseData.task = {
              id: result[0].id,
              title: result[0].title,
              status: result[0].status,
              failedAt: typeof result[0].failedAt === 'object'
                ? result[0].failedAt.toNumber()
                : result[0].failedAt,
              failureReason: result[0].failureReason,
              retryable: result[0].retryable,
            };
            responseData.message = retryable
              ? 'Task marked as failed. Use action="retry" to make it available again.'
              : 'Task marked as failed (not retryable).';
            break;

          case 'request_review':
            if (!summary) {
              return createErrorResponse('summary is required for request_review action');
            }

            result = await neo4jService.run(REVIEW_TASK_QUERY, {
              taskId,
              projectId: resolvedProjectId,
              agentId,
              summary,
              artifacts: artifacts ? JSON.stringify(artifacts) : null,
              filesChanged: filesChanged || [],
              reviewNotes: reviewNotes || null,
            });

            if (result.length === 0) {
              return createErrorResponse(
                `Cannot request review for task ${taskId}. It may not exist, not be in_progress, or you don't own it.`,
              );
            }

            responseData.task = {
              id: result[0].id,
              title: result[0].title,
              status: result[0].status,
              reviewRequestedAt: typeof result[0].reviewRequestedAt === 'object'
                ? result[0].reviewRequestedAt.toNumber()
                : result[0].reviewRequestedAt,
              summary: result[0].summary,
              claimedBy: result[0].claimedBy,
            };
            responseData.message = 'Task submitted for review.';
            break;

          case 'approve':
            if (!reviewerId) {
              return createErrorResponse('reviewerId is required for approve action');
            }

            result = await neo4jService.run(APPROVE_TASK_QUERY, {
              taskId,
              projectId: resolvedProjectId,
              reviewerId,
              notes: notes || null,
            });

            if (result.length === 0) {
              return createErrorResponse(
                `Cannot approve task ${taskId}. It may not exist or not be in needs_review status.`,
              );
            }

            responseData.task = {
              id: result[0].id,
              title: result[0].title,
              status: result[0].status,
              completedAt: typeof result[0].completedAt === 'object'
                ? result[0].completedAt.toNumber()
                : result[0].completedAt,
              approvedBy: result[0].approvedBy,
            };
            responseData.unblockedTasks = result[0].unblockedTaskIds || [];
            responseData.message = responseData.unblockedTasks.length > 0
              ? `Task approved. ${responseData.unblockedTasks.length} dependent task(s) are now available.`
              : 'Task approved and completed.';
            break;

          case 'reject':
            if (!reviewerId) {
              return createErrorResponse('reviewerId is required for reject action');
            }

            result = await neo4jService.run(REJECT_TASK_QUERY, {
              taskId,
              projectId: resolvedProjectId,
              reviewerId,
              notes: notes || 'No notes provided',
              markAsFailed,
            });

            if (result.length === 0) {
              return createErrorResponse(
                `Cannot reject task ${taskId}. It may not exist or not be in needs_review status.`,
              );
            }

            responseData.task = {
              id: result[0].id,
              title: result[0].title,
              status: result[0].status,
              claimedBy: result[0].claimedBy,
              rejectionNotes: result[0].rejectionNotes,
            };
            responseData.message = markAsFailed
              ? 'Task rejected and marked as failed.'
              : 'Task rejected and returned to in_progress for the original agent to fix.';
            break;

          case 'retry':
            result = await neo4jService.run(RETRY_TASK_QUERY, {
              taskId,
              projectId: resolvedProjectId,
            });

            if (result.length === 0) {
              return createErrorResponse(
                `Cannot retry task ${taskId}. It may not exist, not be failed, or not be retryable.`,
              );
            }

            responseData.task = {
              id: result[0].id,
              title: result[0].title,
              status: result[0].status,
              retryCount: typeof result[0].retryCount === 'object'
                ? result[0].retryCount.toNumber()
                : result[0].retryCount,
            };
            responseData.message = `Task is now available for retry (attempt #${responseData.task.retryCount + 1}).`;
            break;

          default:
            return createErrorResponse(`Unknown action: ${action}`);
        }

        return createSuccessResponse(JSON.stringify(responseData));
      } catch (error) {
        await debugLog('Swarm complete task error', { error: String(error) });
        return createErrorResponse(error instanceof Error ? error : String(error));
      } finally {
        await neo4jService.close();
      }
    },
  );
};
