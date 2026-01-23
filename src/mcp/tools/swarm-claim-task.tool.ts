/**
 * Swarm Claim Task Tool
 * Allow an agent to claim an available task from the blackboard
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { TOOL_NAMES, TOOL_METADATA } from '../constants.js';
import { createErrorResponse, createSuccessResponse, resolveProjectIdOrError, debugLog } from '../utils.js';

import { TASK_TYPES, TASK_PRIORITIES, TaskPriority } from './swarm-constants.js';

/**
 * Query to claim a specific task by ID
 * Uses atomic update to prevent race conditions
 */
const CLAIM_TASK_BY_ID_QUERY = `
  MATCH (t:SwarmTask {id: $taskId, projectId: $projectId})
  WHERE t.status IN ['available', 'blocked']

  // Check if dependencies are complete
  OPTIONAL MATCH (t)-[:DEPENDS_ON]->(dep:SwarmTask)
  WHERE dep.status <> 'completed'
  WITH t, count(dep) as incompleteDeps

  // Only claim if all dependencies are complete
  WHERE incompleteDeps = 0

  // Acquire exclusive lock to prevent race conditions
  CALL apoc.lock.nodes([t])

  // Double-check status after acquiring lock
  WITH t WHERE t.status IN ['available', 'blocked']

  // Atomic claim
  SET t.status = 'claimed',
      t.claimedBy = $agentId,
      t.claimedAt = timestamp(),
      t.updatedAt = timestamp()

  // Return task details with target info
  WITH t
  OPTIONAL MATCH (t)-[:TARGETS]->(target)
  RETURN t.id as id,
         t.projectId as projectId,
         t.swarmId as swarmId,
         t.title as title,
         t.description as description,
         t.type as type,
         t.priority as priority,
         t.priorityScore as priorityScore,
         t.status as status,
         t.targetNodeIds as targetNodeIds,
         t.targetFilePaths as targetFilePaths,
         t.dependencies as dependencies,
         t.claimedBy as claimedBy,
         t.claimedAt as claimedAt,
         t.createdBy as createdBy,
         t.metadata as metadata,
         collect(DISTINCT {
           id: target.id,
           type: labels(target)[0],
           name: target.name,
           filePath: target.filePath
         }) as targets
`;

/**
 * Query to claim the highest priority available task matching criteria
 * Uses APOC locking to prevent race conditions between parallel workers
 */
const CLAIM_NEXT_TASK_QUERY = `
  // Find available or blocked tasks (blocked tasks may have deps completed now)
  MATCH (t:SwarmTask {projectId: $projectId, swarmId: $swarmId})
  WHERE t.status IN ['available', 'blocked']
    AND ($types IS NULL OR size($types) = 0 OR t.type IN $types)
    AND ($minPriority IS NULL OR t.priorityScore >= $minPriority)

  // Exclude tasks with incomplete dependencies
  OPTIONAL MATCH (t)-[:DEPENDS_ON]->(dep:SwarmTask)
  WHERE dep.status <> 'completed'
  WITH t, count(dep) as incompleteDeps
  WHERE incompleteDeps = 0

  // Order by priority (highest first), then by creation time (oldest first)
  ORDER BY t.priorityScore DESC, t.createdAt ASC
  LIMIT 1

  // Acquire exclusive lock to prevent race conditions
  CALL apoc.lock.nodes([t])

  // Double-check status after acquiring lock (another worker may have claimed it)
  WITH t WHERE t.status IN ['available', 'blocked']

  // Atomic claim
  SET t.status = 'claimed',
      t.claimedBy = $agentId,
      t.claimedAt = timestamp(),
      t.updatedAt = timestamp()

  // Return task details with target info
  WITH t
  OPTIONAL MATCH (t)-[:TARGETS]->(target)
  RETURN t.id as id,
         t.projectId as projectId,
         t.swarmId as swarmId,
         t.title as title,
         t.description as description,
         t.type as type,
         t.priority as priority,
         t.priorityScore as priorityScore,
         t.status as status,
         t.targetNodeIds as targetNodeIds,
         t.targetFilePaths as targetFilePaths,
         t.dependencies as dependencies,
         t.claimedBy as claimedBy,
         t.claimedAt as claimedAt,
         t.createdBy as createdBy,
         t.metadata as metadata,
         collect(DISTINCT {
           id: target.id,
           type: labels(target)[0],
           name: target.name,
           filePath: target.filePath
         }) as targets
`;

/**
 * Query to start working on a claimed task (transition to in_progress)
 */
const START_TASK_QUERY = `
  MATCH (t:SwarmTask {id: $taskId, projectId: $projectId})
  WHERE t.status = 'claimed' AND t.claimedBy = $agentId

  SET t.status = 'in_progress',
      t.startedAt = timestamp(),
      t.updatedAt = timestamp()

  RETURN t.id as id,
         t.status as status,
         t.claimedBy as claimedBy,
         t.startedAt as startedAt
`;

/**
 * Query to release a claimed task (unclaim it)
 */
const RELEASE_TASK_QUERY = `
  MATCH (t:SwarmTask {id: $taskId, projectId: $projectId})
  WHERE t.status IN ['claimed', 'in_progress'] AND t.claimedBy = $agentId

  SET t.status = 'available',
      t.claimedBy = null,
      t.claimedAt = null,
      t.startedAt = null,
      t.updatedAt = timestamp(),
      t.releaseReason = $reason

  RETURN t.id as id,
         t.title as title,
         t.status as status
`;

