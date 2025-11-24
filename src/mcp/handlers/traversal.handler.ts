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
  useWeightedTraversal?: boolean;
}

interface Connection {
  depth: number;
  node: Neo4jNode;
  relationshipChain?: Array<{ type: string }>;
}

export class TraversalHandler {
  private static readonly NODE_NOT_FOUND_QUERY = 'MATCH (n) WHERE n.id = $nodeId RETURN n';

  constructor(private neo4jService: Neo4jService) {}

  async traverseFromNode(
    nodeId: string,
    embedding: number[],
    options: TraversalOptions = {},
  ): Promise<TraversalResult> {
    const {
      maxDepth = DEFAULTS.traversalDepth,
      skip = DEFAULTS.skipOffset,
      direction = 'BOTH',
      relationshipTypes,
      includeStartNodeDetails = true,
      includeCode = false,
      maxNodesPerChain = 5,
      summaryOnly = false,
      title = `Node Traversal from: ${nodeId}`,
      snippetLength = DEFAULTS.codeSnippetLength,
      useWeightedTraversal = false,
    } = options;

    try {
      await debugLog('Starting node traversal', { nodeId, maxDepth, skip });

      const startNode = await this.getStartNode(nodeId);
      if (!startNode) {
        return createErrorResponse(`Node with ID "${nodeId}" not found.`);
      }

      const maxNodesPerDepth = Math.ceil(maxNodesPerChain * 1.5);
      const traversalData = useWeightedTraversal
        ? await this.performTraversalByDepth(
            nodeId,
            embedding,
            maxDepth,
            maxNodesPerDepth,
            direction,
            relationshipTypes,
          )
        : await this.performTraversal(nodeId, embedding, maxDepth, skip, direction, relationshipTypes);

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
        content: [{ type: 'text', text: JSON.stringify(result) }],
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
    embedding: number[],
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

  private async performTraversalByDepth(
    nodeId: string,
    embedding: number[],
    maxDepth: number,
    maxNodesPerDepth: number,
    direction: 'OUTGOING' | 'INCOMING' | 'BOTH' = 'BOTH',
    relationshipTypes?: string[],
  ) {
    // Track visited nodes to avoid cycles
    const visitedNodeIds = new Set<string>([nodeId]);

    // Track the path (chain of relationships) to reach each node
    // Key: nodeId, Value: array of relationships from start node to this node
    const pathsToNode = new Map<string, any[]>();
    pathsToNode.set(nodeId, []); // Start node has empty path

    // Track which nodes to explore at each depth
    let currentSourceIds = [nodeId];

    // Result accumulators
    const allConnections: Connection[] = [];
    const nodeMap = new Map<string, Neo4jNode>(); // Dedupe nodes

    for (let depth = 1; depth <= maxDepth; depth++) {
      if (currentSourceIds.length === 0) {
        console.log(`No source nodes to explore at depth ${depth}`);
        break;
      }

      const traversalResults = await this.neo4jService.run(QUERIES.EXPLORE_DEPTH_LEVEL(direction, maxNodesPerDepth), {
        sourceNodeIds: currentSourceIds,
        visitedNodeIds: Array.from(visitedNodeIds),
        currentDepth: parseInt(depth.toString()),
        queryEmbedding: embedding,
        depthDecay: 0.85,
      });

      if (traversalResults.length === 0) {
        console.log(`No connections found at depth ${depth}`);
        break;
      }

      // Collect node IDs for next depth exploration
      const nextSourceIds: string[] = [];

      for (const row of traversalResults) {
        const { node, relationship, sourceNodeId, scoring } = row.result;
        const neighborId = node.id;

        // Skip if already visited (safety check)
        if (visitedNodeIds.has(neighborId)) continue;

        // Mark as visited
        visitedNodeIds.add(neighborId);
        nextSourceIds.push(neighborId);

        // Build the relationship chain:
        // This node's chain = parent's chain + this relationship
        const parentPath = pathsToNode.get(sourceNodeId) ?? [];
        const thisPath = [
          ...parentPath,
          {
            type: relationship.type,
            start: relationship.startNodeId,
            end: relationship.endNodeId,
            properties: relationship.properties,
            score: scoring.combinedScore,
          },
        ];
        pathsToNode.set(neighborId, thisPath);

        // Create connection with full relationship chain
        const connection: Connection = {
          depth,
          node: node as Neo4jNode,
          relationshipChain: thisPath,
        };
        allConnections.push(connection);

        // Accumulate unique nodes
        nodeMap.set(neighborId, node as Neo4jNode);
      }

      // Move to next depth with the newly discovered nodes
      currentSourceIds = nextSourceIds;
    }

    return {
      connections: allConnections,
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
    traversalData: { connections: Connection[]; graph?: any },
    title: string,
    includeStartNodeDetails: boolean,
    includeCode: boolean,
    maxNodesPerChain: number,
    snippetLength: number,
  ): any {
    // JSON:API normalization - collect all unique nodes
    const nodeMap = new Map<string, any>();

    // Get common root path from all nodes
    const allNodes = [startNode, ...traversalData.connections.map((c) => c.node)];
    const projectRoot = this.getCommonRootPath(allNodes);

    // Add start node to map
    if (includeStartNodeDetails) {
      const startNodeData = this.formatNodeJSON(startNode, includeCode, snippetLength, projectRoot);
      nodeMap.set(startNode.properties.id, startNodeData);
    }

    // Collect all unique nodes from connections
    traversalData.connections.forEach((conn) => {
      const nodeId = conn.node.properties.id;
      if (!nodeMap.has(nodeId)) {
        nodeMap.set(nodeId, this.formatNodeJSON(conn.node, includeCode, snippetLength, projectRoot));
      }
    });

    const byDepth = this.groupConnectionsByDepth(traversalData.connections);

    return {
      projectRoot,
      totalConnections: traversalData.connections.length,
      uniqueFiles: this.getUniqueFileCount(traversalData.connections),
      maxDepth: Object.keys(byDepth).length > 0 ? Math.max(...Object.keys(byDepth).map((d) => parseInt(d))) : 0,
      startNodeId: includeStartNodeDetails ? startNode.properties.id : undefined,
      nodes: Object.fromEntries(nodeMap),
      depths: this.formatConnectionsByDepthWithReferences(byDepth, maxNodesPerChain),
    };
  }

  private formatSummaryOnlyJSON(
    startNode: Neo4jNode,
    traversalData: { connections: Connection[]; graph?: any },
    title: string,
  ): any {
    const byDepth = this.groupConnectionsByDepth(traversalData.connections);
    const totalConnections = traversalData.connections.length;
    const maxDepthFound =
      Object.keys(byDepth).length > 0 ? Math.max(...Object.keys(byDepth).map((d) => parseInt(d))) : 0;
    const uniqueFiles = this.getUniqueFileCount(traversalData.connections);

    const allNodes = [startNode, ...traversalData.connections.map((c) => c.node)];
    const projectRoot = this.getCommonRootPath(allNodes);

    const fileMap = new Map<string, number>();
    traversalData.connections.forEach((conn) => {
      const filePath = conn.node.properties.filePath;
      if (filePath) {
        const relativePath = this.makeRelativePath(filePath, projectRoot);
        fileMap.set(relativePath, (fileMap.get(relativePath) ?? 0) + 1);
      }
    });

    const connectedFiles = Array.from(fileMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([file, count]) => ({ file, nodeCount: count }));

    const maxSummaryFiles = DEFAULTS.maxResultsDisplayed;

    return {
      projectRoot,
      startNodeId: startNode.properties.id,
      nodes: {
        [startNode.properties.id]: this.formatNodeJSON(startNode, false, 0, projectRoot),
      },
      totalConnections,
      maxDepth: maxDepthFound,
      uniqueFiles,
      files: connectedFiles.slice(0, maxSummaryFiles),
      ...(fileMap.size > maxSummaryFiles && { hasMore: fileMap.size - maxSummaryFiles }),
    };
  }

  private formatNodeJSON(node: Neo4jNode, includeCode: boolean, snippetLength: number, projectRoot?: string): any {
    const result: any = {
      id: node.properties.id,
      type: node.properties.semanticType ?? node.labels.at(-1) ?? 'Unknown',
      filePath: projectRoot ? this.makeRelativePath(node.properties.filePath, projectRoot) : node.properties.filePath,
    };

    if (node.properties.name) {
      result.name = node.properties.name;
    }

    if (includeCode && node.properties.sourceCode && node.properties.coreType !== 'SourceFile') {
      const code = node.properties.sourceCode;
      const maxLength = snippetLength; // Use the provided snippet length

      if (code.length <= maxLength) {
        result.sourceCode = code;
      } else {
        // Show first half and last half of the snippet
        const half = Math.floor(maxLength / 2);
        result.sourceCode =
          code.substring(0, half) + '\n\n... [truncated] ...\n\n' + code.substring(code.length - half);
        result.hasMore = true;
        result.truncated = code.length - maxLength;
      }
    }

    return result;
  }

  private formatConnectionsByDepthWithReferences(
    byDepth: Record<number, Connection[]>,
    maxNodesPerChain: number,
  ): any[] {
    return Object.keys(byDepth)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map((depth) => {
        const depthConnections = byDepth[parseInt(depth)];

        const connectionsToShow = Math.min(depthConnections.length, maxNodesPerChain);

        const chains = depthConnections.slice(0, connectionsToShow).map((conn) => {
          return (
            conn.relationshipChain?.map((rel: any) => ({
              type: rel.type,
              from: rel.start,
              to: rel.end,
            })) ?? []
          );
        });

        return {
          depth: parseInt(depth),
          count: depthConnections.length,
          chains,
          ...(depthConnections.length > connectionsToShow && {
            hasMore: depthConnections.length - connectionsToShow,
          }),
        };
      });
  }

  private getCommonRootPath(nodes: Neo4jNode[]): string {
    const filePaths = nodes.map((n) => n.properties.filePath).filter(Boolean) as string[];

    if (filePaths.length === 0) return process.cwd();

    // Split all paths into parts
    const pathParts = filePaths.map((p) => p.split('/'));

    // Find common prefix
    const commonParts: string[] = [];
    const firstPath = pathParts[0];

    for (let i = 0; i < firstPath.length; i++) {
      const part = firstPath[i];
      if (pathParts.every((p) => p[i] === part)) {
        commonParts.push(part);
      } else {
        break;
      }
    }

    return commonParts.join('/') || '/';
  }

  private makeRelativePath(absolutePath: string | undefined, projectRoot: string): string {
    if (!absolutePath) return '';
    if (!projectRoot || projectRoot === '/') return absolutePath;

    // Ensure both paths end consistently
    const root = projectRoot.endsWith('/') ? projectRoot : projectRoot + '/';

    if (absolutePath.startsWith(root)) {
      return absolutePath.substring(root.length);
    }

    return absolutePath;
  }
}
