/**
 * Swarm Orchestrate Tool
 * Orchestrates multiple agents to tackle complex, multi-file code tasks in parallel
 *
 * This is the main entry point for swarm-based task execution. It:
 * 1. Analyzes the task using semantic search and impact analysis
 * 2. Decomposes the task into atomic, dependency-ordered SwarmTasks
 * 3. Creates tasks on the blackboard for worker agents
 * 4. Returns execution plan for agents to claim and execute
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { EmbeddingsService } from '../../core/embeddings/embeddings.service.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';
import { TOOL_NAMES, TOOL_METADATA } from '../constants.js';
import {
  TaskDecompositionHandler,
  CodeNode,
  ImpactResult,
  DecompositionResult,
} from '../handlers/task-decomposition.handler.js';
import { swarmWorkerHandler } from '../handlers/swarm-worker.handler.js';
import { createErrorResponse, createSuccessResponse, resolveProjectIdOrError, debugLog } from '../utils.js';

import {
  TASK_PRIORITIES,
  TaskPriority,
  generateSwarmId,
  generateTaskId,
  ORCHESTRATOR_CONFIG,
  getHalfLife,
} from './swarm-constants.js';

/**
 * Query to search for nodes matching the task description
 */
const SEMANTIC_SEARCH_QUERY = `
  CALL db.index.vector.queryNodes('embedded_nodes_idx', toInteger($limit), $embedding)
  YIELD node, score
  WHERE node.projectId = $projectId
    AND score >= $minSimilarity
  RETURN node.id AS id,
         node.name AS name,
         node.coreType AS coreType,
         node.semanticType AS semanticType,
         node.filePath AS filePath,
         substring(node.sourceCode, 0, 500) AS sourceCode,
         node.startLine AS startLine,
         node.endLine AS endLine,
         score
  ORDER BY score DESC
  LIMIT toInteger($limit)
`;

/**
 * Query to get impact analysis for a node
 */
const IMPACT_QUERY = `
  MATCH (target)
  WHERE target.id = $nodeId AND target.projectId = $projectId
  OPTIONAL MATCH (dependent)-[r]->(target)
  WHERE dependent.projectId = $projectId
    AND NOT dependent:Pheromone
    AND NOT dependent:SwarmTask
  WITH target, collect(DISTINCT {
    nodeId: dependent.id,
    filePath: dependent.filePath,
    relType: type(r)
  }) AS dependents
  RETURN target.id AS nodeId,
         size(dependents) AS dependentCount,
         [d IN dependents | d.filePath] AS affectedFiles,
         CASE
           WHEN size(dependents) >= 20 THEN 'CRITICAL'
           WHEN size(dependents) >= 10 THEN 'HIGH'
           WHEN size(dependents) >= 5 THEN 'MEDIUM'
           ELSE 'LOW'
         END AS riskLevel
`;

/**
 * Query to create a pheromone marker on a node
 */
const CREATE_PHEROMONE_QUERY = `
  MATCH (target)
  WHERE target.id = $nodeId AND target.projectId = $projectId
  MERGE (p:Pheromone {
    nodeId: $nodeId,
    agentId: $agentId,
    type: $type,
    projectId: $projectId
  })
  ON CREATE SET
    p.id = randomUUID(),
    p.swarmId = $swarmId,
    p.intensity = $intensity,
    p.timestamp = timestamp(),
    p.halfLife = $halfLife,
    p.data = $data
  ON MATCH SET
    p.intensity = $intensity,
    p.timestamp = timestamp(),
    p.data = $data
  MERGE (p)-[:MARKS]->(target)
  RETURN p.nodeId AS nodeId
`;

/**
 * Query to create a SwarmTask node
 */
const CREATE_TASK_QUERY = `
  CREATE (t:SwarmTask {
    id: $taskId,
    projectId: $projectId,
    swarmId: $swarmId,
    title: $title,
    description: $description,
    type: $type,
    priority: $priority,
    priorityScore: $priorityScore,
    status: $status,
    targetNodeIds: $targetNodeIds,
    targetFilePaths: $targetFilePaths,
    dependencies: $dependencies,
    createdBy: $createdBy,
    createdAt: timestamp(),
    updatedAt: timestamp(),
    metadata: $metadata
  })

  // Link to target code nodes if they exist
  WITH t
  OPTIONAL MATCH (target)
  WHERE target.id IN $targetNodeIds
    AND target.projectId = $projectId
    AND NOT target:SwarmTask
    AND NOT target:Pheromone
  WITH t, collect(DISTINCT target) as targets
  FOREACH (target IN targets | MERGE (t)-[:TARGETS]->(target))

  // Link to dependency tasks if they exist
  WITH t
  OPTIONAL MATCH (dep:SwarmTask)
  WHERE dep.id IN $dependencies
    AND dep.projectId = $projectId
  WITH t, collect(DISTINCT dep) as deps
  FOREACH (dep IN deps | MERGE (t)-[:DEPENDS_ON]->(dep))

  RETURN t.id AS id
`;

