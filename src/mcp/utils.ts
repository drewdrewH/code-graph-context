/**
 * MCP Server Utility Functions
 * Common utility functions used across the MCP server
 */

import { MESSAGES } from './constants.js';

export { debugLog } from '../utils/file-utils.js';

/**
 * Standard error response format for MCP tools
 */
export const createErrorResponse = (error: Error | string): { content: Array<{ type: 'text'; text: string }> } => {
  const errorMessage = error instanceof Error ? error.message : error;
  return {
    content: [
      {
        type: 'text',
        text: `${MESSAGES.errors.genericError} ${errorMessage}`,
      },
    ],
  };
};

/**
 * Standard success response format for MCP tools
 */
export const createSuccessResponse = (text: string): { content: Array<{ type: 'text'; text: string }> } => {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
};

/**
 * Format node information as structured data
 */
export const formatNodeInfo = (value: any, key: string): any => {
  if (value && typeof value === 'object' && value.labels && value.properties) {
    // Return structured node data
    const result: any = {
      id: value.properties.id,
      type: value.labels[0] ?? 'Unknown',
      filePath: value.properties.filePath,
    };

    if (value.properties.name) {
      result.name = value.properties.name;
    }

    // Include source code if available and not a SourceFile
    if (value.properties.sourceCode && value.properties.coreType !== 'SourceFile') {
      const code = value.properties.sourceCode;
      const maxLength = 1000; // Show max 1000 chars total

      if (code.length <= maxLength) {
        result.sourceCode = code;
      } else {
        // Show first 500 and last 500 characters
        const half = Math.floor(maxLength / 2);
        result.sourceCode =
          code.substring(0, half) + '\n\n... [truncated] ...\n\n' + code.substring(code.length - half);
        result.hasMore = true;
        result.truncated = code.length - maxLength;
      }
    }

    return result;
  } else if (value && typeof value === 'object' && value.type) {
    // Return structured relationship data
    return {
      relationshipType: value.type,
      properties: value.properties,
    };
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    // Handle record objects (e.g., {rd.filePath: "...", rd.name: "..."})
    const formatted: any = {};
    Object.keys(value).forEach((k) => {
      formatted[k] = formatNodeInfo(value[k], k);
    });
    return formatted;
  } else {
    // Return primitive as-is
    return value;
  }
};

/**
 * Format results for the natural language to cypher tool
 */
export const formatQueryResults = (results: any[], query: string, cypherResult: any): any => {
  const formattedResults = results.map((record) => formatNodeInfo(record, 'result'));

  return {
    query,
    cypher: cypherResult.cypher,
    parameters: cypherResult.parameters ?? {},
    explanation: cypherResult.explanation,
    totalResults: results.length,
    results: formattedResults,
  };
};

/**
 * Validate and sanitize numeric inputs
 */
export const sanitizeNumericInput = (value: number | string, defaultValue: number, max?: number): number => {
  const parsed = typeof value === 'string' ? parseInt(value, 10) : value;

  if (isNaN(parsed) || parsed < 0) {
    return defaultValue;
  }

  if (max !== undefined && parsed > max) {
    return max;
  }

  return parsed;
};

/**
 * Safe JSON parse with fallback
 */
export const safeJsonParse = (json: string, fallback: any = null): any => {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
};

/**
 * Format success message for parsing results
 */
export const formatParseSuccess = (nodeCount: number, edgeCount: number, result?: any): string => {
  let message = `${MESSAGES.success.parseSuccess} Parsed ${nodeCount} nodes and ${edgeCount} edges. Graph imported to Neo4j.`;

  if (result) {
    message += ` Result: ${JSON.stringify(result)}`;
  }

  return message;
};

/**
 * Format partial success message for parsing results
 */
export const formatParsePartialSuccess = (
  nodeCount: number,
  edgeCount: number,
  outputPath: string,
  errorMessage: string,
): string => {
  return `${MESSAGES.success.partialSuccess} Parsed ${nodeCount} nodes and ${edgeCount} edges. JSON saved to ${outputPath}. Neo4j import failed: ${errorMessage}`;
};
