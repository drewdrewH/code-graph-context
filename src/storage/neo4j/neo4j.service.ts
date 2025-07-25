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
    properties: apoc.map.removeKeys(properties(node), ['embedding'])
  } as node, score
  ORDER BY score DESC
`,

  // Check if index exists
  CHECK_VECTOR_INDEX: `
    SHOW INDEXES YIELD name, type 
    WHERE name = 'node_embedding_idx' AND type = 'VECTOR'
    RETURN count(*) > 0 as exists
  `,
  EXPLORE_ALL_CONNECTIONS: (maxDepth: number = MAX_TRAVERSAL_DEPTH) => {
    const safeMaxDepth = Math.min(Math.max(maxDepth, 1), MAX_TRAVERSAL_DEPTH); // Ensure between 1-MAX_TRAVERSAL_DEPTH

    return `
      MATCH (start) WHERE start.id = $nodeId

      CALL {
        WITH start
        MATCH path = (start)-[*1..${safeMaxDepth}]-(connected)
        WHERE connected <> start
        WITH path, connected, length(path) as depth
        
        RETURN {
          id: connected.id,
          labels: labels(connected),
          properties: apoc.map.removeKeys(properties(connected), ['embedding'])
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
          properties: apoc.map.removeKeys(properties(start), ['embedding'])
        },
        connections: connections,
        totalConnections: size(allConnections),
        graph: {
          nodes: [conn in connections | conn.node] + [{
            id: start.id,
            labels: labels(start),
            properties: apoc.map.removeKeys(properties(start), ['embedding'])
          }],
          relationships: reduce(rels = [], conn in connections | rels + conn.relationshipChain)
        }
      } as result
    `;
  },
};
