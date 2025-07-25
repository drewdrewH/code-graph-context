/**
 * Traversal Handler
 * Handles graph traversal operations with formatting and pagination
 */

import { MAX_TRAVERSAL_DEPTH } from '../../constants.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';
import { Neo4jNode, Neo4jNodeProperties } from '../../core/config/graph-v2.js';
import { EMOJIS, DEFAULTS } from '../constants.js';
import { createErrorResponse, createSuccessResponse, debugLog } from '../utils.js';

export interface TraversalResult {
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
}

export interface TraversalOptions {
  maxDepth?: number;
  skip?: number;
  includeStartNodeDetails?: boolean;
  title?: string;
}

interface Connection {
  depth: number;
  node: Neo4jNode;
  relationshipChain?: Array<{ type: string }>;
}

export class TraversalHandler {
  private static readonly NODE_NOT_FOUND_QUERY = 'MATCH (n) WHERE n.id = $nodeId RETURN n';
  private static readonly MAX_NODES_PER_CHAIN = 8;
  private static readonly CODE_SNIPPET_LENGTH = 200;
  private static readonly CHAIN_SNIPPET_LENGTH = 120;

  constructor(private neo4jService: Neo4jService) {}

  async traverseFromNode(nodeId: string, options: TraversalOptions = {}): Promise<TraversalResult> {
    const {
      maxDepth = DEFAULTS.traversalDepth,
      skip = DEFAULTS.skipOffset,
      includeStartNodeDetails = true,
      title = `Node Traversal from: ${nodeId}`,
    } = options;

    try {
      await debugLog('Starting node traversal', { nodeId, maxDepth, skip });

      const startNode = await this.getStartNode(nodeId);
      if (!startNode) {
        return createErrorResponse(`Node with ID "${nodeId}" not found.`);
      }

      const traversalData = await this.performTraversal(nodeId, maxDepth, skip);
      if (!traversalData) {
        return createSuccessResponse(`No connections found for node "${nodeId}".`);
      }

      const response = this.formatTraversalResponse(
        startNode,
        traversalData,
        title,
        includeStartNodeDetails
      );

      await debugLog('Traversal completed', { 
        connectionsFound: traversalData.connections.length,
        uniqueFiles: this.getUniqueFileCount(traversalData.connections)
      });

      return {
        content: [{ type: 'text', text: response }],
        graph: {
          nodes: traversalData.graph.nodes,
          relationships: traversalData.graph.relationships,
          connections: traversalData.connections,
        },
      };
    } catch (error) {
      console.error('Node traversal error:', error);
      await debugLog('Node traversal error', { nodeId, error });
      return createErrorResponse(error);
    }
  }

  private async getStartNode(nodeId: string): Promise<Neo4jNode | null> {
    const startNodeResult = await this.neo4jService.run(
      TraversalHandler.NODE_NOT_FOUND_QUERY,
      { nodeId }
    );

    return startNodeResult.length > 0 ? startNodeResult[0].n : null;
  }

