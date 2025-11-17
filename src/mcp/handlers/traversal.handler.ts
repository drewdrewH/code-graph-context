/**
 * Traversal Handler
 * Handles graph traversal operations with formatting and pagination
 */

import { MAX_TRAVERSAL_DEPTH } from '../../constants.js';
import { Neo4jNode } from '../../core/config/schema.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';
import { DEFAULTS } from '../constants.js';
import { createErrorResponse, createSuccessResponse, debugLog } from '../utils.js';

export interface TraversalResult {
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
}

export interface TraversalOptions {
  maxDepth?: number;
  skip?: number;
  direction?: 'OUTGOING' | 'INCOMING' | 'BOTH';
  relationshipTypes?: string[];
  includeStartNodeDetails?: boolean;
  includeCode?: boolean;
  maxNodesPerChain?: number;
  summaryOnly?: boolean;
  title?: string;
  snippetLength?: number;
}

interface Connection {
  depth: number;
  node: Neo4jNode;
  relationshipChain?: Array<{ type: string }>;
}

export class TraversalHandler {
  private static readonly NODE_NOT_FOUND_QUERY = 'MATCH (n) WHERE n.id = $nodeId RETURN n';
  private static readonly MAX_NODES_PER_CHAIN = 8;

  constructor(private neo4jService: Neo4jService) {}

