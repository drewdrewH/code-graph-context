import neo4j, { Driver } from 'neo4j-driver';

import { MAX_TRAVERSAL_DEPTH } from '../../constants.js';
import { getTimeoutConfig } from '../../core/config/timeouts.js';
export class Neo4jService {
  private driver: Driver;

  constructor() {
    this.driver = this.createDriver();
  }

  private createDriver() {
    const uri = process.env.NEO4J_URI ?? 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER ?? 'neo4j';
    const password = process.env.NEO4J_PASSWORD ?? 'PASSWORD';
    const timeoutConfig = getTimeoutConfig();

    return neo4j.driver(uri, neo4j.auth.basic(user, password), {
      connectionTimeout: timeoutConfig.neo4j.connectionTimeoutMs,
      maxTransactionRetryTime: timeoutConfig.neo4j.queryTimeoutMs,
    });
  }

  public async run(query: string, params: Record<string, any> = {}) {
    const session = this.driver.session();
    const timeoutConfig = getTimeoutConfig();
    try {
      const result = await session.run(query, params, {
        timeout: timeoutConfig.neo4j.queryTimeoutMs,
      });
      return result.records.map((record) => record.toObject());
    } catch (error: any) {
      // Provide helpful error message for timeout
      if (error.code === 'Neo.TransientError.Transaction.Terminated') {
        throw new Error(
          `Neo4j query timed out after ${timeoutConfig.neo4j.queryTimeoutMs}ms. ` +
            'Consider simplifying the query or increasing NEO4J_QUERY_TIMEOUT_MS.',
        );
      }
      console.error('Error running query:', error);
      throw error;
    } finally {
      // Wrap session close in try-catch to avoid masking the original error
      try {
        await session.close();
      } catch (closeError) {
        // Log but don't re-throw to preserve original error
        console.warn('Error closing Neo4j session:', closeError);
      }
    }
  }

  public getDriver() {
    return this.driver;
  }

  public async getSchema() {
    const session = this.driver.session();
    const timeoutConfig = getTimeoutConfig();
    try {
      return await session.run(
        QUERIES.APOC_SCHEMA,
        {},
        {
          timeout: timeoutConfig.neo4j.queryTimeoutMs,
        },
      );
    } catch (error) {
      console.error('Error fetching schema:', error);
      throw error;
    } finally {
      // Wrap session close in try-catch to avoid masking the original error
      try {
        await session.close();
      } catch (closeError) {
        // Log but don't re-throw to preserve original error
        console.warn('Error closing Neo4j session:', closeError);
      }
    }
  }

  /**
   * Close the Neo4j driver connection.
   * Should be called when the service is no longer needed to release resources.
   */
  public async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
    }
  }
}

