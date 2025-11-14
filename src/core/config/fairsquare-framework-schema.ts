/**
 * FairSquare Custom Framework Schema
 *
 * Detects custom patterns:
 * - @Injectable([deps]) with dependency array
 * - Controller with HTTP method conventions (get, post, put, delete)
 * - Repository pattern (extends Repository)
 * - Custom permission managers
 */

import { Node } from 'ts-morph';

import { FrameworkSchema, CoreNodeType, ParsedNode, ParsingContext } from './schema.js';

// ============================================================================
// FAIRSQUARE SEMANTIC TYPES
// ============================================================================

export enum FairSquareSemanticNodeType {
  // Core FairSquare Types
  FS_CONTROLLER = 'Controller',
  FS_SERVICE = 'Service',
  FS_REPOSITORY = 'Repository',
  FS_DAL = 'DAL', // Data Access Layer
  FS_PERMISSION_MANAGER = 'PermissionManager',
  FS_VENDOR_CLIENT = 'VendorClient', // External service clients

  // HTTP & Routing
  FS_ROUTE_DEFINITION = 'RouteDefinition',
}

export enum FairSquareSemanticEdgeType {
  // Dependency Injection
  FS_INJECTS = 'INJECTS',

  // Repository Pattern
  FS_REPOSITORY_USES_DAL = 'USES_DAL',

  // HTTP Routing
  FS_ROUTES_TO = 'ROUTES_TO', // Route definition → Controller
  FS_ROUTES_TO_HANDLER = 'ROUTES_TO_HANDLER', // Route definition → Handler method

  // Permissions
  FS_PROTECTED_BY = 'PROTECTED_BY',
  FS_INTERNAL_API_CALL = 'INTERNAL_API_CALL',
}

// Common labels used across FairSquare schema
export enum FairSquareLabel {
  FAIRSQUARE = 'FairSquare',
  BUSINESS_LOGIC = 'BusinessLogic',
  DATA_ACCESS = 'DataAccess',
  DATABASE = 'Database',
  SECURITY = 'Security',
  EXTERNAL_INTEGRATION = 'ExternalIntegration',
  HTTP_ENDPOINT = 'HttpEndpoint',
}

// ============================================================================
// CONTEXT EXTRACTORS
// ============================================================================

/**
 * Extract Injectable decorator dependencies
 * @Injectable([Dep1, Dep2]) → ['Dep1', 'Dep2']
 */
const extractInjectableDependencies = (
  parsedNode: ParsedNode,
  _allNodes?: Map<string, ParsedNode>,
  _sharedContext?: ParsingContext,
): Record<string, any> => {
  const node = parsedNode.sourceNode;
  if (!node || !Node.isClassDeclaration(node)) return {};

  const decorators = node.getDecorators();

  for (const decorator of decorators) {
    if (decorator.getName() === 'Injectable') {
      const args = decorator.getArguments();

      if (args.length > 0 && Node.isArrayLiteralExpression(args[0])) {
        const elements = args[0].getElements();
        const dependencies = elements.map((el) => el.getText());

        return {
          dependencies,
          dependencyCount: dependencies.length,
          hasInjection: dependencies.length > 0,
        };
      }
    }
  }

  return {};
};

/**
 * Extract repository DAL dependencies
 * Uses the dependencies array from @Injectable([...]) decorator
 */
const extractRepositoryDals = (
  parsedNode: ParsedNode,
  _allNodes?: Map<string, ParsedNode>,
  _sharedContext?: ParsingContext,
): Record<string, any> => {
  const dependencies = parsedNode.properties.context?.dependencies ?? [];

  // Filter for DAL-related dependencies
  const dalDeps = dependencies.filter(
    (dep: string) => dep.toLowerCase().includes('dal') || dep.toLowerCase().endsWith('dal'),
  );

  return {
    dals: dalDeps,
    dalCount: dalDeps.length,
    usesDALPattern: dalDeps.length > 0,
  };
};