/**
 * Orchestration result structure
 */
interface OrchestrationResult {
  swarmId: string;
  status: 'planning' | 'ready' | 'failed';
  plan: {
    totalTasks: number;
    parallelizable: number;
    sequential: number;
    estimatedComplexity: string;
    tasks: Array<{
      id: string;
      title: string;
      type: string;
      priority: string;
      status: string;
      dependencyCount: number;
      targetFiles: string[];
    }>;
    dependencyGraph: Array<{ from: string; to: string }>;
  };
  workerInstructions: string;
  message: string;
}

export const createSwarmOrchestrateTool = (server: McpServer): void => {
  const embeddingsService = new EmbeddingsService();
  const taskDecomposer = new TaskDecompositionHandler();

  server.registerTool(
    TOOL_NAMES.swarmOrchestrate,
    {
      title: TOOL_METADATA[TOOL_NAMES.swarmOrchestrate].title,
      description: TOOL_METADATA[TOOL_NAMES.swarmOrchestrate].description,
      inputSchema: {
        projectId: z.string().describe('Project ID, name, or path'),
        task: z.string().min(10).describe('Natural language description of the task to execute'),
        maxAgents: z
          .number()
          .int()
          .min(1)
          .max(ORCHESTRATOR_CONFIG.maxAgentsLimit)
          .optional()
          .default(ORCHESTRATOR_CONFIG.defaultMaxAgents)
          .describe(`Maximum concurrent worker agents (default: ${ORCHESTRATOR_CONFIG.defaultMaxAgents})`),
        dryRun: z
          .boolean()
          .optional()
          .default(false)
          .describe('If true, only plan without creating tasks (default: false)'),
        priority: z
          .enum(Object.keys(TASK_PRIORITIES) as [string, ...string[]])
          .optional()
          .default('normal')
          .describe('Overall priority level for tasks'),
        minSimilarity: z
          .number()
          .min(0.5)
          .max(1.0)
          .optional()
          .default(0.65)
          .describe('Minimum similarity score for semantic search (default: 0.65)'),
        maxNodes: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(50)
          .describe('Maximum nodes to consider from search (default: 50)'),
      },
    },
    async ({
      projectId,
      task,
      maxAgents = ORCHESTRATOR_CONFIG.defaultMaxAgents,
      dryRun = false,
      priority = 'normal',
      minSimilarity = 0.65,
      maxNodes = 50,
    }) => {
      const neo4jService = new Neo4jService();
      const swarmId = generateSwarmId();

      try {
        // Step 1: Resolve project ID
        const projectResult = await resolveProjectIdOrError(projectId, neo4jService);
        if (!projectResult.success) {
          await neo4jService.close();
          return projectResult.error;
        }
        const resolvedProjectId = projectResult.projectId;

        await debugLog('Swarm orchestration started', {
          swarmId,
          projectId: resolvedProjectId,
          task,
          maxAgents,
          dryRun,
        });

        // Step 2: Semantic search to find affected nodes
        await debugLog('Searching for affected nodes', { task });

        let embedding: number[];
        try {
          embedding = await embeddingsService.embedText(task);
        } catch (error) {
          return createErrorResponse(`Failed to generate embedding for task description: ${error}`);
        }

        const searchResults = await neo4jService.run(SEMANTIC_SEARCH_QUERY, {
          projectId: resolvedProjectId,
          embedding,
          minSimilarity,
          limit: Math.floor(maxNodes),
        });

        if (searchResults.length === 0) {
          return createErrorResponse(
            `No code found matching task: "${task}". Try rephrasing or use search_codebase to explore the codebase first.`,
          );
        }

        const affectedNodes: CodeNode[] = searchResults.map((r) => ({
          id: r.id as string,
          name: r.name as string,
          coreType: r.coreType as string,
          semanticType: r.semanticType as string | undefined,
          filePath: r.filePath as string,
          sourceCode: r.sourceCode as string | undefined,
          startLine: typeof r.startLine === 'object' ? (r.startLine as any).toNumber() : r.startLine as number,
          endLine: typeof r.endLine === 'object' ? (r.endLine as any).toNumber() : r.endLine as number,
        }));

        await debugLog('Found affected nodes', {
          count: affectedNodes.length,
          files: [...new Set(affectedNodes.map((n) => n.filePath))].length,
        });

        // Step 3: Run impact analysis on each node
        await debugLog('Running impact analysis', { nodeCount: affectedNodes.length });

        const impactMap = new Map<string, ImpactResult>();

        for (const node of affectedNodes) {
          const impactResult = await neo4jService.run(IMPACT_QUERY, {
            nodeId: node.id,
            projectId: resolvedProjectId,
          });

          if (impactResult.length > 0) {
            const impact = impactResult[0];
            impactMap.set(node.id, {
              nodeId: node.id,
              riskLevel: impact.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
              directDependents: {
                count: typeof impact.dependentCount === 'object'
                  ? (impact.dependentCount as any).toNumber()
                  : impact.dependentCount as number,
                byType: {},
              },
              transitiveDependents: { count: 0 },
              affectedFiles: (impact.affectedFiles as string[]) ?? [],
            });
          }
        }

        // Step 4: Decompose task into atomic tasks
        await debugLog('Decomposing task', { nodeCount: affectedNodes.length });

        const decomposition: DecompositionResult = await taskDecomposer.decomposeTask(
          task,
          affectedNodes,
          impactMap,
          priority as TaskPriority,
        );

        if (decomposition.tasks.length === 0) {
          return createErrorResponse('Task decomposition produced no actionable tasks');
        }

        await debugLog('Task decomposition complete', {
          totalTasks: decomposition.tasks.length,
          parallelizable: decomposition.summary.parallelizable,
        });

        // Step 5: Create SwarmTasks on the blackboard (unless dry run)
        if (!dryRun) {
          await debugLog('Creating SwarmTasks', { count: decomposition.tasks.length });

          for (const atomicTask of decomposition.tasks) {
            // Determine initial status based on dependencies
            const hasUnmetDeps = atomicTask.dependencies.length > 0;
            const initialStatus = hasUnmetDeps ? 'blocked' : 'available';

            await neo4jService.run(CREATE_TASK_QUERY, {
              taskId: atomicTask.id,
              projectId: resolvedProjectId,
              swarmId,
              title: atomicTask.title,
              description: atomicTask.description,
              type: atomicTask.type,
              priority: atomicTask.priority,
              priorityScore: atomicTask.priorityScore,
              status: initialStatus,
              targetNodeIds: atomicTask.nodeIds,
              targetFilePaths: [atomicTask.filePath],
              dependencies: atomicTask.dependencies,
              createdBy: 'orchestrator',
              metadata: JSON.stringify(atomicTask.metadata ?? {}),
            });
          }

          await debugLog('SwarmTasks created', { swarmId, count: decomposition.tasks.length });

          // Step 5b: Leave "proposal" pheromones on all target nodes
          // This signals to other agents that work is planned for these nodes
          const uniqueNodeIds = new Set<string>();
          for (const atomicTask of decomposition.tasks) {
            for (const nodeId of atomicTask.nodeIds) {
              uniqueNodeIds.add(nodeId);
            }
          }

          await debugLog('Creating proposal pheromones', { nodeCount: uniqueNodeIds.size });

          for (const nodeId of uniqueNodeIds) {
            await neo4jService.run(CREATE_PHEROMONE_QUERY, {
              nodeId,
              projectId: resolvedProjectId,
              agentId: 'orchestrator',
              swarmId,
              type: 'proposal',
              intensity: 1.0,
              halfLife: getHalfLife('proposal'),
              data: JSON.stringify({ task, swarmId }),
            });
          }

          await debugLog('Proposal pheromones created', { swarmId, count: uniqueNodeIds.size });
        }

        // Step 6: Generate worker instructions
        const workerInstructions = generateWorkerInstructions(
          swarmId,
          resolvedProjectId,
          maxAgents,
          decomposition.tasks.length,
        );

        // Step 7: Build result
        const result: OrchestrationResult = {
          swarmId,
          status: dryRun ? 'planning' : 'ready',
          plan: {
            totalTasks: decomposition.tasks.length,
            parallelizable: decomposition.summary.parallelizable,
            sequential: decomposition.summary.sequential,
            estimatedComplexity: decomposition.summary.estimatedComplexity,
            tasks: decomposition.tasks.map((t) => ({
              id: t.id,
              title: t.title,
              type: t.type,
              priority: t.priority,
              status: t.dependencies.length > 0 ? 'blocked' : 'available',
              dependencyCount: t.dependencies.length,
              targetFiles: [t.filePath],
            })),
            dependencyGraph: buildDependencyGraph(decomposition),
          },
          workerInstructions,
          message: dryRun
            ? `Dry run complete. ${decomposition.tasks.length} tasks planned but not created.`
            : `Swarm ready! ${decomposition.tasks.length} tasks created. ${decomposition.summary.parallelizable} can run in parallel.`,
        };

        await debugLog('Swarm orchestration complete', {
          swarmId,
          status: result.status,
          totalTasks: result.plan.totalTasks,
        });

        return createSuccessResponse(JSON.stringify(result, null, 2));
      } catch (error) {
        await debugLog('Swarm orchestration error', { swarmId, error: String(error) });
        return createErrorResponse(error instanceof Error ? error : String(error));
      } finally {
        await neo4jService.close();
      }
    },
  );
};