export const QUERIES = {
  APOC_SCHEMA: `
    CALL apoc.meta.schema() YIELD value
      RETURN value as schema
    `,

  // Project-scoped deletion - only deletes nodes for the specified project
  // Uses APOC batched deletion to avoid transaction memory limits on large projects
  CLEAR_PROJECT: `
    CALL apoc.periodic.iterate(
      'MATCH (n) WHERE n.projectId = $projectId RETURN n',
      'DETACH DELETE n',
      {batchSize: 1000, params: {projectId: $projectId}}
    )
    YIELD batches, total
    RETURN batches, total
  `,

  // Full database clear - use with caution, clears ALL projects
  // Uses APOC batched deletion to avoid transaction memory limits
  CLEAR_DATABASE: `
    CALL apoc.periodic.iterate(
      'MATCH (n) RETURN n',
      'DETACH DELETE n',
      {batchSize: 1000}
    )
    YIELD batches, total
    RETURN batches, total
  `,

  // Create indexes on projectId for efficient filtering across key node types
  CREATE_PROJECT_INDEX_EMBEDDED: 'CREATE INDEX project_embedded_idx IF NOT EXISTS FOR (n:Embedded) ON (n.projectId)',
  CREATE_PROJECT_INDEX_SOURCEFILE:
    'CREATE INDEX project_sourcefile_idx IF NOT EXISTS FOR (n:SourceFile) ON (n.projectId)',

  // Create composite indexes on projectId + id for efficient lookups
  CREATE_PROJECT_ID_INDEX_EMBEDDED:
    'CREATE INDEX project_id_embedded_idx IF NOT EXISTS FOR (n:Embedded) ON (n.projectId, n.id)',
  CREATE_PROJECT_ID_INDEX_SOURCEFILE:
    'CREATE INDEX project_id_sourcefile_idx IF NOT EXISTS FOR (n:SourceFile) ON (n.projectId, n.id)',

  CREATE_NODE: `
    UNWIND $nodes AS nodeData
    CALL apoc.create.node(nodeData.labels, nodeData.properties) YIELD node
    RETURN count(*) as created
  `,

  CREATE_RELATIONSHIP: `
    UNWIND $edges AS edgeData
    MATCH (start) WHERE start.id = edgeData.startNodeId AND start.projectId = $projectId
    MATCH (end) WHERE end.id = edgeData.endNodeId AND end.projectId = $projectId
    WITH start, end, edgeData
    CALL apoc.create.relationship(start, edgeData.type, edgeData.properties, end) YIELD rel
    RETURN count(*) as created
  `,

  CREATE_INDEX: (label: string, property: string) => `CREATE INDEX IF NOT EXISTS FOR (n:${label}) ON (n.${property})`,

  GET_STATS: `
    MATCH (n)
    WHERE n.projectId = $projectId
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

  // Vector search with configurable fetch multiplier for project filtering.
  // fetchMultiplier (default: 10) controls how many extra results to fetch before filtering by projectId.
  // minSimilarity (default: 0.3) filters out low-confidence matches for nonsense queries.
  // Higher values = more accurate results but slower; lower values = faster but may miss results.
  VECTOR_SEARCH: `
  CALL db.index.vector.queryNodes('embedded_nodes_idx', toInteger($limit * coalesce($fetchMultiplier, 10)), $embedding)
  YIELD node, score
  WHERE node.projectId = $projectId AND score >= coalesce($minSimilarity, 0.3)
  WITH node, score
  LIMIT toInteger($limit)
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
    WHERE sf.projectId = $projectId
    RETURN sf.filePath AS filePath,
           COALESCE(sf.mtime, 0) AS mtime,
           COALESCE(sf.size, 0) AS size,
           COALESCE(sf.contentHash, '') AS contentHash
  `,

  // Get cross-file edges before deletion (edges where one endpoint is outside the subgraph)
  // These will be recreated after import using deterministic IDs
  GET_CROSS_FILE_EDGES: `
    MATCH (sf:SourceFile)
    WHERE sf.filePath IN $filePaths AND sf.projectId = $projectId
    OPTIONAL MATCH (sf)-[*]->(child)
    WITH collect(DISTINCT sf) + collect(DISTINCT child) AS nodesToDelete
    UNWIND nodesToDelete AS n
    MATCH (n)-[r]-(other)
    WHERE NOT other IN nodesToDelete AND other.projectId = $projectId
    RETURN DISTINCT
      startNode(r).id AS startNodeId,
      endNode(r).id AS endNodeId,
      type(r) AS edgeType,
      properties(r) AS edgeProperties
  `,

  // Delete source file subgraphs (nodes and all their edges)
  DELETE_SOURCE_FILE_SUBGRAPHS: `
    MATCH (sf:SourceFile)
    WHERE sf.filePath IN $filePaths AND sf.projectId = $projectId
    OPTIONAL MATCH (sf)-[*]->(child)
    DETACH DELETE sf, child
  `,

  // Recreate cross-file edges after import (uses deterministic IDs)
  RECREATE_CROSS_FILE_EDGES: `
    UNWIND $edges AS edge
    MATCH (startNode {id: edge.startNodeId})
    WHERE startNode.projectId = $projectId
    MATCH (endNode {id: edge.endNodeId})
    WHERE endNode.projectId = $projectId
    CALL apoc.create.relationship(startNode, edge.edgeType, edge.edgeProperties, endNode) YIELD rel
    RETURN count(rel) AS recreatedCount
  `,

  // Note: Dangling edge cleanup is not needed because:
  // 1. DETACH DELETE removes all edges when deleting nodes
  // 2. Edges cannot exist without both endpoints in Neo4j
  // The previous query (WHERE startNode(r) IS NULL OR endNode(r) IS NULL) could never match anything

  // Get existing nodes (excluding files being reparsed) for edge target matching
  // Returns minimal info needed for edge detection: id, name, coreType, semanticType
  GET_EXISTING_NODES_FOR_EDGE_DETECTION: `
    MATCH (sf:SourceFile)-[*]->(n)
    WHERE NOT sf.filePath IN $excludeFilePaths AND sf.projectId = $projectId
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
    // For INCOMING, we reverse the match order: (connected)-[*]->(start) instead of (start)<-[*]-(connected)
    // This is because Neo4j variable-length patterns like <-[*1..N]- require ALL edges to point toward start,
    // but in multi-hop paths (A→B→C), intermediate edges (A→B) don't point toward C, causing 0 results.
    let relPattern = '';
    let isReversed = false;
    if (direction === 'OUTGOING') {
      relPattern = `-[*1..${safeMaxDepth}]->`;
    } else if (direction === 'INCOMING') {
      relPattern = `-[*1..${safeMaxDepth}]->`; // Same pattern as OUTGOING
      isReversed = true; // But we'll reverse start/connected in MATCH
    } else {
      relPattern = `-[*1..${safeMaxDepth}]-`;
    }

    // Build relationship type filter if specified
    // SECURITY: Validate relationship types to prevent Cypher injection
    // Only allow uppercase letters and underscores (valid Neo4j relationship type format)
    let relTypeFilter = '';
    if (relationshipTypes && relationshipTypes.length > 0) {
      const validRelTypePattern = /^[A-Z_]+$/;
      const validatedTypes = relationshipTypes.filter((t) => validRelTypePattern.test(t));
      if (validatedTypes.length !== relationshipTypes.length) {
        console.warn(
          'Some relationship types were filtered out due to invalid format. Valid format: uppercase letters and underscores only.',
        );
      }
      if (validatedTypes.length > 0) {
        const types = validatedTypes.map((t) => `'${t}'`).join(', ');
        relTypeFilter = `AND all(rel in relationships(path) WHERE type(rel) IN [${types}])`;
      }
    }

    // For INCOMING, reverse the match: (connected)-[*]->(start) finds nodes that can REACH start
    const matchPattern = isReversed ? `(connected)${relPattern}(start)` : `(start)${relPattern}(connected)`;

    return `
      MATCH (start) WHERE start.id = $nodeId AND start.projectId = $projectId

      CALL {
        WITH start
        MATCH path = ${matchPattern}
        WHERE connected <> start AND connected.projectId = $projectId
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
      MATCH (source) WHERE source.id = sourceId AND source.projectId = $projectId

      // Find immediate neighbors (exactly 1 hop)
      MATCH (source)${relPattern}(neighbor)

      // Filter: skip already visited nodes and ensure same project
      WHERE NOT neighbor.id IN $visitedNodeIds AND neighbor.projectId = $projectId

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
      LIMIT toInteger(${maxNodesPerDepth})
    `;
  },

  // ============================================
  // DYNAMIC SCHEMA DISCOVERY QUERIES
  // ============================================

  /**
   * Get all distinct node labels with counts and sample properties
   */
  DISCOVER_NODE_TYPES: `
    CALL db.labels() YIELD label
    CALL {
      WITH label
      MATCH (n) WHERE label IN labels(n) AND n.projectId = $projectId
      WITH n LIMIT 1
      RETURN keys(n) AS sampleProperties
    }
    CALL {
      WITH label
      MATCH (n) WHERE label IN labels(n) AND n.projectId = $projectId
      RETURN count(n) AS nodeCount
    }
    RETURN label, nodeCount, sampleProperties
    ORDER BY nodeCount DESC
  `,

  /**
   * Get all distinct relationship types with counts and which node types they connect
   */
  DISCOVER_RELATIONSHIP_TYPES: `
    CALL db.relationshipTypes() YIELD relationshipType
    CALL {
      WITH relationshipType
      MATCH (a)-[r]->(b) WHERE type(r) = relationshipType AND a.projectId = $projectId AND b.projectId = $projectId
      WITH labels(a)[0] AS fromLabel, labels(b)[0] AS toLabel
      RETURN fromLabel, toLabel
      LIMIT 10
    }
    CALL {
      WITH relationshipType
      MATCH (a)-[r]->(b) WHERE type(r) = relationshipType AND a.projectId = $projectId
      RETURN count(r) AS relCount
    }
    RETURN relationshipType, relCount, collect(DISTINCT {from: fromLabel, to: toLabel}) AS connections
    ORDER BY relCount DESC
  `,

  /**
   * Get sample nodes of each semantic type for context
   */
  DISCOVER_SEMANTIC_TYPES: `
    MATCH (n)
    WHERE n.semanticType IS NOT NULL AND n.projectId = $projectId
    WITH n.semanticType AS semanticType, count(*) AS count
    ORDER BY count DESC
    RETURN semanticType, count
  `,

  /**
   * Get example query patterns based on actual graph structure
   */
  DISCOVER_COMMON_PATTERNS: `
    MATCH (a)-[r]->(b)
    WHERE a.projectId = $projectId AND b.projectId = $projectId
    WITH labels(a)[0] AS fromType, type(r) AS relType, labels(b)[0] AS toType, count(*) AS count
    WHERE count > 5
    RETURN fromType, relType, toType, count
    ORDER BY count DESC
    LIMIT 20
  `,

  // ============================================
  // IMPACT ANALYSIS QUERIES
  // Reuses cross-file edge pattern to find dependents
  // ============================================

  /**
   * Get node details by ID
   */
  GET_NODE_BY_ID: `
    MATCH (n) WHERE n.id = $nodeId AND n.projectId = $projectId
    RETURN n.id AS id,
           n.name AS name,
           labels(n) AS labels,
           n.semanticType AS semanticType,
           n.coreType AS coreType,
           n.filePath AS filePath
  `,

  /**
   * Get impact of changing a node - finds all external nodes that depend on it
   * Based on GET_CROSS_FILE_EDGES pattern but for a single node
   */
  GET_NODE_IMPACT: `
    MATCH (target) WHERE target.id = $nodeId AND target.projectId = $projectId
    MATCH (dependent)-[r]->(target)
    WHERE dependent.id <> target.id AND dependent.projectId = $projectId
    RETURN DISTINCT
      dependent.id AS nodeId,
      dependent.name AS name,
      labels(dependent) AS labels,
      dependent.semanticType AS semanticType,
      dependent.coreType AS coreType,
      dependent.filePath AS filePath,
      type(r) AS relationshipType,
      coalesce(r.relationshipWeight, 0.5) AS weight
  `,

  /**
   * Get impact of changing a file - finds all external nodes that depend on nodes in this file
   * Directly reuses GET_CROSS_FILE_EDGES pattern
   */
  GET_FILE_IMPACT: `
    MATCH (sf:SourceFile)
    WHERE sf.projectId = $projectId
      AND (sf.filePath = $filePath OR sf.filePath ENDS WITH '/' + $filePath)
    MATCH (sf)-[:CONTAINS]->(entity)
    WHERE entity:Class OR entity:Function OR entity:Interface
    WITH collect(DISTINCT entity) AS entitiesInFile, sf.filePath AS sourceFilePath
    UNWIND entitiesInFile AS n
    MATCH (dependent)-[r]->(n)
    WHERE NOT dependent IN entitiesInFile
      AND dependent.projectId = $projectId
      AND dependent.filePath <> sourceFilePath
    RETURN DISTINCT
      dependent.id AS nodeId,
      dependent.name AS name,
      labels(dependent) AS labels,
      dependent.semanticType AS semanticType,
      dependent.coreType AS coreType,
      dependent.filePath AS filePath,
      type(r) AS relationshipType,
      coalesce(r.relationshipWeight, 0.5) AS weight,
      n.id AS targetNodeId,
      n.name AS targetNodeName
  `,

  /**
   * Get transitive dependents - nodes that depend on dependents (for deeper impact)
   */
  GET_TRANSITIVE_DEPENDENTS: (maxDepth: number = 4) => `
    MATCH (target) WHERE target.id = $nodeId AND target.projectId = $projectId
    MATCH path = (dependent)-[*2..${maxDepth}]->(target)
    WHERE dependent.projectId = $projectId AND all(n IN nodes(path) WHERE n.projectId = $projectId)
    WITH dependent,
         length(path) AS depth,
         [r IN relationships(path) | type(r)] AS relationshipPath
    RETURN DISTINCT
      dependent.id AS nodeId,
      dependent.name AS name,
      labels(dependent) AS labels,
      dependent.semanticType AS semanticType,
      dependent.coreType AS coreType,
      dependent.filePath AS filePath,
      depth,
      relationshipPath
    ORDER BY depth ASC
  `,
};