/**
 * Extract permission manager usage
 * Uses the dependencies array from @Injectable([...]) decorator
 */
const extractPermissionManager = (
  parsedNode: ParsedNode,
  _allNodes?: Map<string, ParsedNode>,
  _sharedContext?: ParsingContext,
): Record<string, any> => {
  const dependencies = parsedNode.properties.context?.dependencies ?? [];

  // Find permission manager dependency
  const permissionDep = dependencies.find((dep: string) => dep.toLowerCase().includes('permission'));

  if (permissionDep) {
    return {
      permissionManager: permissionDep,
      hasPermissionManager: true,
    };
  }

  return {};
};

/**
 * Extract monorepo project name from file path
 * Supports patterns like: packages/project-name/..., apps/project-name/...
 */
const extractMonorepoProject = (
  parsedNode: ParsedNode,
  _allNodes?: Map<string, ParsedNode>,
  _sharedContext?: ParsingContext,
): Record<string, any> => {
  const node = parsedNode.sourceNode;
  if (!node || !Node.isClassDeclaration(node)) return {};

  const filePath = node.getSourceFile().getFilePath();

  // Match common monorepo patterns
  const monorepoPatterns = [
    /\/packages\/([^/]+)\//,
    /\/apps\/([^/]+)\//,
    /\/libs\/([^/]+)\//,
    /\/components\/([^/]+)\//,
  ];

  for (const pattern of monorepoPatterns) {
    const match = filePath.match(pattern);
    if (match?.[1]) {
      return {
        monorepoProject: match[1],
        isMonorepoPackage: true,
      };
    }
  }

  return {};
};

/**
 * Extract route definitions from .routes.ts files
 * Parses ModuleRoute[] arrays to get explicit route mappings
 */