  private async performTraversal(nodeId: string, maxDepth: number, skip: number) {
    const traversal = await this.neo4jService.run(
      QUERIES.EXPLORE_ALL_CONNECTIONS(Math.min(maxDepth, MAX_TRAVERSAL_DEPTH)),
      {
        nodeId,
        skip: parseInt(skip.toString()),
      }
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
    includeStartNodeDetails: boolean
  ): string {
    let response = `# ${EMOJIS.search} ${title}\n\n`;

    if (includeStartNodeDetails) {
      response += this.formatStartNode(startNode);
    }

    const byDepth = this.groupConnectionsByDepth(traversalData.connections);
    response += this.formatConnectionsByDepth(byDepth);
    response += this.formatSummary(traversalData.connections, byDepth);
    response += this.formatGraphStructure(traversalData.graph);

    return response;
  }

  private formatStartNode(startNode: Neo4jNode): string {
    const properties = startNode.properties;
    const sourceCode = properties.sourceCode;
    const codeDisplay = sourceCode
      ? `\`\`\`typescript\n${sourceCode.substring(0, TraversalHandler.CODE_SNIPPET_LENGTH)}${sourceCode.length > TraversalHandler.CODE_SNIPPET_LENGTH ? '...' : ''}\n\`\`\``
      : '_No source code available_';

    return `## 🎯 Starting Node
**Type:** ${startNode.labels[0] ?? 'Unknown'}
**ID:** ${properties.id}
**File:** ${properties.filePath}
${properties.name ? `**Name:** ${properties.name}\n` : ''}
${codeDisplay}

`;
  }

  private groupConnectionsByDepth(connections: Connection[]): Record<number, Connection[]> {
    return connections.reduce((acc, conn) => {
      const depth = conn.depth;
      acc[depth] ??= [];
      acc[depth].push(conn);
      return acc;
    }, {} as Record<number, Connection[]>);
  }

  private formatConnectionsByDepth(byDepth: Record<number, Connection[]>): string {
    let response = '';

    Object.keys(byDepth)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .forEach((depth) => {
        const depthConnections = byDepth[parseInt(depth)];
        response += `## 🔗 Depth ${depth} Connections (${depthConnections.length} found)\n\n`;

        const byRelChain = this.groupConnectionsByRelationshipChain(depthConnections);
        response += this.formatConnectionsByChain(byRelChain);
      });

    return response;
  }

  private groupConnectionsByRelationshipChain(connections: Connection[]): Record<string, Connection[]> {
    return connections.reduce((acc, conn) => {
      const chain = conn.relationshipChain?.map((rel) => rel.type).join(' → ') ?? 'Unknown';
      acc[chain] ??= [];
      acc[chain].push(conn);
      return acc;
    }, {} as Record<string, Connection[]>);
  }

  private formatConnectionsByChain(byRelChain: Record<string, Connection[]>): string {
    let response = '';

    Object.entries(byRelChain).forEach(([chain, nodes]) => {
      if (nodes.length > 0) {
        response += `### via \`${chain}\` (${nodes.length} nodes)\n\n`;
        response += this.formatChainNodes(nodes);
      }
    });

    return response;
  }

  private formatChainNodes(nodes: Connection[]): string {
    let response = '';
    const displayNodes = nodes.slice(0, TraversalHandler.MAX_NODES_PER_CHAIN);

    displayNodes.forEach((conn, index) => {
      const node = conn.node;
      const properties = node.properties;
      const sourceCode = properties.sourceCode;
      const codeDisplay = sourceCode
        ? `\`\`\`typescript\n${sourceCode.substring(0, TraversalHandler.CHAIN_SNIPPET_LENGTH)}${sourceCode.length > TraversalHandler.CHAIN_SNIPPET_LENGTH ? '...' : ''}\n\`\`\``
        : '_No source code_';

      response += `**${index + 1}.** ${node.labels[0] ?? 'Code'}
- **ID:** ${properties.id}
- **File:** ${properties.filePath}
${properties.name ? `- **Name:** ${properties.name}\n` : ''}${codeDisplay}

`;
    });

    if (nodes.length > TraversalHandler.MAX_NODES_PER_CHAIN) {
      response += `_... and ${nodes.length - TraversalHandler.MAX_NODES_PER_CHAIN} more nodes via this path_\n\n`;
    }

    return response;
  }

  private formatSummary(connections: Connection[], byDepth: Record<number, Connection[]>): string {
    const totalConnections = connections.length;
    const maxDepthFound = Object.keys(byDepth).length > 0 
      ? Math.max(...Object.keys(byDepth).map((d) => parseInt(d))) 
      : 0;
    const uniqueFiles = this.getUniqueFileCount(connections);

    return `\n---\n\n**Summary:** Found ${totalConnections} connected nodes across ${maxDepthFound} depth levels, spanning ${uniqueFiles} files.`;
  }

  private formatGraphStructure(graph: any): string {
    let response = `\n\n## ${EMOJIS.results} Graph Structure\n`;
    response += `- **Total Nodes:** ${graph.nodes?.length ?? 0}\n`;
    response += `- **Total Relationships:** ${graph.relationships?.length ?? 0}\n`;

    if (graph.relationships?.length > 0) {
      const relTypes = graph.relationships.reduce((acc: Record<string, number>, rel: any) => {
        acc[rel.type] = (acc[rel.type] ?? 0) + 1;
        return acc;
      }, {});
      
      response += `- **Relationship Types:** ${Object.entries(relTypes)
        .map(([type, count]) => `${type} (${count})`)
        .join(', ')}\n`;
    }

    return response;
  }

  private getUniqueFileCount(connections: Connection[]): number {
    return new Set(
      connections
        .map((c) => c.node.properties.filePath)
        .filter(Boolean)
    ).size;
  }
}
