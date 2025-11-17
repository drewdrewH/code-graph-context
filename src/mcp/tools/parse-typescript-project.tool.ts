/**
 * Parse TypeScript Project Tool
 * Parses TypeScript/NestJS projects and builds Neo4j graph
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { CORE_TYPESCRIPT_SCHEMA } from '../../core/config/schema.js';
import { EmbeddingsService } from '../../core/embeddings/embeddings.service.js';
import { ParserFactory, ProjectType } from '../../core/parsers/parser-factory.js';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { TOOL_NAMES, TOOL_METADATA, DEFAULTS, FILE_PATHS, LOG_CONFIG } from '../constants.js';
import { GraphGeneratorHandler } from '../handlers/graph-generator.handler.js';
import {
  createErrorResponse,
  createSuccessResponse,
  formatParseSuccess,
  formatParsePartialSuccess,
  debugLog,
} from '../utils.js';

export const createParseTypescriptProjectTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.parseTypescriptProject,
    {
      title: TOOL_METADATA[TOOL_NAMES.parseTypescriptProject].title,
      description: TOOL_METADATA[TOOL_NAMES.parseTypescriptProject].description,
      inputSchema: {
        projectPath: z.string().describe('Path to the TypeScript project root directory'),
        tsconfigPath: z.string().describe('Path to TypeScript project tsconfig.json file'),
        clearExisting: z.boolean().optional().describe('Clear existing graph data first'),
        excludeNodeTypes: z
          .array(z.string())
          .optional()
          .describe('Node types to skip during parsing, e.g. ["TestFile", "Parameter"]'),
        projectType: z
          .enum(['nestjs', 'fairsquare', 'both', 'vanilla', 'auto'])
          .optional()
          .default('auto')
          .describe('Project framework type (auto-detect by default)'),
      },
    },
    async ({ tsconfigPath, projectPath, clearExisting, projectType = 'auto' }) => {
      try {
        await debugLog('TypeScript project parsing started', {
          projectPath,
          tsconfigPath,
          clearExisting,
          projectType,
        });

        // Create parser with auto-detection or specified type
        let parser;
        if (projectType === 'auto') {
          parser = await ParserFactory.createParserWithAutoDetection(projectPath, tsconfigPath);
        } else {
          parser = ParserFactory.createParser({
            workspacePath: projectPath,
            tsConfigPath: tsconfigPath,
            projectType: projectType as ProjectType,
          });
        }

        // Parse the workspace
        const { nodes, edges } = await parser.parseWorkspace();
        const { nodes: cleanNodes, edges: cleanEdges } = parser.exportToJson();

        console.log(`Parsed ${cleanNodes.length} nodes / ${cleanEdges.length} edges`);
        await debugLog('Parsing completed', {
          nodeCount: cleanNodes.length,
          edgeCount: cleanEdges.length,
        });

        // Create graph JSON output
        const outputPath = join(projectPath, FILE_PATHS.graphOutput);

        // Get detected framework schemas from parser
        const frameworkSchemas = parser['frameworkSchemas']?.map((s: any) => s.name) ?? ['Auto-detected'];

        const graphData = {
          nodes: cleanNodes,
          edges: cleanEdges,
          metadata: {
            coreSchema: CORE_TYPESCRIPT_SCHEMA.name,
            frameworkSchemas,
            projectType,
            generated: new Date().toISOString(),
          },
        };

        writeFileSync(outputPath, JSON.stringify(graphData, null, LOG_CONFIG.jsonIndentation));
        console.log(`Graph data written to ${outputPath}`);

        // Attempt to import to Neo4j
        try {
          const neo4jService = new Neo4jService();
          const embeddingsService = new EmbeddingsService();
          const graphGeneratorHandler = new GraphGeneratorHandler(neo4jService, embeddingsService);

          const result = await graphGeneratorHandler.generateGraph(outputPath, DEFAULTS.batchSize, clearExisting);

          console.log('Graph generation completed:', result);
          await debugLog('Neo4j import completed', result);

          const successMessage = formatParseSuccess(cleanNodes.length, cleanEdges.length, result);
          return createSuccessResponse(successMessage);
        } catch (neo4jError) {
          console.error('Neo4j import failed:', neo4jError);
          await debugLog('Neo4j import failed', neo4jError);

          const partialSuccessMessage = formatParsePartialSuccess(
            cleanNodes.length,
            cleanEdges.length,
            outputPath,
            neo4jError.message,
          );
          return createSuccessResponse(partialSuccessMessage);
        }
      } catch (error) {
        console.error('Parse tool error:', error);
        await debugLog('Parse tool error', { projectPath, tsconfigPath, error });
        return createErrorResponse(error);
      }
    },
  );
};
