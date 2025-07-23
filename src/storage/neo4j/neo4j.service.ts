import neo4j from 'neo4j-driver';
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
}

export const QUERIES = {
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
  RETURN node, score
  ORDER BY score DESC
`,

  // Check if index exists
  CHECK_VECTOR_INDEX: `
    SHOW INDEXES YIELD name, type 
    WHERE name = 'node_embedding_idx' AND type = 'VECTOR'
    RETURN count(*) > 0 as exists
  `,
  EXPLORE_ALL_CONNECTIONS: (maxDepth: number = 3) => {
    const depthClauses: string[] = [];
    for (let i = 1; i <= Math.min(maxDepth, 10); i++) {
      if (i === 1) {
        depthClauses.push(`
          WITH start
          MATCH (start)-[*${i}]-(d${i}) 
          WHERE d${i} <> start
          RETURN d${i} as connected, ${i} as depth
        `);
      } else {
        depthClauses.push(`
          WITH start
          MATCH (start)-[*${i}]-(d${i}) 
          WHERE d${i} <> start AND NOT (start)-[*1..${i - 1}]-(d${i})
          RETURN d${i} as connected, ${i} as depth
        `);
      }
    }

    return `
      MATCH (start) WHERE start.id = $nodeId
      CALL {
        ${depthClauses.join('\nUNION ALL\n')}
      }
      RETURN start,
             collect(DISTINCT {
               node: connected,
               depth: depth
             }) as connections
      LIMIT 50
    `;
  },
};