export const createSwarmClaimTaskTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.swarmClaimTask,
    {
      title: TOOL_METADATA[TOOL_NAMES.swarmClaimTask].title,
      description: TOOL_METADATA[TOOL_NAMES.swarmClaimTask].description,
      inputSchema: {
        projectId: z.string().describe('Project ID, name, or path'),
        swarmId: z.string().describe('Swarm ID to find tasks in'),
        agentId: z.string().describe('Your unique agent identifier'),
        taskId: z
          .string()
          .optional()
          .describe('Specific task ID to claim (if omitted, claims highest priority available task)'),
        types: z
          .array(z.enum(TASK_TYPES))
          .optional()
          .describe('Filter by task types when auto-selecting (e.g., ["implement", "fix"])'),
        minPriority: z
          .enum(Object.keys(TASK_PRIORITIES) as [string, ...string[]])
          .optional()
          .describe('Minimum priority level when auto-selecting'),
        action: z
          .enum(['claim', 'start', 'release'])
          .optional()
          .default('claim')
          .describe('Action: claim (reserve task), start (begin work), release (give up task)'),
        releaseReason: z
          .string()
          .optional()
          .describe('Reason for releasing the task (required if action=release)'),
      },
    },
    async ({
      projectId,
      swarmId,
      agentId,
      taskId,
      types,
      minPriority,
      action = 'claim',
      releaseReason,
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
        await debugLog('Swarm claim task', {
          action,
          projectId: resolvedProjectId,
          swarmId,
          agentId,
          taskId,
          types,
          minPriority,
        });

        // Handle release action
        if (action === 'release') {
          if (!taskId) {
            return createErrorResponse('taskId is required for release action');
          }

          const result = await neo4jService.run(RELEASE_TASK_QUERY, {
            taskId,
            projectId: resolvedProjectId,
            agentId,
            reason: releaseReason || 'No reason provided',
          });

          if (result.length === 0) {
            return createErrorResponse(
              `Cannot release task ${taskId}. Either it doesn't exist, isn't claimed/in_progress, or you don't own it.`,
            );
          }

          return createSuccessResponse(
            JSON.stringify({
              success: true,
              action: 'released',
              task: {
                id: result[0].id,
                title: result[0].title,
                status: result[0].status,
              },
              message: `Task released and now available for other agents`,
            }),
          );
        }

        // Handle start action
        if (action === 'start') {
          if (!taskId) {
            return createErrorResponse('taskId is required for start action');
          }

          const result = await neo4jService.run(START_TASK_QUERY, {
            taskId,
            projectId: resolvedProjectId,
            agentId,
          });

          if (result.length === 0) {
            return createErrorResponse(
              `Cannot start task ${taskId}. Either it doesn't exist, isn't claimed, or you don't own it.`,
            );
          }

          return createSuccessResponse(
            JSON.stringify({
              success: true,
              action: 'started',
              task: {
                id: result[0].id,
                status: result[0].status,
                claimedBy: result[0].claimedBy,
                startedAt: typeof result[0].startedAt === 'object'
                  ? result[0].startedAt.toNumber()
                  : result[0].startedAt,
              },
              message: 'Task is now in progress',
            }),
          );
        }

        // Handle claim action
        let result;
        if (taskId) {
          // Claim specific task
          result = await neo4jService.run(CLAIM_TASK_BY_ID_QUERY, {
            taskId,
            projectId: resolvedProjectId,
            agentId,
          });

          if (result.length === 0) {
            return createErrorResponse(
              `Cannot claim task ${taskId}. It may not exist, already be claimed, or have incomplete dependencies.`,
            );
          }
        } else {
          // Auto-select highest priority available task
          const minPriorityScore = minPriority
            ? TASK_PRIORITIES[minPriority as TaskPriority]
            : null;

          result = await neo4jService.run(CLAIM_NEXT_TASK_QUERY, {
            projectId: resolvedProjectId,
            swarmId,
            agentId,
            types: types || null,
            minPriority: minPriorityScore,
          });

          if (result.length === 0) {
            return createSuccessResponse(
              JSON.stringify({
                success: true,
                action: 'no_tasks',
                message: 'No available tasks matching criteria. All tasks may be claimed, blocked, or completed.',
                filters: {
                  swarmId,
                  types: types || 'any',
                  minPriority: minPriority || 'any',
                },
              }),
            );
          }
        }

        const task = result[0];

        // Parse metadata if present
        let metadata = null;
        if (task.metadata) {
          try {
            metadata = JSON.parse(task.metadata);
          } catch {
            metadata = task.metadata;
          }
        }

        // Filter out null targets
        const targets = (task.targets || []).filter((t: any) => t.id !== null);

        return createSuccessResponse(
          JSON.stringify({
            success: true,
            action: 'claimed',
            task: {
              id: task.id,
              projectId: task.projectId,
              swarmId: task.swarmId,
              title: task.title,
              description: task.description,
              type: task.type,
              priority: task.priority,
              priorityScore: task.priorityScore,
              status: task.status,
              targetNodeIds: task.targetNodeIds,
              targetFilePaths: task.targetFilePaths,
              dependencies: task.dependencies,
              claimedBy: task.claimedBy,
              claimedAt: typeof task.claimedAt === 'object'
                ? task.claimedAt.toNumber()
                : task.claimedAt,
              createdBy: task.createdBy,
              metadata,
              targets,
            },
            message: 'Task claimed successfully. Use action="start" when you begin working.',
          }),
        );
      } catch (error) {
        await debugLog('Swarm claim task error', { error: String(error) });
        return createErrorResponse(error instanceof Error ? error : String(error));
      } finally {
        await neo4jService.close();
      }
    },
  );
};
