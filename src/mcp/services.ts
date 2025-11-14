/**
 * Service Initialization
 * Handles initialization of external services like Neo4j schema and OpenAI assistant
 */

import fs from 'fs/promises';
import { join } from 'path';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';
import { initializeNaturalLanguageService } from './tools/natural-language-to-cypher.tool.js';
import { FILE_PATHS, LOG_CONFIG } from './constants.js';
import { debugLog } from './utils.js';

/**
 * Initialize all external services required by the MCP server
 */
export const initializeServices = async (): Promise<void> => {
  await Promise.all([
    initializeNeo4jSchema(),
    initializeNaturalLanguageService(),
  ]);
};

/**
 * Enrich raw Neo4j schema with FairSquare domain context
 */
const enrichSchemaWithDomainContext = (rawSchema: any) => {
  return {
    rawSchema,
    domainContext: {
      framework: 'FairSquare',
      description: 'Custom TypeScript framework for microservices with dependency injection and repository patterns',

      nodeTypes: {
        Controller: {
          description: 'HTTP request handlers that extend the Controller base class',
          purpose: 'Entry points for HTTP API endpoints',
          commonProperties: ['name', 'filePath', 'sourceCode'],
          exampleQuery: 'MATCH (c:Controller) WHERE c.name =~ ".*Credit.*" RETURN c'
        },
        Service: {
          description: 'Business logic layer with @Injectable decorator',
          purpose: 'Encapsulate business logic and orchestrate data operations',
          commonProperties: ['name', 'filePath', 'dependencies'],
          exampleQuery: 'MATCH (s:Service)-[:INJECTS]->(dep) RETURN s.name, collect(dep.name) as dependencies'
        },
        Repository: {
          description: 'Data access layer that extends Repository base class',
          purpose: 'Abstract database operations and provide data access interface',
          commonProperties: ['name', 'filePath', 'dals'],
          exampleQuery: 'MATCH (r:Repository)-[:USES_DAL]->(d:DAL) RETURN r.name, collect(d.name) as dals'
        },
        DAL: {
          description: 'Data Access Layer - direct database interaction classes',
          purpose: 'Execute database queries and manage data persistence',
          commonProperties: ['name', 'filePath'],
          exampleQuery: 'MATCH (d:DAL)<-[:USES_DAL]-(r:Repository) RETURN d.name, count(r) as usedByCount'
        },
        PermissionManager: {
          description: 'Security layer for authorization checks',
          purpose: 'Control access to resources and validate permissions',
          commonProperties: ['name', 'filePath'],
          exampleQuery: 'MATCH (c:Controller)-[:PROTECTED_BY]->(pm:PermissionManager) RETURN c.name, pm.name'
        },
        VendorClient: {
          description: 'External service integration clients',
          purpose: 'Interface with third-party APIs and services',
          commonProperties: ['name', 'filePath'],
          exampleQuery: 'MATCH (v:VendorClient)<-[:INJECTS]-(s) RETURN v.name, collect(s.name) as usedBy'
        },
        RouteDefinition: {
          description: 'Explicit route definitions from route files. CRITICAL: Individual route details (method, path, authenticated, handler, controllerName) are stored in the "context" property as a JSON string.',
          purpose: 'Map HTTP paths and methods to controller handlers',
          commonProperties: ['name', 'context', 'filePath', 'sourceCode'],
          contextStructure: 'The context property contains JSON with structure: {"routes": [{"method": "POST", "path": "/v1/endpoint", "controllerName": "SomeController", "handler": "methodName", "authenticated": true}]}',
          parsingInstructions: 'To get individual routes: (1) Parse JSON with apoc.convert.fromJsonMap(rd.context) (2) UNWIND the routes array (3) Access route.method, route.path, route.handler, route.authenticated, route.controllerName',
          exampleQuery: 'MATCH (rd:RouteDefinition) WITH rd, apoc.convert.fromJsonMap(rd.context) AS ctx UNWIND ctx.routes AS route RETURN route.method, route.path, route.controllerName, route.handler, route.authenticated ORDER BY route.path'
        },
        HttpEndpoint: {
          description: 'Methods that handle HTTP requests',
          purpose: 'Process incoming HTTP requests and return responses',
          commonProperties: ['name', 'filePath', 'sourceCode'],
          exampleQuery: 'MATCH (e:HttpEndpoint)<-[r:ROUTES_TO_HANDLER]-(rd) WHERE apoc.convert.fromJsonMap(r.context).authenticated = true RETURN e.name, apoc.convert.fromJsonMap(r.context).path as path'
        }
      },

      relationships: {
        INJECTS: {
          description: 'Dependency injection relationship from @Injectable decorator',
          direction: 'OUTGOING',
          example: 'Controller -[:INJECTS]-> Service',
          commonPatterns: ['Controller -> Service', 'Service -> Repository', 'Service -> VendorClient']
        },
        USES_DAL: {
          description: 'Repository uses Data Access Layer for database operations',
          direction: 'OUTGOING',
          example: 'Repository -[:USES_DAL]-> DAL',
          commonPatterns: ['Repository -> DAL']
        },
        ROUTES_TO: {
          description: 'Route definition points to a Controller',
          direction: 'OUTGOING',
          example: 'RouteDefinition -[:ROUTES_TO]-> Controller',
          commonPatterns: ['RouteDefinition -> Controller']
        },
        ROUTES_TO_HANDLER: {
          description: 'Route definition points to a specific handler method',
          direction: 'OUTGOING',
          example: 'RouteDefinition -[:ROUTES_TO_HANDLER]-> HttpEndpoint',
          contextProperties: ['path', 'method', 'authenticated', 'handler', 'controllerName'],
          contextNote: 'IMPORTANT: context is stored as a JSON string. Access properties using apoc.convert.fromJsonMap(r.context).propertyName',
          commonPatterns: ['RouteDefinition -> HttpEndpoint (Method)']
        },
        PROTECTED_BY: {
          description: 'Controller is protected by a PermissionManager',
          direction: 'OUTGOING',
          example: 'Controller -[:PROTECTED_BY]-> PermissionManager',
          commonPatterns: ['Controller -> PermissionManager']
        }
      },

      commonQueryPatterns: [
        {
          intent: 'Find all HTTP endpoints',
          query: 'MATCH (e:HttpEndpoint) RETURN e.name, e.filePath'
        },
        {
          intent: 'Find service dependency chain',
          query: 'MATCH path = (c:Controller)-[:INJECTS*1..3]->(s) RETURN [n in nodes(path) | n.name] as chain'
        },
        {
          intent: 'Find all authenticated routes',
          query: 'MATCH (rd:RouteDefinition)-[r:ROUTES_TO_HANDLER]->(m) WHERE apoc.convert.fromJsonMap(r.context).authenticated = true RETURN apoc.convert.fromJsonMap(r.context).path as path, apoc.convert.fromJsonMap(r.context).method as method, m.name'
        },
        {
          intent: 'Find controllers without permission managers',
          query: 'MATCH (c:Controller) WHERE NOT (c)-[:PROTECTED_BY]->(:PermissionManager) RETURN c.name'
        },
        {
          intent: 'Find what services a controller uses',
          query: 'MATCH (c:Controller {name: $controllerName})-[:INJECTS]->(s:Service) RETURN s.name'
        },
        {
          intent: 'Find complete execution path from controller to database',
          query: 'MATCH path = (c:Controller)-[:INJECTS*1..3]->(r:Repository)-[:USES_DAL]->(d:DAL) WHERE c.name = $controllerName RETURN [n in nodes(path) | n.name] as executionPath'
        }
      ]
    }
  };
};

/**
 * Initialize Neo4j schema by fetching and caching it locally
 */
const initializeNeo4jSchema = async (): Promise<void> => {
  try {
    const neo4jService = new Neo4jService();
    const rawSchema = await neo4jService.getSchema();

    // Enrich schema with FairSquare domain context
    const enrichedSchema = enrichSchemaWithDomainContext(rawSchema);

    const schemaPath = join(process.cwd(), FILE_PATHS.schemaOutput);
    await fs.writeFile(schemaPath, JSON.stringify(enrichedSchema, null, LOG_CONFIG.jsonIndentation));

    await debugLog('Neo4j schema cached successfully with domain context', { schemaPath });
  } catch (error) {
    await debugLog('Failed to initialize Neo4j schema', error);
    // Don't throw - service can still function without cached schema
  }
};