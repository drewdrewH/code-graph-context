/* eslint-disable prefer-arrow/prefer-arrow-functions */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { EXCLUDE_PATTERNS_REGEX } from '../../constants.js';

import {
  CoreNodeType,
  FrameworkSchema,
  ParsedNode,
  SemanticNodeType,
  SemanticEdgeType,
  ParseOptions,
} from './schema.js';

// ============================================================================
// NESTJS HELPER FUNCTIONS
// ============================================================================

function extractMessagePattern(node: any): string {
  // Check for @EventPattern first
  let decorator = node.getDecorator('EventPattern');
  // Check for @MessagePattern
  decorator ??= node.getDecorator('MessagePattern');

  if (!decorator) return '';

  const args = decorator.getArguments();
  if (args.length === 0) return '';

  // Get the raw text of the first argument
  const rawPattern = args[0].getText();

  return rawPattern;
}

function getPatternType(node: any): 'event' | 'message' {
  if (node.getDecorator('EventPattern')) return 'event';
  if (node.getDecorator('MessagePattern')) return 'message';
  return 'event'; // default
}

function extractControllerPath(node: any): string {
  const decorator = node.getDecorator('Controller');
  if (!decorator) return '';
  const args = decorator.getArguments();
  return args.length > 0 ? `/${args[0].getText().replace(/['"]/g, '')}` : '';
}

function countHttpEndpoints(node: any): number {
  const methods = node.getMethods();
  const httpDecorators = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Head', 'Options'];
  return methods.filter((method: any) => {
    const decorators = method.getDecorators();
    return decorators.some((d: any) => httpDecorators.includes(d.getName()));
  }).length;
}

function hasDecorator(node: any, decoratorName: string): boolean {
  const decorators = node.getDecorators();
  return decorators.some((d: any) => d.getName() === decoratorName);
}

