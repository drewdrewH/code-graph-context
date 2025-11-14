/**
 * Graph Generator Handler
 * Handles importing parsed graph data into Neo4j with embeddings
 */

import fs from 'fs/promises';

import { Neo4jNode, Neo4jEdge } from '../../core/config/schema.js';
import { EmbeddingsService } from '../../core/embeddings/embeddings.service.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';
import { DEFAULTS } from '../constants.js';
import { debugLog } from '../utils.js';

interface GraphData {
  nodes: Neo4jNode[];
  edges: Neo4jEdge[];
  metadata: any;
}

interface ImportResult {
  nodesImported: number;
  edgesImported: number;
  metadata: any;
}

export class GraphGeneratorHandler {
  private static readonly EMBEDDED_LABEL = 'Embedded';

  constructor(
    private readonly neo4jService: Neo4jService,
    private readonly embeddingsService: EmbeddingsService,
  ) {}
  async generateGraph(
    graphJsonPath: string,
    batchSize = DEFAULTS.batchSize,
    clearExisting = true,
  ): Promise<ImportResult> {
    console.log(`Generating graph from JSON file: ${graphJsonPath}`);
    await debugLog('Starting graph generation', { graphJsonPath, batchSize, clearExisting });

    try {
      const graphData = await this.loadGraphData(graphJsonPath);
      const { nodes, edges, metadata } = graphData;

      console.log(`Generating graph with ${nodes.length} nodes and ${edges.length} edges`);
      await debugLog('Graph data loaded', { nodeCount: nodes.length, edgeCount: edges.length });

      if (clearExisting) {
        await this.clearExistingData();
      }

      await this.importNodes(nodes, batchSize);
      await this.importEdges(edges, batchSize);
      await this.createVectorIndexes();

      const result: ImportResult = {
        nodesImported: nodes.length,
        edgesImported: edges.length,
        metadata,
      };

      await debugLog('Graph generation completed', result);
      return result;
    } catch (error) {
      console.error('generateGraph error:', error);
      await debugLog('Graph generation error', error);
      throw error;
    }
  }

  private async loadGraphData(graphJsonPath: string): Promise<GraphData> {
    const fileContent = await fs.readFile(graphJsonPath, 'utf-8');
    return JSON.parse(fileContent);
  }

  private async clearExistingData(): Promise<void> {
    console.log('Clearing existing graph data...');
    await this.neo4jService.run(QUERIES.CLEAR_DATABASE);
    await debugLog('Existing graph data cleared');
  }

  private async importNodes(nodes: Neo4jNode[], batchSize: number): Promise<void> {
    console.log(`Importing ${nodes.length} nodes with embeddings...`);

    for (let i = 0; i < nodes.length; i += batchSize) {
      const batch = await this.processNodeBatch(nodes.slice(i, i + batchSize));
      const result = await this.neo4jService.run(QUERIES.CREATE_NODE, { nodes: batch });

      const batchEnd = Math.min(i + batchSize, nodes.length);
      console.log(`Created ${result[0].created} nodes in batch ${i + 1}-${batchEnd}`);

      await debugLog('Node batch imported', {
        batchStart: i + 1,
        batchEnd,
        created: result[0].created,
      });
    }
  }

  private async processNodeBatch(nodes: any[]): Promise<any[]> {
    return Promise.all(
      nodes.map(async (node) => {
        const embedding = await this.embedNodeSourceCode(node);
        return {
          ...node,
          labels: embedding ? [...node.labels, GraphGeneratorHandler.EMBEDDED_LABEL] : node.labels,
          properties: {
            ...this.flattenProperties(node.properties),
            embedding,
          },
        };
      }),
    );
  }

  private async importEdges(edges: any[], batchSize: number): Promise<void> {
    console.log(`Importing ${edges.length} edges using APOC...`);

    for (let i = 0; i < edges.length; i += batchSize) {
      const batch = edges.slice(i, i + batchSize).map((edge) => ({
        ...edge,
        properties: this.flattenProperties(edge.properties),
      }));

      const result = await this.neo4jService.run(QUERIES.CREATE_RELATIONSHIP, { edges: batch });

      const batchEnd = Math.min(i + batchSize, edges.length);
      console.log(`Created ${result[0].created} edges in batch ${i + 1}-${batchEnd}`);

      await debugLog('Edge batch imported', {
        batchStart: i + 1,
        batchEnd,
        created: result[0].created,
      });
    }
  }

  private async createVectorIndexes(): Promise<void> {
    console.log('Creating vector indexes...');
    await this.neo4jService.run(QUERIES.CREATE_EMBEDDED_VECTOR_INDEX);
    await debugLog('Vector indexes created');
  }

  private async embedNodeSourceCode(node: any): Promise<number[] | null> {
    if (!node.properties?.sourceCode || node.skipEmbedding) {
      return null;
    }

    try {
      const sourceCode = node.properties.sourceCode;
      const embedding = await this.embeddingsService.embedText(sourceCode);
      await debugLog('Node embedded', { nodeId: node.id, codeLength: sourceCode.length });
      return embedding;
    } catch (error) {
      console.warn(`Failed to embed node ${node.id}:`, error);
      await debugLog('Embedding failed', { nodeId: node.id, error });
      return null;
    }
  }

  private flattenProperties(properties: any): any {
    const flattened: any = {};

    for (const [key, value] of Object.entries(properties)) {
      if (this.isComplexObject(value)) {
        // Convert nested objects to JSON strings for Neo4j compatibility
        flattened[key] = JSON.stringify(value);
      } else if (this.isComplexArray(value)) {
        // Convert arrays with objects to JSON strings
        flattened[key] = JSON.stringify(value);
      } else {
        // Keep scalar values as-is
        flattened[key] = value;
      }
    }

    return flattened;
  }

  private isComplexObject(value: any): boolean {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  private isComplexArray(value: any): boolean {
    return Array.isArray(value) && value.some((item) => typeof item === 'object');
  }
}
