import neo4j from 'neo4j-driver';

import { MAX_TRAVERSAL_DEPTH } from '../../constants.js';
export class Neo4jService {
  private driver: any;

  constructor() {
    this.driver = this.createDriver();
  }

  private createDriver() {
    const uri = process.env.NEO4J_URI ?? 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER ?? 'neo4j';
    const password = process.env.NEO4J_PASSWORD ?? 'PASSWORD';

    return neo4j.driver(uri, neo4j.auth.basic(user, password));
  }

  public async run(query: string, params: Record<string, any> = {}) {
    const session = this.driver.session();
    try {
      const result = await session.run(query, params);
      return result.records.map((record) => record.toObject());
    } catch (error) {
      console.error('Error running query:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  public getDriver() {
    return this.driver;
  }

  public async getSchema() {
    const session = this.driver.session();
    try {
      return await session.run(QUERIES.APOC_SCHEMA);
    } catch (error) {
      console.error('Error fetching schema:', error);
      throw error;
    } finally {
      await session.close();
    }
  }
}

export const QUERIES = {
  APOC_SCHEMA: `
    CALL apoc.meta.schema() YIELD value
      RETURN value as schema
    `,
  CLEAR_DATABASE: 'MATCH (n) DETACH DELETE n',

  CREATE_NODE: `
    UNWIND $nodes AS nodeData
    CALL apoc.create.node(nodeData.labels, nodeData.properties) YIELD node
    RETURN count(*) as created
  `,

  CREATE_RELATIONSHIP: `
    UNWIND $edges AS edgeData
    MATCH (start) WHERE start.id = edgeData.startNodeId
    MATCH (end) WHERE end.id = edgeData.endNodeId
    WITH start, end, edgeData
    CALL apoc.create.relationship(start, edgeData.type, edgeData.properties, end) YIELD rel
    RETURN count(*) as created
  `,

  CREATE_INDEX: (label: string, property: string) => `CREATE INDEX IF NOT EXISTS FOR (n:${label}) ON (n.${property})`,

  GET_STATS: `
    MATCH (n) 
    RETURN labels(n)[0] as nodeType, count(*) as count 
    ORDER BY count DESC
  `,

  CREATE_EMBEDDED_VECTOR_INDEX: `
  CREATE VECTOR INDEX embedded_nodes_idx IF NOT EXISTS
  FOR (n:Embedded) ON (n.embedding) 
  OPTIONS {indexConfig: {
    \`vector.dimensions\`: 3072,
    \`vector.similarity_function\`: 'cosine'
  }}
`,

  VECTOR_SEARCH: `
  CALL db.index.vector.queryNodes('embedded_nodes_idx', $limit, $embedding)
  YIELD node, score
  RETURN {
    id: node.id,
    labels: labels(node),
    properties: apoc.map.removeKeys(properties(node), ['embedding', 'contentHash', 'mtime', 'size'])
  } as node, score
  ORDER BY score DESC
`,

  // Check if index exists
  CHECK_VECTOR_INDEX: `
    SHOW INDEXES YIELD name, type
    WHERE name = 'node_embedding_idx' AND type = 'VECTOR'
    RETURN count(*) > 0 as exists
  `,

  GET_SOURCE_FILE_TRACKING_INFO: `
    MATCH (sf:SourceFile)
    RETURN sf.filePath AS filePath, sf.mtime AS mtime, sf.size AS size, sf.contentHash AS contentHash
  `,

  // Get cross-file edges before deletion (edges where one endpoint is outside the subgraph)
  // These will be recreated after import using deterministic IDs
  GET_CROSS_FILE_EDGES: `
    MATCH (sf:SourceFile)
    WHERE sf.filePath IN $filePaths
    OPTIONAL MATCH (sf)-[*]->(child)
    WITH collect(DISTINCT sf) + collect(DISTINCT child) AS nodesToDelete
    UNWIND nodesToDelete AS n
    MATCH (n)-[r]-(other)
    WHERE NOT other IN nodesToDelete
    RETURN DISTINCT
      startNode(r).id AS startNodeId,
      endNode(r).id AS endNodeId,
      type(r) AS edgeType,
      properties(r) AS edgeProperties
  `,

  // Delete source file subgraphs (nodes and all their edges)
  DELETE_SOURCE_FILE_SUBGRAPHS: `
    MATCH (sf:SourceFile)
    WHERE sf.filePath IN $filePaths
    OPTIONAL MATCH (sf)-[*]->(child)
    DETACH DELETE sf, child
  `,

  // Recreate cross-file edges after import (uses deterministic IDs)
  RECREATE_CROSS_FILE_EDGES: `
    UNWIND $edges AS edge
    MATCH (startNode {id: edge.startNodeId})
    MATCH (endNode {id: edge.endNodeId})
    CALL apoc.create.relationship(startNode, edge.edgeType, edge.edgeProperties, endNode) YIELD rel
    RETURN count(rel) AS recreatedCount
  `,

  // Clean up dangling edges (edges pointing to non-existent nodes)
  // Run after incremental parse to remove edges to renamed/deleted nodes
  CLEANUP_DANGLING_EDGES: `
    MATCH ()-[r]->()
    WHERE startNode(r) IS NULL OR endNode(r) IS NULL
    DELETE r
    RETURN count(r) AS deletedCount
  `,

  // Get existing nodes (excluding files being reparsed) for edge target matching
  // Returns minimal info needed for edge detection: id, name, coreType, semanticType
  GET_EXISTING_NODES_FOR_EDGE_DETECTION: `
    MATCH (sf:SourceFile)-[*]->(n)
    WHERE NOT sf.filePath IN $excludeFilePaths
    RETURN n.id AS id,
           n.name AS name,
           n.coreType AS coreType,
           n.semanticType AS semanticType,
           labels(n) AS labels,
           sf.filePath AS filePath
  `,

  EXPLORE_ALL_CONNECTIONS: (
    maxDepth: number = MAX_TRAVERSAL_DEPTH,
    direction: 'OUTGOING' | 'INCOMING' | 'BOTH' = 'BOTH',
    relationshipTypes?: string[],
  ) => {
    const safeMaxDepth = Math.min(Math.max(maxDepth, 1), MAX_TRAVERSAL_DEPTH);

    // Build relationship pattern based on direction
    let relPattern = '';
    if (direction === 'OUTGOING') {
      relPattern = `-[*1..${safeMaxDepth}]->`;
    } else if (direction === 'INCOMING') {
      relPattern = `<-[*1..${safeMaxDepth}]-`;
    } else {
      relPattern = `-[*1..${safeMaxDepth}]-`;
    }

    // Build relationship type filter if specified
    let relTypeFilter = '';
    if (relationshipTypes && relationshipTypes.length > 0) {
      const types = relationshipTypes.map((t) => `'${t}'`).join(', ');
      relTypeFilter = `AND all(rel in relationships(path) WHERE type(rel) IN [${types}])`;
    }

    return `
      MATCH (start) WHERE start.id = $nodeId

      CALL {
        WITH start
        MATCH path = (start)${relPattern}(connected)
        WHERE connected <> start
        ${relTypeFilter}
        WITH path, connected, length(path) as depth

        RETURN {
          id: connected.id,
          labels: labels(connected),
          properties: apoc.map.removeKeys(properties(connected), ['embedding', 'contentHash', 'mtime', 'size'])
        } as node,
        depth,
        [rel in relationships(path) | {
          type: type(rel),
          start: startNode(rel).id,
          end: endNode(rel).id,
          properties: properties(rel)
        }] as relationshipChain

      }

      WITH start, collect({
        node: node,
        depth: depth,
        relationshipChain: relationshipChain
      }) as allConnections

      WITH start, allConnections,
           allConnections[$skip..] as connections

      RETURN {
        startNode: {
          id: start.id,
          labels: labels(start),
          properties: apoc.map.removeKeys(properties(start), ['embedding', 'contentHash', 'mtime', 'size'])
        },
        connections: connections,
        totalConnections: size(allConnections),
        graph: {
          nodes: [conn in connections | conn.node] + [{
            id: start.id,
            labels: labels(start),
            properties: apoc.map.removeKeys(properties(start), ['embedding', 'contentHash', 'mtime', 'size'])
          }],
          relationships: reduce(rels = [], conn in connections | rels + conn.relationshipChain)
        }
      } as result
    `;
  },

  /**
   * DEPTH-BY-DEPTH WEIGHTED TRAVERSAL
   *
   * This query is called once per depth level, allowing you to score and prune
   * at each level before deciding which nodes to explore further.
   *
   * Parameters:
   *   $sourceNodeIds: string[] - Node IDs to explore FROM (starts with just start node)
   *   $visitedNodeIds: string[] - Node IDs already visited (to avoid cycles)
   *   $queryEmbedding: number[] - The original query embedding for similarity scoring
   *   $currentDepth: number - Which depth level we're at (1-indexed)
   *   $depthDecay: number - Decay factor per depth (e.g., 0.85 means 15% penalty per level)
   *   $maxNodesPerDepth: number - Maximum nodes to return at this depth
   *   $direction: 'OUTGOING' | 'INCOMING' | 'BOTH'
   *
   * How it works:
   *
   * 1. UNWIND $sourceNodeIds - For each node we're exploring FROM
   * 2. MATCH neighbors - Find all immediate neighbors (1 hop only)
   * 3. Filter out visited nodes - Avoid cycles
   * 4. Score each neighbor using:
   *    - edgeWeight: The relationshipWeight we added to edges (how important is this relationship type?)
   *    - nodeSimilarity: Cosine similarity between neighbor's embedding and query embedding
   *    - depthPenalty: Exponential decay based on current depth
   * 5. Combine: score = edgeWeight * nodeSimilarity * depthPenalty
   * 6. ORDER BY score DESC, LIMIT to top N
   * 7. Return scored neighbors - caller decides which to explore at next depth
   *
   * Example flow:
   *   Depth 1: sourceNodeIds=[startNode], returns top 5 neighbors with scores
   *   Depth 2: sourceNodeIds=[top 3 from depth 1], returns top 5 neighbors of those
   *   Depth 3: sourceNodeIds=[top 3 from depth 2], returns top 5 neighbors of those
   *   ...until maxDepth reached or no more neighbors
   */
  EXPLORE_DEPTH_LEVEL: (direction: 'OUTGOING' | 'INCOMING' | 'BOTH' = 'BOTH', maxNodesPerDepth: number = 5) => {
    // Build relationship pattern based on direction
    let relPattern = '';
    if (direction === 'OUTGOING') {
      relPattern = '-[rel]->';
    } else if (direction === 'INCOMING') {
      relPattern = '<-[rel]-';
    } else {
      relPattern = '-[rel]-';
    }

    return `
      // Unwind the source nodes we're exploring from
      UNWIND $sourceNodeIds AS sourceId
      MATCH (source) WHERE source.id = sourceId

      // Find immediate neighbors (exactly 1 hop)
      MATCH (source)${relPattern}(neighbor)

      // Filter: skip already visited nodes to avoid cycles
      WHERE NOT neighbor.id IN $visitedNodeIds

      // Calculate the three scoring components
      WITH source, neighbor, rel,

           // 1. Edge weight: how important is this relationship type?
           //    Falls back to 0.5 if not set
           COALESCE(rel.relationshipWeight, 0.5) AS edgeWeight,

           // 2. Node similarity: how relevant is this node to the query?
           //    Uses cosine similarity if neighbor has an embedding
           //    Falls back to 0.5 if no embedding (structural nodes like decorators)
           CASE
             WHEN neighbor.embedding IS NOT NULL AND $queryEmbedding IS NOT NULL
             THEN vector.similarity.cosine(neighbor.embedding, $queryEmbedding)
             ELSE 0.5
           END AS nodeSimilarity,

           // 3. Depth penalty: exponential decay
           //    depth 1: decay^0 = 1.0 (no penalty)
           //    depth 2: decay^1 = 0.85 (if decay=0.85)
           //    depth 3: decay^2 = 0.72
           //    This ensures closer nodes are preferred
           ($depthDecay ^ ($currentDepth - 1)) AS depthPenalty

      // Combine into final score
      WITH source, neighbor, rel, edgeWeight, nodeSimilarity, depthPenalty,
           (edgeWeight * nodeSimilarity * depthPenalty) AS combinedScore

      // Return all neighbor data with scores
      RETURN {
        node: {
          id: neighbor.id,
          labels: labels(neighbor),
          properties: apoc.map.removeKeys(properties(neighbor), ['embedding', 'contentHash', 'mtime', 'size'])
        },
        relationship: {
          type: type(rel),
          startNodeId: startNode(rel).id,
          endNodeId: endNode(rel).id,
          properties: properties(rel)
        },
        sourceNodeId: source.id,
        scoring: {
          edgeWeight: edgeWeight,
          nodeSimilarity: nodeSimilarity,
          depthPenalty: depthPenalty,
          combinedScore: combinedScore
        }
      } AS result

      // Sort by score and limit to top N per depth
      ORDER BY combinedScore DESC
      LIMIT ${maxNodesPerDepth}
    `;
  },
};
