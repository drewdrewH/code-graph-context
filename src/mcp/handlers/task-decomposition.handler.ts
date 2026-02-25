/**
 * Task Decomposition Handler
 * Transforms high-level natural language tasks into atomic, dependency-ordered SwarmTasks
 */

import path from 'path';

import {
  TaskType,
  TaskPriority,
  TASK_PRIORITIES,
  TASK_INFERENCE_PATTERNS,
  AtomicTask,
  generateTaskId,
} from '../tools/swarm-constants.js';
import { debugLog } from '../utils.js';

/**
 * Node information from search results
 */
export interface CodeNode {
  id: string;
  name: string;
  coreType: string;
  semanticType?: string;
  filePath: string;
  sourceCode?: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Impact analysis result for a node
 */
export interface ImpactResult {
  nodeId: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  directDependents: { count: number; byType: Record<string, number> };
  transitiveDependents: { count: number };
  affectedFiles: string[];
}

/**
 * Decomposed task with all metadata
 */
export interface DecomposedTask extends AtomicTask {
  id: string;
  priority: TaskPriority;
  priorityScore: number;
  impactLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  affectedNodes: CodeNode[];
}

/**
 * Decomposition result with ordering information
 */
export interface DecompositionResult {
  tasks: DecomposedTask[];
  dependencyGraph: Map<string, string[]>;
  executionOrder: string[];
  summary: {
    totalTasks: number;
    parallelizable: number;
    sequential: number;
    estimatedComplexity: 'LOW' | 'MEDIUM' | 'HIGH';
  };
}

/**
 * TaskDecompositionHandler - Breaks down complex tasks into atomic units
 */
export class TaskDecompositionHandler {
  /**
   * Decompose a high-level task into atomic, dependency-ordered tasks
   */
  async decomposeTask(
    taskDescription: string,
    affectedNodes: CodeNode[],
    impactMap: Map<string, ImpactResult>,
    basePriority: TaskPriority = 'normal',
  ): Promise<DecompositionResult> {
    await debugLog('Decomposing task', {
      task: taskDescription,
      nodeCount: affectedNodes.length,
    });

    // Step 1: Infer task type from description
    const taskType = this.inferTaskType(taskDescription);

    // Step 2: Group nodes by file
    const fileGroups = this.groupNodesByFile(affectedNodes);

    // Step 3: Create atomic tasks for each file
    const tasks: DecomposedTask[] = [];
    const taskIdsByFile = new Map<string, string>();

    for (const [filePath, nodes] of fileGroups.entries()) {
      const taskId = generateTaskId();
      taskIdsByFile.set(filePath, taskId);

      // Get the highest impact level for nodes in this file
      const impactLevel = this.getHighestImpactLevel(nodes, impactMap);

      // Adjust priority based on impact
      const adjustedPriority = this.adjustPriorityByImpact(basePriority, impactLevel);

      const task: DecomposedTask = {
        id: taskId,
        title: this.generateTaskTitle(taskDescription, filePath, nodes),
        description: this.generateTaskDescription(taskDescription, nodes),
        type: taskType,
        priority: adjustedPriority,
        priorityScore: TASK_PRIORITIES[adjustedPriority],
        impactLevel,
        nodeIds: nodes.map((n) => n.id),
        filePath,
        dependencies: [], // Will be filled in next step
        affectedNodes: nodes,
        metadata: {
          nodeCount: nodes.length,
          nodeTypes: this.getNodeTypeSummary(nodes),
        },
      };

      tasks.push(task);
    }

    // Step 4: Calculate dependencies based on impact analysis
    const dependencyGraph = this.calculateDependencies(tasks, impactMap);

    // Step 5: Update task dependencies
    for (const task of tasks) {
      task.dependencies = dependencyGraph.get(task.id) ?? [];
    }

    // Step 6: Topological sort for execution order
    const executionOrder = this.topologicalSort(tasks, dependencyGraph);

    // Step 7: Calculate parallelization potential
    const parallelizable = tasks.filter((t) => t.dependencies.length === 0).length;
    const sequential = tasks.length - parallelizable;

    const result: DecompositionResult = {
      tasks,
      dependencyGraph,
      executionOrder,
      summary: {
        totalTasks: tasks.length,
        parallelizable,
        sequential,
        estimatedComplexity: this.estimateComplexity(tasks, impactMap),
      },
    };

    await debugLog('Task decomposition complete', {
      totalTasks: tasks.length,
      parallelizable,
      sequential,
    });

    return result;
  }