const extractRouteDefinitions = (
  parsedNode: ParsedNode,
  _allNodes?: Map<string, ParsedNode>,
  _sharedContext?: ParsingContext,
): Record<string, any> => {
  const node = parsedNode.sourceNode;
  if (!node || !Node.isVariableDeclaration(node)) return {};

  // Get the initializer (the array)
  const initializer = node.getInitializer();
  if (!initializer || !Node.isArrayLiteralExpression(initializer)) {
    return {};
  }

  const routes: any[] = [];

  // Loop through each object in the array
  for (const element of initializer.getElements()) {
    if (!Node.isObjectLiteralExpression(element)) continue;

    const routeData: any = {};

    // Extract each property from the route object
    for (const prop of element.getProperties()) {
      if (!Node.isPropertyAssignment(prop)) continue;

      const propName = prop.getName();
      const propValue = prop.getInitializer();

      if (!propValue) continue;

      // Extract based on property type
      switch (propName) {
        case 'method':
        case 'path':
        case 'handler':
          // String values
          routeData[propName] = propValue.getText().replace(/['"]/g, '');
          break;

        case 'authenticated':
          // Boolean value
          routeData[propName] = propValue.getText() === 'true';
          break;

        case 'controller':
          // Identifier (class reference)
          routeData.controllerName = propValue.getText();
          break;
      }
    }

    // Only add if we got meaningful data
    if (routeData.method && routeData.path) {
      routes.push(routeData);
    }
  }

  return {
    routes,
    routeCount: routes.length,
    isRouteFile: true,
    fileName: node.getSourceFile().getBaseName(),
  };
};

// ============================================================================
// FRAMEWORK ENHANCEMENTS
// ============================================================================

export const FAIRSQUARE_FRAMEWORK_SCHEMA: FrameworkSchema = {
  name: 'FairSquare Custom Framework',
  version: '1.0.0',
  description: 'Custom FairSquare dependency injection and repository patterns',
  enhances: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.METHOD_DECLARATION],

  metadata: {
    targetLanguages: ['typescript'],
    dependencies: ['@fairsquare/core', '@fairsquare/server'],
    parseVariablesFrom: ['**/*.routes.ts', '**/*.route.ts'],
  },

  // ============================================================================
  // GLOBAL CONTEXT EXTRACTORS (run on all nodes)
  // ============================================================================
  contextExtractors: [
    {
      nodeType: CoreNodeType.CLASS_DECLARATION,
      extractor: extractInjectableDependencies,
      priority: 10,
    },
  ],

  // ============================================================================
  // NODE ENHANCEMENTS
  // ============================================================================
  enhancements: {
    // FairSquare Controller
    fairsquareController: {
      name: 'FairSquare Controller',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: FairSquareSemanticNodeType.FS_CONTROLLER as any,
      priority: 100,

      detectionPatterns: [
        {
          type: 'classname',
          pattern: /Controller$/,
          confidence: 0.7,
          priority: 5,
        },
        {
          type: 'function',
          pattern: (parsedNode: ParsedNode) => {
            const node = parsedNode.sourceNode;
            if (!node || !Node.isClassDeclaration(node)) return false;
            const baseClass = node.getExtends();
            const result = baseClass?.getText() === 'Controller';

            return result;
          },
          confidence: 1.0,
          priority: 10,
        },
      ],

      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          extractor: extractInjectableDependencies,
          priority: 10,
        },
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          extractor: extractPermissionManager,
          priority: 8,
        },
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          extractor: (parsedNode: ParsedNode, allNodes, sharedContext) => {
            // Store vendor controllers in shared context for later lookup
            const controllerName = parsedNode.properties.name;

            // Check if this is a vendor controller
            if (controllerName.includes('Vendor') || parsedNode.properties.filePath.includes('modules/vendor')) {
              // Extract vendor name: ExperianVendorController → experian
              let vendorName = '';
              if (controllerName.endsWith('VendorController')) {
                vendorName = controllerName.replace('VendorController', '').toLowerCase();
              } else if (controllerName.endsWith('Controller')) {
                vendorName = controllerName.replace('Controller', '').toLowerCase();
              }

              if (vendorName) {
                // Initialize map if not exists
                if (!sharedContext?.has('vendorControllers')) {
                  sharedContext?.set('vendorControllers', new Map<string, ParsedNode>());
                }

                const vendorControllerMap = sharedContext?.get('vendorControllers') as Map<string, ParsedNode>;
                vendorControllerMap.set(vendorName, parsedNode);
              }
            }

            return {};
          },
          priority: 5,
        },
      ],

      additionalRelationships: [
        FairSquareSemanticEdgeType.FS_INJECTS as any,
        FairSquareSemanticEdgeType.FS_PROTECTED_BY as any,
      ],

      neo4j: {
        additionalLabels: [FairSquareLabel.FAIRSQUARE, FairSquareLabel.BUSINESS_LOGIC],
        primaryLabel: FairSquareSemanticNodeType.FS_CONTROLLER,
      },
    },

    // FairSquare Service
    fairsquareService: {
      name: 'FairSquare Service',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: FairSquareSemanticNodeType.FS_SERVICE as any,
      priority: 90,

      detectionPatterns: [
        {
          type: 'classname',
          pattern: /Service$/,
          confidence: 0.8,
          priority: 5,
        },
        {
          type: 'decorator',
          pattern: 'Injectable',
          confidence: 0.9,
          priority: 8,
        },
        {
          type: 'function',
          pattern: (parsedNode: ParsedNode) => {
            const node = parsedNode.sourceNode;
            if (!node || !Node.isClassDeclaration(node)) return false;
            const name = node.getName() ?? '';
            const hasInjectable = node.getDecorators().some((d) => d.getName() === 'Injectable');
            return name.endsWith('Service') && hasInjectable;
          },
          confidence: 1.0,
          priority: 10,
        },
      ],

      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          extractor: extractInjectableDependencies,
          priority: 10,
        },
      ],

      additionalRelationships: [FairSquareSemanticEdgeType.FS_INJECTS as any],

      neo4j: {
        additionalLabels: [FairSquareLabel.FAIRSQUARE, FairSquareLabel.BUSINESS_LOGIC],
        primaryLabel: FairSquareSemanticNodeType.FS_SERVICE,
      },
    },

    // FairSquare Repository
    fairsquareRepository: {
      name: 'FairSquare Repository',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: FairSquareSemanticNodeType.FS_REPOSITORY as any,
      priority: 95,

      detectionPatterns: [
        {
          type: 'classname',
          pattern: /Repository$/,
          confidence: 0.7,
          priority: 5,
        },
        {
          type: 'function',
          pattern: (parsedNode: ParsedNode) => {
            const node = parsedNode.sourceNode;
            if (!node || !Node.isClassDeclaration(node)) return false;
            const baseClass = node.getExtends();
            return baseClass?.getText() === 'Repository';
          },
          confidence: 1.0,
          priority: 10,
        },
      ],

      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          extractor: extractInjectableDependencies,
          priority: 10,
        },
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          extractor: extractRepositoryDals,
          priority: 9,
        },
      ],

      additionalRelationships: [FairSquareSemanticEdgeType.FS_REPOSITORY_USES_DAL as any],

      neo4j: {
        additionalLabels: [FairSquareLabel.FAIRSQUARE, FairSquareLabel.DATA_ACCESS],
        primaryLabel: FairSquareSemanticNodeType.FS_REPOSITORY,
      },
    },

    // FairSquare DAL (Data Access Layer)
    fairsquareDAL: {
      name: 'FairSquare DAL',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: FairSquareSemanticNodeType.FS_DAL as any,
      priority: 85,

      detectionPatterns: [
        {
          type: 'classname',
          pattern: /DAL$/,
          confidence: 1.0,
          priority: 10,
        },
      ],

      contextExtractors: [],
      additionalRelationships: [],

      neo4j: {
        additionalLabels: [FairSquareLabel.FAIRSQUARE, FairSquareLabel.DATA_ACCESS, FairSquareLabel.DATABASE],
        primaryLabel: FairSquareSemanticNodeType.FS_DAL,
      },
    },

    // FairSquare Permission Manager
    fairsquarePermissionManager: {
      name: 'FairSquare Permission Manager',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: FairSquareSemanticNodeType.FS_PERMISSION_MANAGER as any,
      priority: 80,

      detectionPatterns: [
        {
          type: 'classname',
          pattern: /PermissionManager$/,
          confidence: 1.0,
          priority: 10,
        },
      ],

      contextExtractors: [],
      additionalRelationships: [],

      neo4j: {
        additionalLabels: [FairSquareLabel.FAIRSQUARE, FairSquareLabel.SECURITY],
        primaryLabel: FairSquareSemanticNodeType.FS_PERMISSION_MANAGER,
      },
    },

    // FairSquare Vendor Client
    fairsquareVendorClient: {
      name: 'FairSquare Vendor Client',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: FairSquareSemanticNodeType.FS_VENDOR_CLIENT as any,
      priority: 75,

      detectionPatterns: [
        {
          type: 'classname',
          pattern: /Client$/,
          confidence: 0.6,
          priority: 3,
        },
        {
          type: 'filename',
          pattern: /vendor-client/,
          confidence: 0.9,
          priority: 8,
        },
        {
          type: 'function',
          pattern: (parsedNode: ParsedNode) => {
            const node = parsedNode.sourceNode;
            if (!node || !Node.isClassDeclaration(node)) return false;
            const filePath = node.getSourceFile().getFilePath();
            return filePath.includes('vendor-client') || filePath.includes('component-vendor');
          },
          confidence: 1.0,
          priority: 10,
        },
      ],

      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          extractor: extractMonorepoProject,
          priority: 10,
        },
      ],
      additionalRelationships: [],

      neo4j: {
        additionalLabels: [FairSquareLabel.FAIRSQUARE, FairSquareLabel.EXTERNAL_INTEGRATION],
        primaryLabel: FairSquareSemanticNodeType.FS_VENDOR_CLIENT,
      },
    },

    // FairSquare Route Definition
    fairsquareRouteDefinition: {
      name: 'FairSquare Route Definition',
      targetCoreType: CoreNodeType.VARIABLE_DECLARATION,
      semanticType: FairSquareSemanticNodeType.FS_ROUTE_DEFINITION as any,
      priority: 110,

      detectionPatterns: [
        {
          type: 'function',
          pattern: (parsedNode: ParsedNode) => {
            const node = parsedNode.sourceNode;
            if (!node || !Node.isVariableDeclaration(node)) return false;

            const name = node.getName();
            const typeNode = node.getTypeNode();

            // Check if variable name ends with "Routes" AND has type ModuleRoute[]
            return !!name.endsWith('Routes') && !!typeNode?.getText().includes('ModuleRoute');
          },
          confidence: 1.0,
          priority: 10,
        },
      ],

      contextExtractors: [
        {
          nodeType: CoreNodeType.VARIABLE_DECLARATION,
          extractor: extractRouteDefinitions,
          priority: 10,
        },
      ],

      additionalRelationships: [
        FairSquareSemanticEdgeType.FS_ROUTES_TO as any,
        FairSquareSemanticEdgeType.FS_ROUTES_TO_HANDLER as any,
      ],

      neo4j: {
        additionalLabels: [FairSquareLabel.FAIRSQUARE],
        primaryLabel: FairSquareSemanticNodeType.FS_ROUTE_DEFINITION,
      },
    },

    // HTTP Endpoint (Controller methods)
    //   fairsquareHttpEndpoint: {
    //     name: 'FairSquare HTTP Endpoint',
    //     targetCoreType: CoreNodeType.METHOD_DECLARATION,
    //     semanticType: FairSquareSemanticNodeType.FS_HTTP_ENDPOINT as any,
    //     priority: 100,
    //
    //     detectionPatterns: [
    //       {
    //         type: 'function',
    //         pattern: (node: Node) => {
    //           if (!Node.isMethodDeclaration(node)) return false;
    //           const methodName = node.getName().toLowerCase();
    //           const httpMethods = ['get', 'post', 'put', 'delete', 'patch'];
    //
    //           // Check if method is HTTP verb AND parent is Controller
    //           const parent = node.getParent();
    //           const isController =
    //             Node.isClassDeclaration(parent) &&
    //             (parent.getName()?.endsWith('Controller') || parent.getExtends()?.getText() === 'Controller');
    //
    //           return httpMethods.includes(methodName) && isController;
    //         },
    //         confidence: 1.0,
    //         priority: 10,
    //       },
    //     ],
    //
    //     contextExtractors: [
    //       {
    //         nodeType: CoreNodeType.METHOD_DECLARATION,
    //         extractor: extractHttpEndpoint,
    //         priority: 10,
    //       },
    //     ],
    //
    //     additionalRelationships: [FairSquareSemanticEdgeType.FS_EXPOSES_HTTP as any],
    //
    //     neo4j: {
    //       additionalLabels: ['FairSquare', 'HttpEndpoint', 'API'],
    //       primaryLabel: 'FairSquareHttpEndpoint',
    //     },
    //   },
  },

  // ============================================================================
  // EDGE ENHANCEMENTS (Relationship detection)
  // ============================================================================
  edgeEnhancements: {
    // @Injectable([Dep1, Dep2]) creates INJECTS edges
    injectableDependencies: {
      name: 'Injectable Dependencies',
      semanticType: FairSquareSemanticEdgeType.FS_INJECTS as any,

      detectionPattern: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode, allParsedNodes, sharedContext) => {
        // FILTER: Only create INJECTS edges between ClassDeclarations
        if (
          parsedSourceNode.coreType !== CoreNodeType.CLASS_DECLARATION ||
          parsedTargetNode.coreType !== CoreNodeType.CLASS_DECLARATION
        ) {
          return false;
        }

        // Source has @Injectable([Target])
        const sourceContext = parsedSourceNode.properties.context;
        const targetName = parsedTargetNode.properties.name;

        if (!sourceContext?.dependencies) return false;

        // Use exact match to avoid false positives from substring matching
        return sourceContext.dependencies.some((dep: string) => {
          // Remove quotes and whitespace from dependency string
          const cleanDep = dep.replace(/['"]/g, '').trim();
          return cleanDep === targetName;
        });
      },

      contextExtractor: (
        parsedSourceNode: ParsedNode,
        parsedTargetNode: ParsedNode,
        allParsedNodes,
        sharedContext,
      ) => ({
        injectionType: 'constructor',
        framework: 'fairsquare',
        targetDependency: parsedTargetNode.properties.name,
      }),

      neo4j: {
        relationshipType: 'INJECTS',
        direction: 'OUTGOING',
      },
    },

    // Repository uses DAL
    repositoryUsesDAL: {
      name: 'Repository Uses DAL',
      semanticType: FairSquareSemanticEdgeType.FS_REPOSITORY_USES_DAL as any,

      detectionPattern: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode, allParsedNodes, sharedContext) => {
        const isSourceRepo = parsedSourceNode.semanticType === FairSquareSemanticNodeType.FS_REPOSITORY;
        const isTargetDAL = parsedTargetNode.semanticType === FairSquareSemanticNodeType.FS_DAL;

        if (!isSourceRepo || !isTargetDAL) return false;

        // Check if Repository injects this DAL
        const sourceDals = parsedSourceNode.properties.context?.dals ?? [];
        const targetName = parsedTargetNode.properties.name;

        // Use exact match to avoid false positives
        return sourceDals.some((dal: string) => {
          const cleanDal = dal.replace(/['"]/g, '').trim();
          return cleanDal === targetName;
        });
      },

      contextExtractor: (
        parsedSourceNode: ParsedNode,
        parsedTargetNode: ParsedNode,
        allParsedNodes,
        sharedContext,
      ) => ({
        dalName: parsedTargetNode.properties.name,
        repositoryName: parsedSourceNode.properties.name,
      }),

      neo4j: {
        relationshipType: 'USES_DAL',
        direction: 'OUTGOING',
      },
    },

    // Controller uses PermissionManager
    controllerProtectedBy: {
      name: 'Controller Protected By Permission Manager',
      semanticType: FairSquareSemanticEdgeType.FS_PROTECTED_BY as any,

      detectionPattern: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode, allParsedNodes, sharedContext) => {
        const isSourceController = parsedSourceNode.semanticType === FairSquareSemanticNodeType.FS_CONTROLLER;
        const isTargetPermissionManager =
          parsedTargetNode.semanticType === FairSquareSemanticNodeType.FS_PERMISSION_MANAGER;

        if (!isSourceController || !isTargetPermissionManager) return false;

        const sourcePermManager = parsedSourceNode.properties.context?.permissionManager;
        const targetName = parsedTargetNode.properties.name;

        if (!sourcePermManager) return false;

        // Use exact match to avoid false positives
        const cleanPermManager = sourcePermManager.replace(/['"]/g, '').trim();
        return cleanPermManager === targetName;
      },

      contextExtractor: (
        parsedSourceNode: ParsedNode,
        parsedTargetNode: ParsedNode,
        allParsedNodes,
        sharedContext,
      ) => ({
        permissionManagerName: parsedTargetNode.properties.name,
        controllerName: parsedSourceNode.properties.name,
      }),

      neo4j: {
        relationshipType: 'PROTECTED_BY',
        direction: 'OUTGOING',
      },
    },

    // Route definition routes to Controller
    routeToController: {
      name: 'Route To Controller',
      semanticType: FairSquareSemanticEdgeType.FS_ROUTES_TO as any,

      detectionPattern: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode, allParsedNodes, sharedContext) => {
        const isSourceRoute = parsedSourceNode.semanticType === FairSquareSemanticNodeType.FS_ROUTE_DEFINITION;
        const isTargetController = parsedTargetNode.semanticType === FairSquareSemanticNodeType.FS_CONTROLLER;

        if (!isSourceRoute || !isTargetController) return false;

        // Check if any route in the definition references this controller
        const routes = parsedSourceNode.properties.context?.routes ?? [];
        const targetName = parsedTargetNode.properties.name;

        return routes.some((route: any) => route.controllerName === targetName);
      },

      contextExtractor: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode, allParsedNodes, sharedContext) => {
        const routes = parsedSourceNode.properties.context?.routes ?? [];
        const targetName = parsedTargetNode.properties.name;
        const relevantRoutes = routes.filter((r: any) => r.controllerName === targetName);

        return {
          routeCount: relevantRoutes.length,
          routes: relevantRoutes,
          methods: relevantRoutes.map((r: any) => r.method),
          paths: relevantRoutes.map((r: any) => r.path),
          routeFile: parsedSourceNode.properties.context?.fileName,
        };
      },

      neo4j: {
        relationshipType: 'ROUTES_TO',
        direction: 'OUTGOING',
      },
    },

    // Route definition routes to Handler method
    routeToHandlerMethod: {
      name: 'Route To Handler Method',
      semanticType: FairSquareSemanticEdgeType.FS_ROUTES_TO_HANDLER as any,

      detectionPattern: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode, allParsedNodes, sharedContext) => {
        const isSourceRoute = parsedSourceNode.semanticType === FairSquareSemanticNodeType.FS_ROUTE_DEFINITION;
        const isTargetMethod = parsedTargetNode.coreType === CoreNodeType.METHOD_DECLARATION;

        if (!isSourceRoute || !isTargetMethod) return false;

        // Check if any route in the definition references this method as handler
        const routes = parsedSourceNode.properties.context?.routes ?? [];
        const targetMethodName = parsedTargetNode.properties.name;

        // Find routes that match this method name
        const matchingRoutes = routes.filter((route: any) => route.handler === targetMethodName);
        if (matchingRoutes.length === 0) return false;

        // CRITICAL FIX: Verify the method belongs to the correct controller
        // Find the parent class of this method by checking the AST node
        const targetNode = parsedTargetNode.sourceNode;
        if (!targetNode || !Node.isMethodDeclaration(targetNode)) return false;

        const parentClass = targetNode.getParent();
        if (!parentClass || !Node.isClassDeclaration(parentClass)) return false;

        const parentClassName = parentClass.getName();
        if (!parentClassName) return false;

        // Check if any matching route's controller name matches the parent class
        const isHandler = matchingRoutes.some((route: any) => route.controllerName === parentClassName);

        // If this method is a route handler AND is public, add HttpEndpoint label to the target node
        if (isHandler) {
          // Only add HttpEndpoint label to public methods (not private/protected)
          const isPublicMethod = parsedTargetNode.properties.visibility === 'public';

          if (
            isPublicMethod &&
            !parsedTargetNode.labels.includes(FairSquareLabel.HTTP_ENDPOINT) &&
            parsedTargetNode.properties
          ) {
            parsedTargetNode.labels.push(FairSquareLabel.HTTP_ENDPOINT);
          }
        }

        return isHandler;
      },

      contextExtractor: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode, allParsedNodes, sharedContext) => {
        const routes = parsedSourceNode.properties.context?.routes ?? [];
        const targetMethodName = parsedTargetNode.properties.name;
        const matchingRoute = routes.find((r: any) => r.handler === targetMethodName);

        return {
          method: matchingRoute?.method,
          path: matchingRoute?.path,
          authenticated: matchingRoute?.authenticated,
          handler: targetMethodName,
          controllerName: matchingRoute?.controllerName,
          routeFile: parsedSourceNode.properties.context?.fileName,
        };
      },

      neo4j: {
        relationshipType: 'ROUTES_TO_HANDLER',
        direction: 'OUTGOING',
      },
    },

    internalApiCall: {
      name: 'Internal API Call',
      semanticType: FairSquareSemanticEdgeType.FS_INTERNAL_API_CALL as any,
      detectionPattern: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode, allParsedNodes, sharedContext) => {
        // Service → VendorController (through VendorClient)
        const isSourceService = parsedSourceNode.semanticType === FairSquareSemanticNodeType.FS_SERVICE;
        const isTargetController = parsedTargetNode.semanticType === FairSquareSemanticNodeType.FS_CONTROLLER;

        if (!isSourceService || !isTargetController) return false;

        // Get vendor controller map
        const vendorControllerMap = sharedContext?.get('vendorControllers') as Map<string, ParsedNode>;
        if (!vendorControllerMap) return false;

        // Check if target is a vendor controller
        let vendorName = '';
        for (const [name, controllerNode] of vendorControllerMap) {
          if (controllerNode.id === parsedTargetNode.id) {
            vendorName = name;
            break;
          }
        }

        if (!vendorName) return false;

        // Check if service uses the corresponding VendorClient
        const sourceNode = parsedSourceNode.sourceNode;
        if (!sourceNode || !Node.isClassDeclaration(sourceNode)) return false;

        const expectedClientName = `${vendorName.charAt(0).toUpperCase() + vendorName.slice(1)}Client`;

        const properties = sourceNode.getProperties();
        for (const prop of properties) {
          const typeNode = prop.getTypeNode();
          if (typeNode?.getText() === expectedClientName) {
            return true;
          }

          const initializer = prop.getInitializer();
          if (initializer && Node.isNewExpression(initializer)) {
            if (initializer.getExpression().getText() === expectedClientName) {
              return true;
            }
          }
        }

        return false;
      },
      contextExtractor: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode, allParsedNodes, sharedContext) => {
        const vendorControllerMap = sharedContext?.get('vendorControllers') as Map<string, ParsedNode>;
        let vendorName = '';

        for (const [name, controllerNode] of vendorControllerMap!) {
          if (controllerNode.id === parsedTargetNode.id) {
            vendorName = name;
            break;
          }
        }

        return {
          serviceName: parsedSourceNode.properties.name,
          vendorController: parsedTargetNode.properties.name,
          vendorClient: `${vendorName.charAt(0).toUpperCase() + vendorName.slice(1)}Client`,
        };
      },
      neo4j: {
        relationshipType: 'INTERNAL_API_CALL',
        direction: 'OUTGOING',
      },
    },

    usesRepository: {
      name: 'Uses Repository',
      semanticType: 'USES_REPOSITORY',

      detectionPattern: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode, allParsedNodes, sharedContext) => {
        // Service → Repository
        const isSourceService = parsedSourceNode.semanticType === FairSquareSemanticNodeType.FS_SERVICE;
        const isTargetRepository = parsedTargetNode.semanticType === FairSquareSemanticNodeType.FS_REPOSITORY;

        if (!isSourceService || !isTargetRepository) return false;

        // Check if Service injects this Repository
        const sourceDependencies = parsedSourceNode.properties.context?.dependencies ?? [];
        const targetName = parsedTargetNode.properties.name;

        // Use exact match to avoid false positives
        return sourceDependencies.some((dep: string) => {
          const cleanDep = dep.replace(/['"]/g, '').trim();
          return cleanDep === targetName;
        });
      },

      contextExtractor: (
        parsedSourceNode: ParsedNode,
        parsedTargetNode: ParsedNode,
        allParsedNodes,
        sharedContext,
      ) => ({
        repositoryName: parsedTargetNode.properties.name,
        serviceName: parsedSourceNode.properties.name,
      }),

      neo4j: {
        relationshipType: 'USES_REPOSITORY',
        direction: 'OUTGOING',
      },
    },
  },
};