function extractVersion(node: any): string | null {
  const decorator = node.getDecorator('Version');
  if (!decorator) return null;
  const args = decorator.getArguments();
  return args.length > 0 ? args[0].getText().replace(/['"]/g, '') : null;
}

function extractScope(node: any): string {
  const decorator = node.getDecorator('Injectable');
  if (!decorator) return 'DEFAULT';
  const args = decorator.getArguments();
  if (args.length === 0) return 'DEFAULT';
  const argText = args[0].getText();
  if (argText.includes('REQUEST')) return 'REQUEST';
  if (argText.includes('TRANSIENT')) return 'TRANSIENT';
  return 'DEFAULT';
}

function hasAsyncMethods(node: any): boolean {
  const methods = node.getMethods();
  return methods.some((method: any) => method.isAsync?.());
}

function countConstructorParameters(node: any): number {
  const constructors = node.getConstructors();
  return constructors.length > 0 ? constructors[0].getParameters().length : 0;
}

function extractInjectionToken(node: any): string | null {
  const decorator = node.getDecorator('Injectable');
  if (!decorator) return null;
  const args = decorator.getArguments();
  if (args.length > 0 && args[0].getText().startsWith("'")) {
    return args[0].getText().replace(/['"]/g, '');
  }
  return null;
}

/**
 * Extract constructor parameter types and @Inject tokens for edge detection.
 * This allows INJECTS detection to work without AST access (for cross-chunk detection).
 */
function extractConstructorParamTypes(node: any): { types: string[]; injectTokens: Map<string, string> } {
  const types: string[] = [];
  const injectTokens = new Map<string, string>();

  const constructors = node.getConstructors();
  if (constructors.length === 0) return { types, injectTokens };

  const constructor = constructors[0];
  const parameters = constructor.getParameters();

  for (const param of parameters) {
    const typeNode = param.getTypeNode();
    if (typeNode) {
      const typeName = typeNode.getText();
      types.push(typeName);

      // Check for @Inject decorator
      const decorators = param.getDecorators();
      for (const decorator of decorators) {
        if (decorator.getName() === 'Inject') {
          const args = decorator.getArguments();
          if (args.length > 0) {
            const token = args[0].getText().replace(/['"]/g, '');
            injectTokens.set(typeName, token);
          }
        }
      }
    }
  }

  return { types, injectTokens };
}

function hasDynamicMethods(node: any): boolean {
  const methods = node.getMethods();
  const dynamicMethods = ['forRoot', 'forFeature', 'forRootAsync', 'forFeatureAsync'];
  return methods.some((method: any) => {
    return method.isStatic?.() && dynamicMethods.includes(method.getName());
  });
}

function extractModuleImports(node: any): string[] {
  return extractModuleArrayProperty(node, 'imports');
}

function extractModuleProviders(node: any): string[] {
  return extractModuleArrayProperty(node, 'providers');
}

function extractModuleControllers(node: any): string[] {
  return extractModuleArrayProperty(node, 'controllers');
}

function extractModuleExports(node: any): string[] {
  return extractModuleArrayProperty(node, 'exports');
}

/**
 * Escapes special regex characters in a string to prevent ReDoS attacks.
 * @param str The string to escape
 * @returns The escaped string safe for use in a regex
 */
function escapeRegexChars(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractModuleArrayProperty(node: any, propertyName: string): string[] {
  const decorator = node.getDecorator('Module');
  if (!decorator) return [];
  const args = decorator.getArguments();
  if (args.length === 0) return [];
  const configText = args[0].getText();
  // SECURITY: Escape propertyName to prevent ReDoS attacks
  const escapedPropertyName = escapeRegexChars(propertyName);
  const regex = new RegExp(`${escapedPropertyName}\\s*:\\s*\\[([^\\]]+)\\]`);
  const match = configText.match(regex);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((item: string) => item.trim().replace(/['"]/g, ''))
    .filter((item: string) => item.length > 0);
}

function extractHttpMethod(node: any): string {
  const decorators = node.getDecorators();
  const httpDecorators = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Head', 'Options'];
  const httpDecorator = decorators.find((d: any) => httpDecorators.includes(d.getName()));
  return httpDecorator ? httpDecorator.getName().toUpperCase() : '';
}

function extractRoutePath(node: any): string {
  const decorators = node.getDecorators();
  const httpDecorators = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Head', 'Options'];
  const httpDecorator = decorators.find((d: any) => httpDecorators.includes(d.getName()));
  if (!httpDecorator) return '';
  const args = httpDecorator.getArguments();
  return args.length > 0 ? args[0].getText().replace(/['"]/g, '') : '';
}

function computeFullPath(node: any): string {
  const methodPath = extractRoutePath(node);

  // Get the parent controller's base path
  const parentClass = node.getParent();
  const controllerPath = extractControllerPath(parentClass);

  // Combine paths properly
  const fullPath = `${controllerPath}/${methodPath}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';

  return fullPath;
}
function extractStatusCode(node: any): number | null {
  const decorator = node.getDecorator('HttpCode');
  if (!decorator) return null;
  const args = decorator.getArguments();
  if (args.length > 0) {
    const status = parseInt(args[0].getText());
    return isNaN(status) ? null : status;
  }
  return null;
}

function hasAuthDecorators(node: any): boolean {
  const decorators = node.getDecorators();
  const authDecorators = ['UseGuards', 'Auth', 'Roles', 'Public'];
  return decorators.some((d: any) => authDecorators.includes(d.getName()));
}

function hasValidationDecorators(node: any): boolean {
  const decorators = node.getDecorators();
  const validationDecorators = ['UsePipes', 'ValidationPipe'];
  return decorators.some((d: any) => validationDecorators.includes(d.getName()));
}

function extractGuardNames(node: any): string[] {
  return extractDecoratorArguments(node, 'UseGuards');
}

function extractPipeNames(node: any): string[] {
  return extractDecoratorArguments(node, 'UsePipes');
}

function extractInterceptorNames(node: any): string[] {
  return extractDecoratorArguments(node, 'UseInterceptors');
}

function extractDecoratorArguments(node: any, decoratorName: string): string[] {
  const decorator = node.getDecorator(decoratorName);
  if (!decorator) return [];
  const args = decorator.getArguments();
  return args.map((arg: any) => arg.getText().replace(/[(),]/g, '').trim()).filter((name: string) => name.length > 0);
}

function extractTableName(node: any): string | null {
  const decorator = node.getDecorator('Entity');
  if (!decorator) return null;
  const args = decorator.getArguments();
  return args.length > 0 ? args[0].getText().replace(/['"]/g, '') : null;
}

function countColumns(node: any): number {
  const properties = node.getProperties();
  return properties.filter((prop: any) => {
    const decorators = prop.getDecorators();
    return decorators.some((d: any) => ['Column', 'PrimaryGeneratedColumn'].includes(d.getName()));
  }).length;
}

function hasRelationDecorators(node: any): boolean {
  const properties = node.getProperties();
  const relationDecorators = ['OneToOne', 'OneToMany', 'ManyToOne', 'ManyToMany'];
  return properties.some((prop: any) => {
    const decorators = prop.getDecorators();
    return decorators.some((d: any) => relationDecorators.includes(d.getName()));
  });
}

function extractValidationDecorators(node: any): string[] {
  const properties = node.getProperties();
  const validationDecorators: string[] = [];
  const commonValidators = [
    'IsString',
    'IsNumber',
    'IsEmail',
    'IsOptional',
    'IsNotEmpty',
    'MinLength',
    'MaxLength',
    'IsArray',
    'IsBoolean',
    'IsDate',
    'IsEnum',
    'IsUUID',
    'IsUrl',
    'Min',
    'Max',
    'Matches',
    'IsIn',
    'IsNotIn',
    'IsDefined',
    'ValidateNested',
  ];

  properties.forEach((prop: any) => {
    const decorators = prop.getDecorators();
    decorators.forEach((decorator: any) => {
      const name = decorator.getName();
      if (commonValidators.includes(name)) {
        validationDecorators.push(name);
      }
    });
  });

  return [...new Set(validationDecorators)];
}

function extendsPartialType(node: any): boolean {
  const baseClass = node.getBaseClass();
  return baseClass ? baseClass.getText().includes('PartialType') : false;
}

function extractBaseClass(node: any): string | null {
  const baseClass = node.getBaseClass();
  return baseClass ? baseClass.getText() : null;
}

function detectDependencyInjection(sourceNode: any, targetNode: any): boolean {
  if (sourceNode.properties?.coreType !== CoreNodeType.CLASS_DECLARATION) return false;
  if (targetNode.properties?.coreType !== CoreNodeType.CLASS_DECLARATION) return false;

  const targetName = targetNode.properties?.name;
  if (!targetName) return false;

  // Use pre-extracted constructor params from context (works after AST cleanup)
  const constructorParamTypes = sourceNode.properties?.context?.constructorParamTypes ?? [];
  const injectTokens = sourceNode.properties?.context?.injectTokens ?? {};

  // Check if target is in constructor params by type
  if (constructorParamTypes.includes(targetName)) return true;

  // Check if target is referenced via @Inject token
  return Object.values(injectTokens).includes(targetName);
}

function extractInjectionTokenFromRelation(sourceNode: any, targetNode: any): string | null {
  const targetName = targetNode.properties?.name;
  if (!targetName) return null;

  // Use pre-extracted inject tokens from context (works after AST cleanup)
  const injectTokens = sourceNode.properties?.context?.injectTokens ?? {};

  // Find the token that maps to the target
  for (const [typeName, token] of Object.entries(injectTokens)) {
    if (token === targetName || typeName === targetName) {
      return token as string;
    }
  }

  return null;
}

function findParameterIndex(sourceNode: any, targetNode: any): number {
  const targetName = targetNode.properties?.name;
  if (!targetName) return -1;

  // Use pre-extracted constructor params from context (works after AST cleanup)
  const constructorParamTypes = sourceNode.properties?.context?.constructorParamTypes ?? [];
  return constructorParamTypes.indexOf(targetName);
}

function computeFullPathFromNodes(sourceNode: any, targetNode: any): string {
  const basePath = sourceNode.properties?.context?.basePath ?? '';
  const methodPath = targetNode.properties?.context?.path ?? '';

  // Properly combine paths
  const fullPath = `${basePath}/${methodPath}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';

  return fullPath;
}

function extractRelativePath(node: any): string {
  const filePath = node.getFilePath();
  const parts = filePath.split('/');
  return parts.slice(-3).join('/');
}

function countDeclarations({ node }: { node: any }): number {
  return node.getClasses().length + node.getInterfaces().length + node.getFunctions().length + node.getEnums().length;
}

function determineImportKind(node: any): string {
  if (node.getDefaultImport()) return 'default';
  if (node.getNamespaceImport()) return 'namespace';
  if (node.getNamedImports().length > 0) return 'named';
  return 'side-effect';
}

function determineDecoratorTarget(node: any): string {
  const parent = node.getParent();
  if (!parent) return 'unknown';

  const kind = parent.getKind();
  if (kind === 262) return 'class'; // ClassDeclaration
  if (kind === 172) return 'method'; // MethodDeclaration
  if (kind === 171) return 'property'; // PropertyDeclaration
  if (kind === 169) return 'parameter'; // Parameter

  return 'unknown';
}

// ============================================================================
// NESTJS FRAMEWORK SCHEMA
// ============================================================================

export const NESTJS_FRAMEWORK_SCHEMA: FrameworkSchema = {
  name: 'NestJS Framework Schema',
  version: '2.0.0',
  description: 'NestJS-specific enhancements with context-based properties',
  enhances: [CoreNodeType.CLASS_DECLARATION, CoreNodeType.METHOD_DECLARATION],

  enhancements: {
    NestController: {
      name: 'NestController',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.NEST_CONTROLLER,
      detectionPatterns: [
        {
          type: 'decorator',
          pattern: 'Controller',
          confidence: 0.95,
          priority: 10,
        },
        {
          type: 'filename',
          pattern: /\.controller\.ts$/,
          confidence: 0.7,
          priority: 5,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          semanticType: SemanticNodeType.NEST_CONTROLLER,
          extractor: (parsedNode: ParsedNode) => {
            const node = parsedNode.sourceNode;
            if (!node) return {};
            return {
              basePath: extractControllerPath(node),
              endpointCount: countHttpEndpoints(node),
              hasGlobalGuards: hasDecorator(node, 'UseGuards'),
              hasGlobalPipes: hasDecorator(node, 'UsePipes'),
              hasGlobalInterceptors: hasDecorator(node, 'UseInterceptors'),
              version: extractVersion(node),
            };
          },
          priority: 1,
        },
      ],
      additionalRelationships: [SemanticEdgeType.EXPOSES, SemanticEdgeType.INJECTS],
      neo4j: {
        additionalLabels: ['Controller', 'NestJS'],
        primaryLabel: 'Controller',
      },
      priority: 90,
    },

    NestService: {
      name: 'NestService',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.NEST_SERVICE,
      detectionPatterns: [
        {
          type: 'filename',
          pattern: /\.service\.ts$/,
          confidence: 0.9,
          priority: 9,
        },
        {
          type: 'function',
          pattern: (parsedNode: any) => parsedNode.sourceNode?.getName()?.endsWith('Service'),
          confidence: 0.7,
          priority: 7,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          semanticType: SemanticNodeType.NEST_SERVICE,
          extractor: (parsedNode: ParsedNode) => {
            const node = parsedNode.sourceNode;
            if (!node) return {};
            return {
              scope: extractScope(node),
              isAsync: hasAsyncMethods(node),
              dependencyCount: countConstructorParameters(node),
              injectionToken: extractInjectionToken(node),
            };
          },
          priority: 1,
        },
      ],
      additionalRelationships: [SemanticEdgeType.PROVIDED_BY, SemanticEdgeType.MANAGES],
      neo4j: {
        additionalLabels: ['Service', 'NestJS'],
        primaryLabel: 'Service',
      },
      priority: 80,
    },

    NestModule: {
      name: 'NestModule',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.NEST_MODULE,
      detectionPatterns: [
        {
          type: 'decorator',
          pattern: 'Module',
          confidence: 0.95,
          priority: 10,
        },
        {
          type: 'filename',
          pattern: /\.module\.ts$/,
          confidence: 0.8,
          priority: 7,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          semanticType: SemanticNodeType.NEST_MODULE,
          extractor: (parsedNode: ParsedNode) => {
            const node = parsedNode.sourceNode;
            if (!node) return {};
            return {
              isGlobal: hasDecorator(node, 'Global'),
              isDynamic: hasDynamicMethods(node),
              imports: extractModuleImports(node),
              providers: extractModuleProviders(node),
              controllers: extractModuleControllers(node),
              exports: extractModuleExports(node),
            };
          },
          priority: 1,
        },
      ],
      additionalRelationships: [SemanticEdgeType.MODULE_IMPORTS, SemanticEdgeType.MODULE_PROVIDES],
      neo4j: {
        additionalLabels: ['Module', 'NestJS'],
        primaryLabel: 'Module',
      },
      priority: 95,
    },

    MessageHandler: {
      name: 'MessageHandler',
      targetCoreType: CoreNodeType.METHOD_DECLARATION,
      semanticType: SemanticNodeType.MESSAGE_HANDLER,
      detectionPatterns: [
        {
          type: 'function',
          pattern: (parsedNode: any) => {
            const node = parsedNode.sourceNode;
            if (!node) return false;
            const decorators = node.getDecorators?.() ?? [];
            const messageDecorators = ['MessagePattern', 'EventPattern'];
            return decorators.some((d: any) => messageDecorators.includes(d.getName()));
          },
          confidence: 0.98,
          priority: 15,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.METHOD_DECLARATION,
          semanticType: SemanticNodeType.MESSAGE_HANDLER,
          extractor: (parsedNode: ParsedNode) => {
            const node = parsedNode.sourceNode;
            if (!node) return {};
            return {
              messageQueueName: extractMessagePattern(node),
              isAsync: node.isAsync(),
              returnType: node.getReturnTypeNode()?.getText() ?? 'void',
              pattern: getPatternType(node),
              hasAuth: hasAuthDecorators(node),
              hasValidation: hasValidationDecorators(node),
              guardNames: extractGuardNames(node),
              pipeNames: extractPipeNames(node),
              interceptorNames: extractInterceptorNames(node),
              endpointType: 'RPC',
            };
          },
          priority: 1,
        },
      ],
      additionalRelationships: [
        SemanticEdgeType.CONSUMES_MESSAGE,
        SemanticEdgeType.RESPONDS_WITH,
        SemanticEdgeType.GUARDED_BY,
      ],
      neo4j: {
        additionalLabels: ['MessageHandler', 'NestJS', 'Microservice'],
        primaryLabel: 'MessageHandler',
      },
      priority: 88,
    },

    HttpEndpoint: {
      name: 'HttpEndpoint',
      targetCoreType: CoreNodeType.METHOD_DECLARATION,
      semanticType: SemanticNodeType.HTTP_ENDPOINT,
      detectionPatterns: [
        {
          type: 'function',
          pattern: (parsedNode: any) => {
            const node = parsedNode.sourceNode;
            if (!node) return false;
            const decorators = node.getDecorators?.() ?? [];
            const httpDecorators = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Head', 'Options'];
            return decorators.some((d: any) => httpDecorators.includes(d.getName()));
          },
          confidence: 0.98,
          priority: 15,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.METHOD_DECLARATION,
          semanticType: SemanticNodeType.HTTP_ENDPOINT,
          extractor: (parsedNode: ParsedNode) => {
            const node = parsedNode.sourceNode;
            if (!node) return {};
            return {
              httpMethod: extractHttpMethod(node),
              path: extractRoutePath(node),
              fullPath: computeFullPath(node),
              statusCode: extractStatusCode(node),
              hasAuth: hasAuthDecorators(node),
              hasValidation: hasValidationDecorators(node),
              guardNames: extractGuardNames(node),
              pipeNames: extractPipeNames(node),
              interceptorNames: extractInterceptorNames(node),
            };
          },
          priority: 1,
        },
      ],
      additionalRelationships: [SemanticEdgeType.ACCEPTS, SemanticEdgeType.RESPONDS_WITH, SemanticEdgeType.GUARDED_BY],
      neo4j: {
        additionalLabels: ['HttpEndpoint', 'NestJS'],
        primaryLabel: 'HttpEndpoint',
      },
      priority: 85,
    },

    EntityClass: {
      name: 'EntityClass',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.ENTITY_CLASS,
      detectionPatterns: [
        {
          type: 'decorator',
          pattern: 'Entity',
          confidence: 0.95,
          priority: 10,
        },
        {
          type: 'filename',
          pattern: /\.entity\.ts$/,
          confidence: 0.8,
          priority: 7,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          semanticType: SemanticNodeType.ENTITY_CLASS,
          extractor: (parsedNode: ParsedNode) => {
            const node = parsedNode.sourceNode;
            if (!node) return {};
            return {
              tableName: extractTableName(node),
              columnCount: countColumns(node),
              hasRelations: hasRelationDecorators(node),
            };
          },
          priority: 1,
        },
      ],
      additionalRelationships: [],
      neo4j: {
        additionalLabels: ['Entity', 'NestJS'],
        primaryLabel: 'Entity',
      },
      priority: 80,
    },

    DTOClass: {
      name: 'DTOClass',
      targetCoreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.DTO_CLASS,
      detectionPatterns: [
        {
          type: 'filename',
          pattern: /\.dto\.ts$/,
          confidence: 0.9,
          priority: 8,
        },
        {
          type: 'classname',
          pattern: /.*Dto$/,
          confidence: 0.7,
          priority: 6,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.CLASS_DECLARATION,
          semanticType: SemanticNodeType.DTO_CLASS,
          extractor: (parsedNode: ParsedNode) => {
            const node = parsedNode.sourceNode;
            if (!node) return {};
            return {
              validationDecorators: extractValidationDecorators(node),
              isRequestDto: node.getName()?.toLowerCase().includes('request') ?? false,
              isResponseDto: node.getName()?.toLowerCase().includes('response') ?? false,
              isPartialDto: extendsPartialType(node),
              baseClass: extractBaseClass(node),
            };
          },
          priority: 1,
        },
      ],
      additionalRelationships: [SemanticEdgeType.VALIDATES],
      neo4j: {
        additionalLabels: ['DTO', 'NestJS'],
        primaryLabel: 'DTO',
      },
      priority: 70,
    },
  },

  edgeEnhancements: {
    DependencyInjection: {
      name: 'DependencyInjection',
      semanticType: SemanticEdgeType.INJECTS,
      relationshipWeight: 0.95, // Critical - core NestJS DI is primary architecture
      detectionPattern: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode) => {
        return detectDependencyInjection(parsedSourceNode, parsedTargetNode);
      },
      contextExtractor: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode) => ({
        injectionType: 'constructor',
        injectionToken: extractInjectionTokenFromRelation(parsedSourceNode, parsedTargetNode),
        parameterIndex: findParameterIndex(parsedSourceNode, parsedTargetNode),
      }),
      neo4j: {
        relationshipType: 'INJECTS',
        direction: 'OUTGOING',
      },
    },

    MessageHandlerExposure: {
      name: 'MessageHandlerExposure',
      semanticType: SemanticEdgeType.EXPOSES,
      relationshipWeight: 0.9, // Critical - API surface exposure
      detectionPattern: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode) => {
        if (
          parsedSourceNode.properties?.semanticType !== SemanticNodeType.NEST_CONTROLLER ||
          parsedTargetNode.properties?.semanticType !== SemanticNodeType.MESSAGE_HANDLER
        ) {
          return false;
        }

        if (parsedSourceNode.properties?.filePath !== parsedTargetNode.properties?.filePath) {
          return false;
        }

        // Access AST nodes to check parent relationship
        const sourceNode = parsedSourceNode.sourceNode;
        const targetNode = parsedTargetNode.sourceNode;

        if (sourceNode && targetNode) {
          const methodParent = targetNode.getParent();
          if (methodParent === sourceNode) {
            return true;
          }
        }

        return false;
      },
      contextExtractor: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode) => ({
        endpointType: 'RPC',
      }),
      neo4j: {
        relationshipType: 'EXPOSES',
        direction: 'OUTGOING',
      },
    },

    HttpEndpointExposure: {
      name: 'HttpEndpointExposure',
      semanticType: SemanticEdgeType.EXPOSES,
      relationshipWeight: 0.9, // Critical - HTTP API surface
      detectionPattern: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode) => {
        // Check if source is controller and target is HTTP endpoint
        if (
          parsedSourceNode.properties?.semanticType !== SemanticNodeType.NEST_CONTROLLER ||
          parsedTargetNode.properties?.semanticType !== SemanticNodeType.HTTP_ENDPOINT
        ) {
          return false;
        }

        if (parsedSourceNode.properties?.filePath !== parsedTargetNode.properties?.filePath) {
          return false;
        }

        // Access AST nodes to check parent relationship
        const sourceNode = parsedSourceNode.sourceNode;
        const targetNode = parsedTargetNode.sourceNode;

        if (sourceNode && targetNode) {
          const methodParent = targetNode.getParent();
          if (methodParent === sourceNode) {
            return true;
          }
        }

        return false;
      },
      contextExtractor: (parsedSourceNode: ParsedNode, parsedTargetNode: ParsedNode) => ({
        httpMethod: parsedTargetNode.properties?.context?.httpMethod ?? '',
        fullPath: computeFullPathFromNodes(parsedSourceNode, parsedTargetNode),
        statusCode: parsedTargetNode.properties?.context?.statusCode ?? 200,
      }),
      neo4j: {
        relationshipType: 'EXPOSES',
        direction: 'OUTGOING',
      },
    },
  },

  contextExtractors: [
    {
      nodeType: CoreNodeType.SOURCE_FILE,
      extractor: (parsedNode: ParsedNode) => {
        const node = parsedNode.sourceNode;
        if (!node) return {};
        return {
          extension: node.getFilePath().substring(node.getFilePath().lastIndexOf('.')),
          relativePath: extractRelativePath(node),
          isTestFile: /\.(test|spec)\./.test(node.getFilePath()),
          isDeclarationFile: node.getFilePath().endsWith('.d.ts'),
          moduleKind: 'ES6',
          importCount: node.getImportDeclarations().length,
          exportCount: node.getExportDeclarations().length,
          declarationCount: countDeclarations({ node }),
        };
      },
      priority: 1,
    },
    {
      nodeType: CoreNodeType.CLASS_DECLARATION,
      extractor: (parsedNode: ParsedNode) => {
        const node = parsedNode.sourceNode;
        if (!node) return {};

        // Extract constructor param types for INJECTS edge detection
        const { types, injectTokens } = extractConstructorParamTypes(node);

        return {
          isAbstract: node.getAbstractKeyword() != null,
          isDefaultExport: node.isDefaultExport(),
          extendsClause: node.getExtends()?.getText(),
          implementsClauses: node.getImplements().map((i: any) => i.getText()),
          decoratorNames: node.getDecorators().map((d: any) => d.getName()),
          methodCount: node.getMethods().length,
          propertyCount: node.getProperties().length,
          constructorParameterCount: countConstructorParameters(node),
          // Pre-extracted for cross-chunk edge detection
          constructorParamTypes: types,
          injectTokens: Object.fromEntries(injectTokens),
        };
      },
      priority: 1,
    },
    {
      nodeType: CoreNodeType.METHOD_DECLARATION,
      extractor: (parsedNode: ParsedNode) => {
        const node = parsedNode.sourceNode;
        if (!node) return {};
        return {
          isStatic: node.isStatic(),
          isAsync: node.isAsync(),
          isAbstract: node.isAbstract(),
          returnType: node.getReturnTypeNode()?.getText() ?? 'void',
          parameterCount: node.getParameters().length,
          decoratorNames: node.getDecorators().map((d: any) => d.getName()),
          isGetter: node.getKind() === 177,
          isSetter: node.getKind() === 178,
          overloadCount: 1, // Simplified
        };
      },
      priority: 1,
    },
    {
      nodeType: CoreNodeType.PROPERTY_DECLARATION,
      extractor: (parsedNode: ParsedNode) => {
        const node = parsedNode.sourceNode;
        if (!node) return {};
        return {
          isStatic: node.isStatic(),
          isReadonly: node.isReadonly(),
          type: node.getTypeNode()?.getText() ?? 'any',
          hasInitializer: node.hasInitializer(),
          decoratorNames: node.getDecorators().map((d: any) => d.getName()),
          isOptional: node.hasQuestionToken(),
        };
      },
      priority: 1,
    },
    {
      nodeType: CoreNodeType.PARAMETER_DECLARATION,
      extractor: (parsedNode: ParsedNode) => {
        const node = parsedNode.sourceNode;
        if (!node) return {};
        return {
          type: node.getTypeNode()?.getText() ?? 'any',
          isOptional: node.hasQuestionToken(),
          isRestParameter: node.isRestParameter(),
          hasDefaultValue: node.hasInitializer(),
          decoratorNames: node.getDecorators().map((d: any) => d.getName()),
          parameterIndex: node.getChildIndex(),
        };
      },
      priority: 1,
    },
    {
      nodeType: CoreNodeType.IMPORT_DECLARATION,
      extractor: (parsedNode: ParsedNode) => {
        const node = parsedNode.sourceNode;
        if (!node) return {};
        return {
          moduleSpecifier: node.getModuleSpecifierValue(),
          isTypeOnly: node.isTypeOnly(),
          importKind: determineImportKind(node),
          namedImports: node.getNamedImports().map((ni: any) => ni.getName()),
          defaultImport: node.getDefaultImport()?.getText() ?? null,
          namespaceImport: node.getNamespaceImport()?.getText() ?? null,
        };
      },
      priority: 1,
    },
    {
      nodeType: CoreNodeType.DECORATOR,
      extractor: (parsedNode: ParsedNode) => {
        const node = parsedNode.sourceNode;
        if (!node) return {};
        return {
          arguments: node.getArguments().map((arg: any) => arg.getText()),
          target: determineDecoratorTarget(node),
        };
      },
      priority: 1,
    },
  ],

  metadata: {
    targetLanguages: ['typescript'],
    dependencies: ['@nestjs/core', '@nestjs/common'],
  },
};

// ============================================================================
// PARSE OPTIONS
// ============================================================================

export const NESTJS_PARSE_OPTIONS: ParseOptions = {
  includePatterns: ['**/*.ts', '**/*.tsx'],
  excludePatterns: EXCLUDE_PATTERNS_REGEX,
  maxFiles: 1000,
  frameworkSchemas: [NESTJS_FRAMEWORK_SCHEMA],
};
