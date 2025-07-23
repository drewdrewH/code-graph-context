/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs/promises';

import { EmbeddingsService } from '../../core/embeddings/embeddings.service.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';

export class GraphGeneratorHandler {
  private readonly neo4jService: Neo4jService;
  private readonly embeddingsService: EmbeddingsService;

  constructor(neo4jService: Neo4jService, embeddingsService: EmbeddingsService) {
    this.neo4jService = neo4jService;
    this.embeddingsService = embeddingsService;
  }
  async generateGraph(graphJsonPath: string, batchSize = 500, clearExisting = true): Promise<any> {
    console.log(`Generating graph from JSON file: ${graphJsonPath}`);
    try {
      const graphData = JSON.parse(await fs.readFile(graphJsonPath, 'utf-8'));
      const { nodes, edges, metadata } = graphData;
      console.log(`Generating graph with ${nodes.length} nodes and ${edges.length} edges`);
      // Clear existing data if requested
      if (clearExisting) {
        console.log('Clearing existing graph data...');
        await this.neo4jService.run('MATCH (n) DETACH DELETE n');
      }

      // Import nodes in batches using existing labels from parser
      console.log(`Importing ${nodes.length} nodes with existing labels...`);
      for (let i = 0; i < nodes.length; i += batchSize) {
        const batch = await Promise.all(
          nodes.slice(i, i + batchSize).map(async (node) => {
            const embedding = await this.embedNodeSourceCode(node);
            return {
              ...node,
              labels: embedding ? [...node.labels, 'Embedded'] : node.labels,
              properties: {
                ...this.flattenProperties(node.properties),
                embedding,
              },
            };
          }),
        );

        const result = await this.neo4jService.run(QUERIES.CREATE_NODE, { nodes: batch });
        console.log(`Created ${result[0].created} nodes in batch ${i + 1}-${Math.min(i + batchSize, nodes.length)}`);
      }

      console.log(`Importing ${edges.length} edges using APOC...`);
      for (let i = 0; i < edges.length; i += batchSize) {
        const batch = edges.slice(i, i + batchSize).map((edge) => ({
          ...edge,
          properties: this.flattenProperties(edge.properties),
        }));

        const result = await this.neo4jService.run(QUERIES.CREATE_RELATIONSHIP, { edges: batch });
        console.log(`Created ${result[0].created} edges in batch ${i + 1}-${Math.min(i + batchSize, edges.length)}`);
      }

      // Create vector indexes for all labels
      await this.neo4jService.run(QUERIES.CREATE_EMBEDDED_VECTOR_INDEX);
      return {
        nodesImported: nodes.length,
        edgesImported: edges.length,
        metadata,
      };
    } catch (error) {
      console.error('generateGraph error:', error);
      throw error;
    }

    // console.log('Creating indexes for common labels...');
    // const indexQueries = this.generateIndexQueries();
    //
    // for (const indexQuery of indexQueries) {
    //   try {
    //     await session.run(indexQuery);
    //   } catch (error) {
    //     console.log(`Index creation failed (might already exist): ${error.message}`);
    //   }
    // }
  }

  private async embedNodeSourceCode(node: any) {
    if (node.properties.sourceCode && !node.skipEmbedding) {
      const sourceCode = node.properties.sourceCode;
      const embedding = await this.embeddingsService.embedText(sourceCode);
      return embedding;
    }
  }

  private flattenProperties(properties: any): any {
    const flattened: any = {};

    console.log('Original properties:', JSON.stringify(properties, null, 2));

    for (const [key, value] of Object.entries(properties)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Convert nested objects to JSON strings
        flattened[key] = JSON.stringify(value);
        console.log(`Converted object ${key} to JSON string`);
      } else if (Array.isArray(value) && value.some((item) => typeof item === 'object')) {
        // Convert arrays with objects to JSON strings
        flattened[key] = JSON.stringify(value);
        console.log(`Converted array ${key} to JSON string`);
      } else {
        // Keep scalar values as-is
        flattened[key] = value;
        console.log(`Kept ${key} as scalar:`, value);
      }
    }

    console.log('Flattened properties:', JSON.stringify(flattened, null, 2));
    return flattened;
  }
  private jsonToCypher(json: { nodes: any[]; edges: any[] }) {}

  private generateIndexQueries() {}
}

