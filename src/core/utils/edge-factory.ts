/**
 * Edge Factory
 * Shared utilities for creating framework edges with consistent ID generation and properties
 */

import crypto from 'crypto';

import { Neo4jEdgeProperties } from '../config/schema.js';

export interface FrameworkEdgeParams {
  semanticType: string;
  sourceNodeId: string;
  targetNodeId: string;
  projectId: string;
  context?: Record<string, any>;
  relationshipWeight?: number;
}

export interface FrameworkEdgeResult {
  id: string;
  properties: Neo4jEdgeProperties;
}

/**
 * Generate a deterministic edge ID based on semantic type, source, and target.
 * Uses SHA256 hash truncated to 16 characters for uniqueness.
 */
export const generateFrameworkEdgeId = (semanticType: string, sourceNodeId: string, targetNodeId: string): string => {
  const edgeIdentity = `${semanticType}::${sourceNodeId}::${targetNodeId}`;
  const edgeHash = crypto.createHash('sha256').update(edgeIdentity).digest('hex').substring(0, 16);
  return `${semanticType}:${edgeHash}`;
};

/**
 * Create framework edge ID and properties.
 * Returns common edge data that can be used to construct either ParsedEdge or Neo4jEdge.
 *
 * @param params - Edge parameters
 * @returns Edge ID and properties object
 */
export const createFrameworkEdgeData = (params: FrameworkEdgeParams): FrameworkEdgeResult => {
  const { semanticType, sourceNodeId, targetNodeId, projectId, context = {}, relationshipWeight = 0.5 } = params;

  const id = generateFrameworkEdgeId(semanticType, sourceNodeId, targetNodeId);

  const properties: Neo4jEdgeProperties = {
    coreType: semanticType as any,
    projectId,
    semanticType,
    source: 'pattern',
    confidence: 0.8,
    relationshipWeight,
    filePath: '',
    createdAt: new Date().toISOString(),
    context,
  };

  return { id, properties };
};
