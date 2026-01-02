/**
 * Swarm Cleanup Tool
 * Bulk delete pheromones after a swarm completes
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { TOOL_NAMES, TOOL_METADATA } from '../constants.js';
import { createErrorResponse, createSuccessResponse, resolveProjectIdOrError, debugLog } from '../utils.js';

/**
 * Neo4j query to delete pheromones by swarm ID
 */
const CLEANUP_BY_SWARM_QUERY = `
  MATCH (p:Pheromone)
  WHERE p.projectId = $projectId
    AND p.swarmId = $swarmId
    AND NOT p.type IN $keepTypes
  WITH p, p.agentId as agentId, p.type as type
  DETACH DELETE p
  RETURN count(p) as deleted, collect(DISTINCT agentId) as agents, collect(DISTINCT type) as types
`;

/**
 * Neo4j query to delete pheromones by agent ID
 */
const CLEANUP_BY_AGENT_QUERY = `
  MATCH (p:Pheromone)
  WHERE p.projectId = $projectId
    AND p.agentId = $agentId
    AND NOT p.type IN $keepTypes
  WITH p, p.swarmId as swarmId, p.type as type
  DETACH DELETE p
  RETURN count(p) as deleted, collect(DISTINCT swarmId) as swarms, collect(DISTINCT type) as types
`;

/**
 * Neo4j query to delete all pheromones in a project
 */
const CLEANUP_ALL_QUERY = `
  MATCH (p:Pheromone)
  WHERE p.projectId = $projectId
    AND NOT p.type IN $keepTypes
  WITH p, p.agentId as agentId, p.swarmId as swarmId, p.type as type
  DETACH DELETE p
  RETURN count(p) as deleted, collect(DISTINCT agentId) as agents, collect(DISTINCT swarmId) as swarms, collect(DISTINCT type) as types
`;

/**
 * Count queries for dry run
 */
const COUNT_BY_SWARM_QUERY = `
  MATCH (p:Pheromone)
  WHERE p.projectId = $projectId AND p.swarmId = $swarmId AND NOT p.type IN $keepTypes
  RETURN count(p) as count, collect(DISTINCT p.agentId) as agents, collect(DISTINCT p.type) as types
`;

const COUNT_BY_AGENT_QUERY = `
  MATCH (p:Pheromone)
  WHERE p.projectId = $projectId AND p.agentId = $agentId AND NOT p.type IN $keepTypes
  RETURN count(p) as count, collect(DISTINCT p.swarmId) as swarms, collect(DISTINCT p.type) as types
`;

const COUNT_ALL_QUERY = `
  MATCH (p:Pheromone)
  WHERE p.projectId = $projectId AND NOT p.type IN $keepTypes
  RETURN count(p) as count, collect(DISTINCT p.agentId) as agents, collect(DISTINCT p.swarmId) as swarms, collect(DISTINCT p.type) as types
`;

export const createSwarmCleanupTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.swarmCleanup,
    {
      title: TOOL_METADATA[TOOL_NAMES.swarmCleanup].title,
      description: TOOL_METADATA[TOOL_NAMES.swarmCleanup].description,
      inputSchema: {
        projectId: z.string().describe('Project ID, name, or path'),
        swarmId: z.string().optional().describe('Delete all pheromones from this swarm'),
        agentId: z.string().optional().describe('Delete all pheromones from this agent'),
        all: z.boolean().optional().default(false).describe('Delete ALL pheromones in project (use with caution)'),
        keepTypes: z
          .array(z.string())
          .optional()
          .default(['warning'])
          .describe('Pheromone types to preserve (default: ["warning"])'),
        dryRun: z.boolean().optional().default(false).describe('Preview what would be deleted without deleting'),
      },
    },
    async ({ projectId, swarmId, agentId, all = false, keepTypes = ['warning'], dryRun = false }) => {
      const neo4jService = new Neo4jService();

      // Resolve project ID
      const projectResult = await resolveProjectIdOrError(projectId, neo4jService);
      if (!projectResult.success) {
        await neo4jService.close();
        return projectResult.error;
      }
      const resolvedProjectId = projectResult.projectId;

      try {
        // Validate: must specify swarmId, agentId, or all
        if (!swarmId && !agentId && !all) {
          return createErrorResponse(
            'Must specify one of: swarmId, agentId, or all=true. Use dryRun=true to preview.',
          );
        }

        await debugLog('Swarm cleanup operation', {
          projectId: resolvedProjectId,
          swarmId,
          agentId,
          all,
          keepTypes,
          dryRun,
        });

        const params: Record<string, unknown> = { projectId: resolvedProjectId, keepTypes };
        let deleteQuery: string;
        let countQuery: string;
        let mode: string;

        if (swarmId) {
          params.swarmId = swarmId;
          deleteQuery = CLEANUP_BY_SWARM_QUERY;
          countQuery = COUNT_BY_SWARM_QUERY;
          mode = 'swarm';
        } else if (agentId) {
          params.agentId = agentId;
          deleteQuery = CLEANUP_BY_AGENT_QUERY;
          countQuery = COUNT_BY_AGENT_QUERY;
          mode = 'agent';
        } else {
          deleteQuery = CLEANUP_ALL_QUERY;
          countQuery = COUNT_ALL_QUERY;
          mode = 'all';
        }

        if (dryRun) {
          const result = await neo4jService.run(countQuery, params);
          const count = result[0]?.count ?? 0;

          return createSuccessResponse(
            JSON.stringify({
              success: true,
              dryRun: true,
              mode,
              wouldDelete: typeof count === 'object' && 'toNumber' in count ? count.toNumber() : count,
              agents: result[0]?.agents ?? [],
              swarms: result[0]?.swarms ?? [],
              types: result[0]?.types ?? [],
              keepTypes,
              projectId: resolvedProjectId,
            }),
          );
        }

        const result = await neo4jService.run(deleteQuery, params);
        const deleted = result[0]?.deleted ?? 0;

        return createSuccessResponse(
          JSON.stringify({
            success: true,
            mode,
            deleted: typeof deleted === 'object' && 'toNumber' in deleted ? deleted.toNumber() : deleted,
            agents: result[0]?.agents ?? [],
            swarms: result[0]?.swarms ?? [],
            types: result[0]?.types ?? [],
            keepTypes,
            projectId: resolvedProjectId,
          }),
        );
      } catch (error) {
        await debugLog('Swarm cleanup error', { error: String(error) });
        return createErrorResponse(error instanceof Error ? error : String(error));
      } finally {
        await neo4jService.close();
      }
    },
  );
};