  /**
   * Infer task type from natural language description
   */
  private inferTaskType(description: string): TaskType {
    const lowerDesc = description.toLowerCase();

    for (const [, pattern] of Object.entries(TASK_INFERENCE_PATTERNS)) {
      for (const keyword of pattern.keywords) {
        if (lowerDesc.includes(keyword)) {
          return pattern.taskType;
        }
      }
    }

    // Default to 'implement' if no pattern matches
    return 'implement';
  }

  /**
   * Group nodes by their file path
   */
  private groupNodesByFile(nodes: CodeNode[]): Map<string, CodeNode[]> {
    const groups = new Map<string, CodeNode[]>();

    for (const node of nodes) {
      const filePath = node.filePath;
      if (!groups.has(filePath)) {
        groups.set(filePath, []);
      }
      groups.get(filePath)!.push(node);
    }

    return groups;
  }

  /**
   * Get the highest impact level among a set of nodes
   */
  private getHighestImpactLevel(
    nodes: CodeNode[],
    impactMap: Map<string, ImpactResult>,
  ): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const levels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
    let highestIndex = 0;

    for (const node of nodes) {
      const impact = impactMap.get(node.id);
      if (impact) {
        const index = levels.indexOf(impact.riskLevel);
        if (index > highestIndex) {
          highestIndex = index;
        }
      }
    }

    return levels[highestIndex];
  }

  /**
   * Adjust priority based on impact level
   */
  private adjustPriorityByImpact(basePriority: TaskPriority, impactLevel: string): TaskPriority {
    const priorityOrder: TaskPriority[] = ['backlog', 'low', 'normal', 'high', 'critical'];
    const currentIndex = priorityOrder.indexOf(basePriority);

    // Bump priority for high-impact tasks (they need more attention)
    if (impactLevel === 'CRITICAL' && currentIndex < 4) {
      return priorityOrder[Math.min(currentIndex + 2, 4)];
    }
    if (impactLevel === 'HIGH' && currentIndex < 3) {
      return priorityOrder[Math.min(currentIndex + 1, 3)];
    }

    return basePriority;
  }

  /**
   * Generate a concise task title
   */
  private generateTaskTitle(taskDescription: string, filePath: string, nodes: CodeNode[]): string {
    const fileName = path.basename(filePath);
    const primaryNode = nodes[0];
    const nodeType = primaryNode?.semanticType ?? primaryNode?.coreType ?? 'code';

    // Extract action word from task description
    const actionMatch = taskDescription.match(/^(\w+)/i);
    const action = actionMatch ? actionMatch[1] : 'Update';

    if (nodes.length === 1) {
      return `${action} ${primaryNode.name} in ${fileName}`;
    }

    return `${action} ${nodes.length} ${nodeType}s in ${fileName}`;
  }

  /**
   * Generate detailed task description
   */
  private generateTaskDescription(taskDescription: string, nodes: CodeNode[]): string {
    const nodeList = nodes
      .slice(0, 5)
      .map((n) => `- ${n.name} (${n.semanticType ?? n.coreType})`)
      .join('\n');

    const moreText = nodes.length > 5 ? `\n... and ${nodes.length - 5} more` : '';

    return `${taskDescription}

Affected code elements:
${nodeList}${moreText}`;
  }