  async traverseFromNode(nodeId: string, options: TraversalOptions = {}): Promise<TraversalResult> {
    const {
      maxDepth = DEFAULTS.traversalDepth,
      skip = DEFAULTS.skipOffset,
      direction = 'BOTH',
      relationshipTypes,
      includeStartNodeDetails = true,
      includeCode = false,
      maxNodesPerChain = TraversalHandler.MAX_NODES_PER_CHAIN,
      summaryOnly = false,
      title = `Node Traversal from: ${nodeId}`,
      snippetLength = DEFAULTS.codeSnippetLength,
    } = options;

    try {
      await debugLog('Starting node traversal', { nodeId, maxDepth, skip });

      const startNode = await this.getStartNode(nodeId);
      if (!startNode) {
        return createErrorResponse(`Node with ID "${nodeId}" not found.`);
      }

      const traversalData = await this.performTraversal(nodeId, maxDepth, skip, direction, relationshipTypes);
      if (!traversalData) {
        return createSuccessResponse(`No connections found for node "${nodeId}".`);
      }

      const result = summaryOnly
        ? this.formatSummaryOnlyJSON(startNode, traversalData, title)
        : this.formatTraversalJSON(
            startNode,
            traversalData,
            title,
            includeStartNodeDetails,
            includeCode,
            maxNodesPerChain,
            snippetLength,
          );

      await debugLog('Traversal completed', {
        connectionsFound: traversalData.connections.length,
        uniqueFiles: this.getUniqueFileCount(traversalData.connections),
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      console.error('Node traversal error:', error);
      await debugLog('Node traversal error', { nodeId, error });
      return createErrorResponse(error);
    }
  }

  private async getStartNode(nodeId: string): Promise<Neo4jNode | null> {
    const startNodeResult = await this.neo4jService.run(TraversalHandler.NODE_NOT_FOUND_QUERY, { nodeId });

    return startNodeResult.length > 0 ? startNodeResult[0].n : null;
  }

  private async performTraversal(
    nodeId: string,
    maxDepth: number,
    skip: number,
    direction: 'OUTGOING' | 'INCOMING' | 'BOTH' = 'BOTH',
    relationshipTypes?: string[],
  ) {
    const traversal = await this.neo4jService.run(
      QUERIES.EXPLORE_ALL_CONNECTIONS(Math.min(maxDepth, MAX_TRAVERSAL_DEPTH), direction, relationshipTypes),
      {
        nodeId,
        skip: parseInt(skip.toString()),
      },
    );

    if (traversal.length === 0) {
      return null;
    }

    const result = traversal[0]?.result ?? {};
    return {
      connections: result.connections ?? [],
      graph: result.graph ?? { nodes: [], relationships: [] },
    };
  }

  private groupConnectionsByDepth(connections: Connection[]): Record<number, Connection[]> {
    return connections.reduce(
      (acc, conn) => {
        const depth = conn.depth;
        acc[depth] ??= [];
        acc[depth].push(conn);
        return acc;
      },
      {} as Record<number, Connection[]>,
    );
  }

  private groupConnectionsByRelationshipChain(connections: Connection[]): Record<string, Connection[]> {
    return connections.reduce(
      (acc, conn) => {
        // Build chain with direction arrows
        const chain =
          conn.relationshipChain
            ?.map((rel: any) => {
              // rel has: { type, start, end, properties }
              return rel.type;
            })
            .join(' → ') ?? 'Unknown';
        acc[chain] ??= [];
        acc[chain].push(conn);
        return acc;
      },
      {} as Record<string, Connection[]>,
    );
  }

  private getRelationshipDirection(connection: Connection, startNodeId: string): 'OUTGOING' | 'INCOMING' | 'UNKNOWN' {
    // Check the first relationship in the chain to determine direction from start node
    const firstRel = connection.relationshipChain?.[0] as any;
    if (!firstRel?.start || !firstRel.end) {
      return 'UNKNOWN';
    }

    // If the start node is the source of the first relationship, it's OUTGOING
    // If the start node is the target of the first relationship, it's INCOMING
    if (firstRel.start === startNodeId) {
      return 'OUTGOING';
    } else if (firstRel.end === startNodeId) {
      return 'INCOMING';
    }

    return 'UNKNOWN';
  }

  private getUniqueFileCount(connections: Connection[]): number {
    return new Set(connections.map((c) => c.node.properties.filePath).filter(Boolean)).size;
  }

  private formatTraversalJSON(
    startNode: Neo4jNode,
    traversalData: { connections: Connection[]; graph: any },
    title: string,
    includeStartNodeDetails: boolean,
    includeCode: boolean,
    maxNodesPerChain: number,
    snippetLength: number,
  ): any {
    // JSON:API normalization - collect all unique nodes
    const nodeMap = new Map<string, any>();

    // Add start node to map
    if (includeStartNodeDetails) {
      const startNodeData = this.formatNodeJSON(startNode, includeCode, snippetLength);
      nodeMap.set(startNode.properties.id, startNodeData);
    }

    // Collect all unique nodes from connections
    traversalData.connections.forEach((conn) => {
      const nodeId = conn.node.properties.id;
      if (!nodeMap.has(nodeId)) {
        nodeMap.set(nodeId, this.formatNodeJSON(conn.node, includeCode, snippetLength));
      }
    });

    const byDepth = this.groupConnectionsByDepth(traversalData.connections);

    return {
      totalConnections: traversalData.connections.length,
      uniqueFiles: this.getUniqueFileCount(traversalData.connections),
      maxDepth: Object.keys(byDepth).length > 0 ? Math.max(...Object.keys(byDepth).map((d) => parseInt(d))) : 0,
      startNodeId: includeStartNodeDetails ? startNode.properties.id : undefined,
      nodes: Object.fromEntries(nodeMap),
      depths: this.formatConnectionsByDepthWithReferences(byDepth, maxNodesPerChain, startNode.properties.id),
    };
  }

  private formatSummaryOnlyJSON(
    startNode: Neo4jNode,
    traversalData: { connections: Connection[]; graph: any },
    title: string,
  ): any {
    const byDepth = this.groupConnectionsByDepth(traversalData.connections);
    const totalConnections = traversalData.connections.length;
    const maxDepthFound =
      Object.keys(byDepth).length > 0 ? Math.max(...Object.keys(byDepth).map((d) => parseInt(d))) : 0;
    const uniqueFiles = this.getUniqueFileCount(traversalData.connections);

    const fileMap = new Map<string, number>();
    traversalData.connections.forEach((conn) => {
      const filePath = conn.node.properties.filePath;
      if (filePath) {
        fileMap.set(filePath, (fileMap.get(filePath) ?? 0) + 1);
      }
    });

    const connectedFiles = Array.from(fileMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([file, count]) => ({ file, nodeCount: count }));

    return {
      startNodeId: startNode.properties.id,
      nodes: {
        [startNode.properties.id]: this.formatNodeJSON(startNode, false, 0),
      },
      totalConnections,
      maxDepth: maxDepthFound,
      uniqueFiles,
      files: connectedFiles.slice(0, 20),
      ...(fileMap.size > 20 && { hasMore: fileMap.size - 20 }),
    };
  }

  private formatNodeJSON(node: Neo4jNode, includeCode: boolean, snippetLength: number): any {
    const result: any = {
      id: node.properties.id,
      type: node.labels[0] ?? 'Unknown',
      filePath: node.properties.filePath,
    };

    if (node.properties.name) {
      result.name = node.properties.name;
    }

    if (includeCode && node.properties.sourceCode && node.properties.coreType !== 'SourceFile') {
      result.sourceCode = node.properties.sourceCode.substring(0, snippetLength);
      if (node.properties.sourceCode.length > snippetLength) {
        result.hasMore = true;
      }
    }

    return result;
  }

  private formatConnectionsByDepthWithReferences(
    byDepth: Record<number, Connection[]>,
    maxNodesPerChain: number,
    startNodeId: string,
  ): any[] {
    return Object.keys(byDepth)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map((depth) => {
        const depthConnections = byDepth[parseInt(depth)];
        const byRelChain = this.groupConnectionsByRelationshipChain(depthConnections);

        const chains = Object.entries(byRelChain).map(([chain, nodes]) => {
          const firstNode = nodes[0];
          const direction = this.getRelationshipDirection(firstNode, startNodeId);
          const displayNodes = nodes.slice(0, maxNodesPerChain);

          const chainResult: any = {
            via: chain,
            direction,
            count: nodes.length,
            nodeIds: displayNodes.map((conn) => conn.node.properties.id),
          };

          if (nodes.length > maxNodesPerChain) {
            chainResult.hasMore = nodes.length - maxNodesPerChain;
          }

          return chainResult;
        });

        return {
          depth: parseInt(depth),
          count: depthConnections.length,
          chains,
        };
      });
  }
}
