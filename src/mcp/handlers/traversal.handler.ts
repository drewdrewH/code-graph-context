/**
 * Traversal Handler
 * Handles graph traversal operations with formatting and pagination
 */

import { MAX_TRAVERSAL_DEPTH } from '../../constants.js';
import { Neo4jNode } from '../../core/config/schema.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';
import { EMOJIS, DEFAULTS } from '../constants.js';
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

      const response = summaryOnly
        ? this.formatSummaryOnlyResponse(startNode, traversalData, title)
        : this.formatTraversalResponse(
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

      // Sanitize graph data by removing sourceCode to prevent JSON serialization issues
      const sanitizedNodes =
        traversalData.graph.nodes?.map((node: Neo4jNode) => ({
          ...node,
          properties: {
            ...node.properties,
            sourceCode: undefined, // Remove sourceCode from graph data
          },
        })) ?? [];

      const sanitizedConnections =
        traversalData.connections?.map((conn: Connection) => ({
          ...conn,
          node: {
            ...conn.node,
            properties: {
              ...conn.node.properties,
              sourceCode: undefined, // Remove sourceCode from graph data
            },
          },
        })) ?? [];

      return {
        content: [{ type: 'text', text: response }],
        graph: {
          nodes: sanitizedNodes,
          relationships: traversalData.graph.relationships,
          connections: sanitizedConnections,
        },
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

  private formatTraversalResponse(
    startNode: Neo4jNode,
    traversalData: { connections: Connection[]; graph: any },
    title: string,
    includeStartNodeDetails: boolean,
    includeCode: boolean,
    maxNodesPerChain: number,
    snippetLength: number,
  ): string {
    let response = `# ${EMOJIS.search} ${title}\n\n`;

    if (includeStartNodeDetails) {
      response += this.formatStartNode(startNode, includeCode, snippetLength);
    }

    const startNodeId = startNode.properties.id;
    const byDepth = this.groupConnectionsByDepth(traversalData.connections);
    response += this.formatConnectionsByDepth(byDepth, includeCode, maxNodesPerChain, snippetLength, startNodeId);
    response += this.formatSummary(traversalData.connections, byDepth);

    return response;
  }

  private formatStartNode(startNode: Neo4jNode, includeCode: boolean, snippetLength: number): string {
    const properties = startNode.properties;
    let codeDisplay = '';

    if (includeCode) {
      const sourceCode = properties.sourceCode;
      codeDisplay = sourceCode
        ? `\`\`\`typescript\n${sourceCode.substring(0, snippetLength)}${sourceCode.length > snippetLength ? '...' : ''}\n\`\`\`\n`
        : '_No source code available_\n';
    }

    return `## 🎯 Starting Node
**Type:** ${startNode.labels[0] ?? 'Unknown'}
**ID:** ${properties.id}
**File:** ${properties.filePath}
${properties.name ? `**Name:** ${properties.name}\n` : ''}${codeDisplay}
`;
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

  private formatConnectionsByDepth(
    byDepth: Record<number, Connection[]>,
    includeCode: boolean,
    maxNodesPerChain: number,
    snippetLength: number,
    startNodeId: string,
  ): string {
    let response = '';

    Object.keys(byDepth)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .forEach((depth) => {
        const depthConnections = byDepth[parseInt(depth)];
        response += `## 🔗 Depth ${depth} Connections (${depthConnections.length} found)\n\n`;

        const byRelChain = this.groupConnectionsByRelationshipChain(depthConnections);
        response += this.formatConnectionsByChain(
          byRelChain,
          includeCode,
          maxNodesPerChain,
          snippetLength,
          startNodeId,
        );
      });

    return response;
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

  private formatConnectionsByChain(
    byRelChain: Record<string, Connection[]>,
    includeCode: boolean,
    maxNodesPerChain: number,
    snippetLength: number,
    startNodeId: string,
  ): string {
    let response = '';

    Object.entries(byRelChain).forEach(([chain, nodes]) => {
      if (nodes.length > 0) {
        // Determine direction based on first node's relationship chain
        const firstNode = nodes[0];
        const direction = this.getRelationshipDirection(firstNode, startNodeId);
        const directionLabel =
          direction === 'OUTGOING' ? '(outgoing →)' : direction === 'INCOMING' ? '(incoming ←)' : '';

        response += `### via \`${chain}\` ${directionLabel} (${nodes.length} nodes)\n\n`;
        response += this.formatChainNodes(nodes, includeCode, maxNodesPerChain, snippetLength);
      }
    });

    return response;
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

  private formatChainNodes(
    nodes: Connection[],
    includeCode: boolean,
    maxNodesPerChain: number,
    snippetLength: number,
  ): string {
    let response = '';
    const displayNodes = nodes.slice(0, maxNodesPerChain);

    displayNodes.forEach((conn, index) => {
      const node = conn.node;
      const properties = node.properties;
      let codeDisplay = '';

      if (includeCode) {
        const sourceCode = properties.sourceCode;
        codeDisplay = sourceCode
          ? `\`\`\`typescript\n${sourceCode.substring(0, snippetLength)}${sourceCode.length > snippetLength ? '...' : ''}\n\`\`\`\n`
          : '_No source code_\n';
      }

      response += `**${index + 1}.** ${node.labels[0] ?? 'Code'}
- **ID:** ${properties.id}
- **File:** ${properties.filePath}
${properties.name ? `- **Name:** ${properties.name}\n` : ''}${codeDisplay}
`;
    });

    if (nodes.length > maxNodesPerChain) {
      response += `_... and ${nodes.length - maxNodesPerChain} more nodes via this path_\n\n`;
    }

    return response;
  }

  private formatSummaryOnlyResponse(
    startNode: Neo4jNode,
    traversalData: { connections: Connection[]; graph: any },
    title: string,
  ): string {
    const properties = startNode.properties;
    let response = `# ${EMOJIS.search} ${title}\n\n`;

    response += `## 🎯 Starting Node\n`;
    response += `**Type:** ${startNode.labels[0] ?? 'Unknown'} | **ID:** ${properties.id}\n`;
    response += `**File:** ${properties.filePath}\n`;
    if (properties.name) response += `**Name:** ${properties.name}\n`;

    response += `\n## 📊 Summary\n`;
    const byDepth = this.groupConnectionsByDepth(traversalData.connections);
    const totalConnections = traversalData.connections.length;
    const maxDepthFound =
      Object.keys(byDepth).length > 0 ? Math.max(...Object.keys(byDepth).map((d) => parseInt(d))) : 0;
    const uniqueFiles = this.getUniqueFileCount(traversalData.connections);

    response += `- **Total Connections:** ${totalConnections}\n`;
    response += `- **Max Depth:** ${maxDepthFound}\n`;
    response += `- **Unique Files:** ${uniqueFiles}\n\n`;

    // List unique files with node counts
    const fileMap = new Map<string, number>();
    traversalData.connections.forEach((conn) => {
      const filePath = conn.node.properties.filePath;
      if (filePath) {
        fileMap.set(filePath, (fileMap.get(filePath) || 0) + 1);
      }
    });

    response += `### Connected Files\n`;
    Array.from(fileMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .forEach(([file, count]) => {
        response += `- ${file} (${count} nodes)\n`;
      });

    if (fileMap.size > 20) {
      response += `\n_... and ${fileMap.size - 20} more files_\n`;
    }

    return response;
  }

  private formatSummary(connections: Connection[], byDepth: Record<number, Connection[]>): string {
    const totalConnections = connections.length;
    const maxDepthFound =
      Object.keys(byDepth).length > 0 ? Math.max(...Object.keys(byDepth).map((d) => parseInt(d))) : 0;
    const uniqueFiles = this.getUniqueFileCount(connections);

    return `\n---\n\n**Summary:** Found ${totalConnections} connected nodes across ${maxDepthFound} depth levels, spanning ${uniqueFiles} files.`;
  }

  private getUniqueFileCount(connections: Connection[]): number {
    return new Set(connections.map((c) => c.node.properties.filePath).filter(Boolean)).size;
  }
}