/**
 * Generate instructions for spawning worker agents
 */
function generateWorkerInstructions(
  swarmId: string,
  projectId: string,
  maxAgents: number,
  taskCount: number,
): string {
  const recommendedAgents = Math.min(maxAgents, Math.ceil(taskCount / 2), taskCount);

  // Generate unique agent IDs for each worker
  const agentIds = Array.from({ length: recommendedAgents }, (_, i) => `${swarmId}_worker_${i + 1}`);

  const workerPrompt = `You are a swarm worker agent.
- Agent ID: {AGENT_ID}
- Swarm ID: ${swarmId}
- Project: ${projectId}

## CRITICAL RULES
1. NEVER fabricate node IDs - get them from graph tool responses
2. ALWAYS use the blackboard task queue (swarm_claim_task, swarm_complete_task)
3. Exit when swarm_claim_task returns "no_tasks"

## WORKFLOW - Follow these steps exactly:

### Step 1: Claim a task from the blackboard
swarm_claim_task({
  projectId: "${projectId}",
  swarmId: "${swarmId}",
  agentId: "{AGENT_ID}"
})
// If returns "no_tasks" → exit, swarm is complete
// Otherwise you now own the returned task

### Step 2: Start working on the task
swarm_claim_task({
  projectId: "${projectId}",
  swarmId: "${swarmId}",
  agentId: "{AGENT_ID}",
  taskId: "<TASK_ID_FROM_STEP_1>",
  action: "start"
})

### Step 3: Do the work
- Read the task description carefully
- Use Read tool to examine target files
- Use Edit tool to make changes
- The task's targetFilePaths tells you which files to modify

### Step 4: Complete the task via blackboard
swarm_complete_task({
  projectId: "${projectId}",
  taskId: "<TASK_ID>",
  agentId: "{AGENT_ID}",
  action: "complete",
  summary: "<DESCRIBE_WHAT_YOU_DID>",
  filesChanged: ["<LIST_OF_FILES_YOU_MODIFIED>"]
})

### Step 5: Loop back to Step 1
Claim the next available task. Continue until no tasks remain.

## IF YOU GET STUCK
swarm_complete_task({
  projectId: "${projectId}",
  taskId: "<TASK_ID>",
  agentId: "{AGENT_ID}",
  action: "fail",
  reason: "<WHY_YOU_ARE_STUCK>",
  retryable: true
})
Then claim another task.`;

  const taskCalls = agentIds.map(agentId => {
    const prompt = workerPrompt.replace(/\{AGENT_ID\}/g, agentId);
    return `Task({
  subagent_type: "general-purpose",
  run_in_background: false,
  prompt: \`${prompt}\`
})`;
  }).join('\n\n');

  return `
## Worker Agent Instructions

Spawn ${recommendedAgents} worker agent(s) IN PARALLEL (all Task calls in ONE message):

\`\`\`javascript
${taskCalls}
\`\`\`

**CRITICAL:** Include ALL ${recommendedAgents} Task calls in a single message to run them in parallel.

## Monitoring Progress

Check swarm progress:
\`\`\`javascript
swarm_get_tasks({
  projectId: "${projectId}",
  swarmId: "${swarmId}",
  includeStats: true
})
\`\`\`

## Cleanup (after all workers complete)

\`\`\`javascript
swarm_cleanup({
  projectId: "${projectId}",
  swarmId: "${swarmId}"
})
\`\`\`
`;
}

/**
 * Build dependency graph edges for visualization
 */
function buildDependencyGraph(
  decomposition: DecompositionResult,
): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];

  for (const task of decomposition.tasks) {
    for (const depId of task.dependencies) {
      edges.push({ from: depId, to: task.id });
    }
  }

  return edges;
}