  /**
   * Get summary of node types
   */
  private getNodeTypeSummary(nodes: CodeNode[]): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const node of nodes) {
      const type = node.semanticType ?? node.coreType;
      summary[type] = (summary[type] ?? 0) + 1;
    }
    return summary;
  }

  /**
   * Calculate dependencies between tasks based on impact analysis
   *
   * Logic: If file A depends on file B (B is in A's affected files),
   * then the task for A should wait for B's task to complete.
   * This ensures changes propagate correctly through the dependency chain.
   */
  private calculateDependencies(tasks: DecomposedTask[], impactMap: Map<string, ImpactResult>): Map<string, string[]> {
    const taskByFile = new Map<string, DecomposedTask>();
    for (const task of tasks) {
      taskByFile.set(task.filePath, task);
    }

    const dependencies = new Map<string, string[]>();

    for (const task of tasks) {
      const deps: string[] = [];

      // Check each node in this task for dependencies
      for (const nodeId of task.nodeIds) {
        const impact = impactMap.get(nodeId);
        if (!impact) continue;

        // If this node depends on files that have their own tasks,
        // those tasks should complete first
        for (const affectedFile of impact.affectedFiles) {
          const depTask = taskByFile.get(affectedFile);
          if (depTask && depTask.id !== task.id && !deps.includes(depTask.id)) {
            deps.push(depTask.id);
          }
        }
      }

      dependencies.set(task.id, deps);
    }

    return dependencies;
  }

  /**
   * Topological sort to determine execution order
   * Returns task IDs in order: tasks with no dependencies first
   */
  private topologicalSort(tasks: DecomposedTask[], dependencyGraph: Map<string, string[]>): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const taskMap = new Map<string, DecomposedTask>();
    for (const task of tasks) {
      taskMap.set(task.id, task);
    }

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      if (visiting.has(taskId)) {
        // Cycle detected - skip to avoid infinite loop
        // In practice, this means the tasks can run in either order
        return;
      }

      visiting.add(taskId);

      const deps = dependencyGraph.get(taskId) ?? [];
      for (const depId of deps) {
        visit(depId);
      }

      visiting.delete(taskId);
      visited.add(taskId);
      result.push(taskId);
    };

    // Visit all tasks, prioritizing those with fewer dependencies
    const sortedTasks = [...tasks].sort(
      (a, b) => (dependencyGraph.get(a.id)?.length ?? 0) - (dependencyGraph.get(b.id)?.length ?? 0),
    );

    for (const task of sortedTasks) {
      visit(task.id);
    }

    return result;
  }

  /**
   * Estimate overall complexity of the decomposed tasks
   */
  private estimateComplexity(tasks: DecomposedTask[], impactMap: Map<string, ImpactResult>): 'LOW' | 'MEDIUM' | 'HIGH' {
    // Consider: number of tasks, dependency depth, impact levels
    const taskCount = tasks.length;
    const criticalCount = tasks.filter((t) => t.impactLevel === 'CRITICAL').length;
    const highCount = tasks.filter((t) => t.impactLevel === 'HIGH').length;

    // Calculate max dependency chain depth
    let maxDepth = 0;
    for (const task of tasks) {
      maxDepth = Math.max(maxDepth, task.dependencies.length);
    }

    // Scoring
    let score = 0;
    score += Math.min(taskCount / 10, 3); // Up to 3 points for task count
    score += criticalCount * 1.5; // 1.5 points per critical task
    score += highCount * 0.5; // 0.5 points per high-impact task
    score += maxDepth * 0.3; // 0.3 points per dependency depth level

    if (score >= 5) return 'HIGH';
    if (score >= 2) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Get tasks that can run in parallel (no pending dependencies)
   */
  getParallelizableTasks(allTasks: DecomposedTask[], completedTaskIds: Set<string>): DecomposedTask[] {
    return allTasks.filter((task) => {
      // Already completed
      if (completedTaskIds.has(task.id)) return false;

      // Check if all dependencies are completed
      const deps = task.dependencies;
      return deps.every((depId) => completedTaskIds.has(depId));
    });
  }
}

/**
 * Export singleton instance
 */
export const taskDecompositionHandler = new TaskDecompositionHandler();
