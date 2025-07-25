import { CodeGraphEdge } from '../../../types/';
/**
 * Neo4j Cypher Generation
 */
export class CypherGenerator {
  // Create relationship with properties
  static createRelationship(edge: CodeGraphEdge): string {
    const props = JSON.stringify(edge.properties);

    if (edge.direction === 'OUTGOING') {
      return `
        MATCH (source {id: '${edge.sourceNodeId}'}), (target {id: '${edge.targetNodeId}'})
        CREATE (source)-[:${edge.relationshipType} ${props}]->(target)
      `;
    } else if (edge.direction === 'INCOMING') {
      return `
        MATCH (source {id: '${edge.sourceNodeId}'}), (target {id: '${edge.targetNodeId}'})
        CREATE (source)<-[:${edge.relationshipType} ${props}]-(target)
      `;
    } else {
      // BIDIRECTIONAL
      return `
        MATCH (source {id: '${edge.sourceNodeId}'}), (target {id: '${edge.targetNodeId}'})
        CREATE (source)-[:${edge.relationshipType} ${props}]-(target)
      `;
    }
  }

  // Query with direction awareness
  static queryWithDirection(relationshipType: string, direction: 'OUTGOING' | 'INCOMING' | 'BOTH' = 'BOTH'): string {
    switch (direction) {
      case 'OUTGOING':
        return `MATCH (source)-[:${relationshipType}]->(target)`;
      case 'INCOMING':
        return `MATCH (source)<-[:${relationshipType}]-(target)`;
      case 'BOTH':
      default:
        return `MATCH (source)-[:${relationshipType}]-(target)`;
    }
  }
}
