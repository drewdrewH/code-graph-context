/**
 * Cross-File Edge Helpers
 * Shared utilities for managing cross-file edges during incremental parsing
 */

import type { ExistingNode } from '../../core/parsers/typescript-parser.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';

export interface CrossFileEdge {
  startNodeId: string;
  endNodeId: string;
  edgeType: string;
  edgeProperties: Record<string, unknown>;
}

export const deleteSourceFileSubgraphs = async (
  neo4jService: Neo4jService,
  filePaths: string[],
  projectId: string,
): Promise<void> => {
  await neo4jService.run(QUERIES.DELETE_SOURCE_FILE_SUBGRAPHS, { filePaths, projectId });
};

export const loadExistingNodesForEdgeDetection = async (
  neo4jService: Neo4jService,
  excludeFilePaths: string[],
  projectId: string,
): Promise<ExistingNode[]> => {
  const queryResult = await neo4jService.run(QUERIES.GET_EXISTING_NODES_FOR_EDGE_DETECTION, {
    excludeFilePaths,
    projectId,
  });
  return queryResult as ExistingNode[];
};

export const getCrossFileEdges = async (
  neo4jService: Neo4jService,
  filePaths: string[],
  projectId: string,
): Promise<CrossFileEdge[]> => {
  const queryResult = await neo4jService.run(QUERIES.GET_CROSS_FILE_EDGES, { filePaths, projectId });
  return queryResult as CrossFileEdge[];
};
