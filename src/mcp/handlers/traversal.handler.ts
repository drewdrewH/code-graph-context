import { MAX_TRAVERSAL_DEPTH } from '../../constants.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';

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

export class TraversalHandler {
  constructor(private neo4jService: Neo4jService) {}

  async traverseFromNode(nodeId: string, options: TraversalOptions = {}): Promise<TraversalResult> {
    const {
      maxDepth = MAX_TRAVERSAL_DEPTH,
      skip = 0,
      includeStartNodeDetails = true,
      title = `Node Traversal from: ${nodeId}`,
    } = options;

    try {
      // First, get the starting node details
      const startNodeResult = await this.neo4jService.run('MATCH (n) WHERE n.id = $nodeId RETURN n', { nodeId });

      if (startNodeResult.length === 0) {
        return {
          content: [{ type: 'text', text: `❌ Node with ID "${nodeId}" not found.` }],
        };
      }

      const startNode = startNodeResult[0].n;

      // Perform the traversal
      const traversal = await this.neo4jService.run(
        QUERIES.EXPLORE_ALL_CONNECTIONS(Math.min(maxDepth, MAX_TRAVERSAL_DEPTH)),
        {
          nodeId,
          skip: parseInt(skip.toString()),
        },
      );

      if (traversal.length === 0) {
        return {
          content: [{ type: 'text', text: `No connections found for node "${nodeId}".` }],
        };
      }

      const result = traversal[0]?.result ?? {};
      const connections = result.connections ?? [];
      const graph = result.graph ?? { nodes: [], relationships: [] };

      // Group by depth and limit results
      const byDepth = connections.reduce(
        (acc, conn) => {
          const depth = conn.depth;
          acc[depth] ??= [];
          acc[depth].push(conn);
          return acc;
        },
        {} as Record<number, any[]>,
      );

      let response = `# 🔍 ${title}\n\n`;
      const temp = {
        startNode: {
          id: startNode.properties?.id,
          labels: startNode.labels,
          properties: startNode.properties,
          filePath: startNode.properties?.filePath,
          name: startNode.properties?.name,
          sourceCode: startNode.properties?.sourceCode,
        },
      };
      // Start node details (optional)
      if (includeStartNodeDetails) {
        response += `## 🎯 Starting Node
**Type:** ${startNode.labels?.[0] ?? 'Unknown'}
**ID:** ${startNode.properties?.id}
**File:** ${startNode.properties?.filePath ?? 'Unknown'}
${startNode.properties?.name ? `**Name:** ${startNode.properties.name}\n` : ''}
${
  startNode.properties?.sourceCode
    ? `\`\`\`typescript\n${startNode.properties.sourceCode.substring(0, 200)}${startNode.properties.sourceCode.length > 200 ? '...' : ''}\n\`\`\``
    : '_No source code available_'
}

`;
      }

      // Connections by depth
      Object.keys(byDepth)
        .sort((a, b) => parseInt(a) - parseInt(b))
        .forEach((depth) => {
          const depthConnections = byDepth[parseInt(depth)];
          response += `## 🔗 Depth ${depth} Connections (${depthConnections.length} found)\n\n`;

          // Group by relationship chain for better organization
          const byRelChain = depthConnections.reduce(
            (acc, conn) => {
              const chain = conn.relationshipChain?.map((rel) => rel.type).join(' → ') ?? 'Unknown';
              acc[chain] ??= [];
              acc[chain].push(conn);
              return acc;
            },
            {} as Record<string, any[]>,
          );

          Object.entries(byRelChain).forEach(([chain, nodes]: [string, any[]]) => {
            if (nodes.length > 0) {
              response += `### via \`${chain}\` (${nodes.length} nodes)\n\n`;

              nodes.slice(0, 8).forEach((conn, index) => {
                const node = conn.node;
                if (node?.properties) {
                  response += `**${index + 1}.** ${node.labels?.[0] ?? 'Code'}
- **ID:** ${node.properties.id}
- **File:** ${node.properties.filePath ?? 'Unknown'}
${node.properties.name ? `- **Name:** ${node.properties.name}\n` : ''}${
                    node.properties.sourceCode
                      ? `\`\`\`typescript\n${node.properties.sourceCode.substring(0, 120)}${node.properties.sourceCode.length > 120 ? '...' : ''}\n\`\`\``
                      : '_No source code_'
                  }

`;
                }
              });

              if (nodes.length > 8) {
                response += `_... and ${nodes.length - 8} more nodes via this path_\n\n`;
              }
            }
          });

        });

      // Summary stats
      const totalConnections = connections.length;
      const maxDepthFound =
        Object.keys(byDepth).length > 0 ? Math.max(...Object.keys(byDepth).map((d) => parseInt(d))) : 0;
      const uniqueFiles = new Set(connections.map((c) => c.node?.properties?.filePath).filter(Boolean)).size;

      response += `\n---\n\n**Summary:** Found ${totalConnections} connected nodes across ${maxDepthFound} depth levels, spanning ${uniqueFiles} files.`;

      // Add graph structure information
      response += `\n\n## 📊 Graph Structure\n`;
      response += `- **Total Nodes:** ${graph.nodes?.length ?? 0}\n`;
      response += `- **Total Relationships:** ${graph.relationships?.length ?? 0}\n`;

      if (graph.relationships?.length > 0) {
        const relTypes = graph.relationships.reduce((acc, rel) => {
          acc[rel.type] = (acc[rel.type] ?? 0) + 1;
          return acc;
        }, {});
        response += `- **Relationship Types:** ${Object.entries(relTypes)
          .map(([type, count]) => `${type} (${count})`)
          .join(', ')}\n`;
      }

      return {
        content: [{ type: 'text', text: response }],
        graph: {
          nodes: graph.nodes,
          relationships: graph.relationships,
          connections: connections,
        },
      };
    } catch (error) {
      console.error('Node traversal error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `❌ ERROR: ${error.message}`,
          },
        ],
      };
    }
  }
}
