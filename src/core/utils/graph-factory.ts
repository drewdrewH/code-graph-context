/**
 * Graph Factory
 * Shared utilities for creating/converting graph nodes and edges
 */

import crypto from 'crypto';

import {
  Neo4jEdgeProperties,
  Neo4jNode,
  Neo4jEdge,
  ParsedNode,
  ParsedEdge,
  CoreEdgeType,
  CORE_TYPESCRIPT_SCHEMA,
} from '../config/schema.js';

// ============================================
// Node ID Generation
// ============================================

/**
 * Generate a deterministic node ID based on stable properties.
 * This ensures the same node gets the same ID across reparses.
 *
 * Identity is based on: projectId + coreType + filePath + name (+ parentId for nested nodes)
 * This is stable because when it matters (one side of edge not reparsed),
 * names are guaranteed unchanged (or imports would break, triggering reparse).
 *
 * Including projectId ensures nodes from different projects have unique IDs
 * even if they have identical file paths and names.
 */
export const generateDeterministicId = (
  projectId: string,
  coreType: string,
  filePath: string,
  name: string,
  parentId?: string,
): string => {
  const parts = parentId ? [projectId, coreType, filePath, parentId, name] : [projectId, coreType, filePath, name];
  const identity = parts.join('::');
  const hash = crypto.createHash('sha256').update(identity).digest('hex').substring(0, 16);

  return `${projectId}:${coreType}:${hash}`;
};

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

// ============================================
// Core Edge Factory
// ============================================

export interface CoreEdgeParams {
  edgeType: CoreEdgeType;
  sourceNodeId: string;
  targetNodeId: string;
  projectId: string;
  filePath?: string;
}

export interface CallsEdgeParams {
  sourceNodeId: string;
  targetNodeId: string;
  projectId: string;
  callContext?: {
    lineNumber?: number;
    isAsync?: boolean;
    argumentCount?: number;
    receiverType?: string;
  };
}

/**
 * Generate a deterministic edge ID for core edges.
 */
export const generateCoreEdgeId = (edgeType: string, sourceNodeId: string, targetNodeId: string): string => {
  const edgeIdentity = `${edgeType}::${sourceNodeId}::${targetNodeId}`;
  const edgeHash = crypto.createHash('sha256').update(edgeIdentity).digest('hex').substring(0, 16);
  return `${edgeType}:${edgeHash}`;
};

/**
 * Create a core edge (CONTAINS, IMPORTS, EXTENDS, IMPLEMENTS, etc.)
 */
export const createCoreEdge = (params: CoreEdgeParams): Neo4jEdge => {
  const { edgeType, sourceNodeId, targetNodeId, projectId, filePath = '' } = params;

  const coreEdgeSchema = CORE_TYPESCRIPT_SCHEMA.edgeTypes[edgeType];
  const relationshipWeight = coreEdgeSchema?.relationshipWeight ?? 0.5;

  const id = generateCoreEdgeId(edgeType, sourceNodeId, targetNodeId);

  return {
    id,
    type: edgeType,
    startNodeId: sourceNodeId,
    endNodeId: targetNodeId,
    properties: {
      coreType: edgeType,
      projectId,
      source: 'ast',
      confidence: 1.0,
      relationshipWeight,
      filePath,
      createdAt: new Date().toISOString(),
    },
  };
};

/**
 * Create a CALLS edge with call-specific context.
 */
export const createCallsEdge = (params: CallsEdgeParams): Neo4jEdge => {
  const { sourceNodeId, targetNodeId, projectId, callContext } = params;

  const coreEdgeSchema = CORE_TYPESCRIPT_SCHEMA.edgeTypes[CoreEdgeType.CALLS];
  const relationshipWeight = coreEdgeSchema?.relationshipWeight ?? 0.85;

  // Confidence: higher if we resolved the receiver type
  const confidence = callContext?.receiverType ? 0.9 : 0.7;

  // Generate deterministic edge ID based on type + source + target + line
  const lineNum = callContext?.lineNumber ?? 0;
  const edgeIdentity = `CALLS::${sourceNodeId}::${targetNodeId}::${lineNum}`;
  const edgeHash = crypto.createHash('sha256').update(edgeIdentity).digest('hex').substring(0, 16);
  const id = `CALLS:${edgeHash}`;

  return {
    id,
    type: 'CALLS',
    startNodeId: sourceNodeId,
    endNodeId: targetNodeId,
    properties: {
      coreType: CoreEdgeType.CALLS,
      projectId,
      source: 'ast',
      confidence,
      relationshipWeight,
      filePath: '',
      createdAt: new Date().toISOString(),
      lineNumber: callContext?.lineNumber,
      context: callContext
        ? {
            isAsync: callContext.isAsync,
            argumentCount: callContext.argumentCount,
            receiverType: callContext.receiverType,
          }
        : undefined,
    },
  };
};

// ============================================
// Node/Edge Conversion Functions
// Convert internal parsed types to Neo4j types
// ============================================

/**
 * Convert a ParsedNode to Neo4jNode format for storage/export.
 */
export const toNeo4jNode = (parsedNode: ParsedNode): Neo4jNode => ({
  id: parsedNode.id,
  labels: parsedNode.labels,
  properties: parsedNode.properties,
  skipEmbedding: parsedNode.skipEmbedding ?? false,
});

/**
 * Convert a ParsedEdge to Neo4jEdge format for storage/export.
 */
export const toNeo4jEdge = (parsedEdge: ParsedEdge): Neo4jEdge => ({
  id: parsedEdge.id,
  type: parsedEdge.relationshipType,
  startNodeId: parsedEdge.sourceNodeId,
  endNodeId: parsedEdge.targetNodeId,
  properties: parsedEdge.properties,
});

/**
 * Convert a Neo4jEdge to ParsedEdge format for internal use.
 */
export const toParsedEdge = (neo4jEdge: Neo4jEdge): ParsedEdge => ({
  id: neo4jEdge.id,
  relationshipType: neo4jEdge.type,
  sourceNodeId: neo4jEdge.startNodeId,
  targetNodeId: neo4jEdge.endNodeId,
  properties: neo4jEdge.properties,
});
