/**
 * MCP Server Utility Functions
 * Common utility functions used across the MCP server
 */

import fs from 'fs/promises';
import path from 'path';

import { FILE_PATHS, LOG_CONFIG, MESSAGES } from './constants.js';

/**
 * Debug logging utility
 */
export const debugLog = async (message: string, data?: any): Promise<void> => {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n${data ? JSON.stringify(data, null, LOG_CONFIG.jsonIndentation) : ''}\n${LOG_CONFIG.logSeparator}\n`;

  try {
    await fs.appendFile(path.join(process.cwd(), FILE_PATHS.debugLog), logEntry);
  } catch (error) {
    console.error('Failed to write debug log:', error);
  }
};

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
 * Format node information for display
 */
export const formatNodeInfo = (value: any, key: string): string => {
  if (value && typeof value === 'object' && value.labels && value.properties) {
    // This is a node
    let info = `**${key}** (${value.labels.join(', ')}):\n`;
    info += `- **ID:** ${value.properties.id || 'N/A'}\n`;
    info += `- **File:** ${value.properties.filePath || 'N/A'}\n`;

    if (value.properties.name) {
      info += `- **Name:** ${value.properties.name}\n`;
    }

    if (value.properties.sourceCode) {
      const code = value.properties.sourceCode.substring(0, 500);
      const hasMore = value.properties.sourceCode.length > 500;
      info += `- **Code:** \`\`\`typescript\n${code}${hasMore ? '...' : ''}\n\`\`\`\n`;
    }

    return info;
  } else if (value && typeof value === 'object' && value.type) {
    // This is a relationship
    let info = `**${key}** (${value.type}):\n`;
    if (value.properties && Object.keys(value.properties).length > 0) {
      info += `- **Properties:** ${JSON.stringify(value.properties, null, LOG_CONFIG.jsonIndentation)}\n`;
    }
    return info;
  } else {
    // Simple value
    return `**${key}:** ${JSON.stringify(value, null, LOG_CONFIG.jsonIndentation)}\n`;
  }
};

/**
 * Format results for the natural language to cypher tool
 */
export const formatQueryResults = (results: any[], query: string, cypherResult: any): string => {
  let response = `${MESSAGES.queries.naturalLanguagePrefix} "${query}"\n\n`;
  response += `${MESSAGES.queries.cypherQueryHeader}\n\`\`\`cypher\n${cypherResult.cypher}\n\`\`\`\n\n`;

  if (cypherResult.parameters && Object.keys(cypherResult.parameters).length > 0) {
    response += `**Parameters:** ${JSON.stringify(cypherResult.parameters, null, LOG_CONFIG.jsonIndentation)}\n\n`;
  }

  response += `**Explanation:** ${cypherResult.explanation}\n\n`;
  response += `${MESSAGES.queries.queryResultsHeader} (${results.length} records)\n\n`;

  if (results.length === 0) {
    response += `${MESSAGES.queries.noResultsFound}\n\n`;
  } else {
    // Format results based on the structure
    const maxResults = Math.min(results.length, 20);

    for (let i = 0; i < maxResults; i++) {
      const record = results[i];
      response += `### Result ${i + 1}\n`;

      // Handle different types of results
      Object.keys(record).forEach((key) => {
        response += formatNodeInfo(record[key], key);
      });
      response += '\n';
    }

    if (results.length > 20) {
      response += MESSAGES.queries.moreResultsIndicator.replace('{}', (results.length - 20).toString()) + '\n\n';
    }
  }

  response += `\n---\n${MESSAGES.queries.summaryPrefix.replace('{}', results.length.toString())}`;
  return response;
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

