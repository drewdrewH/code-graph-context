// import { CodeGraphEdge, CoreEdgeType, Neo4jEdgeProperties, SemanticEdgeType } from '../../types';
// /**
//  * Neo4j-Compatible Edge Factories
//  */
// export class EdgeFactory {
//   // Core factory method that all others use
//   private static createBaseEdge(
//     relationshipType: string,
//     sourceId: string,
//     targetId: string,
//     direction: 'OUTGOING' | 'INCOMING' | 'BIDIRECTIONAL',
//     properties: Partial<Neo4jEdgeProperties>
//   ): CodeGraphEdge {
//     return {
//       id: `${sourceId}_${relationshipType}_${targetId}`,
//       relationshipType,
//       direction,
//       sourceNodeId: sourceId,
//       targetNodeId: targetId,
//       properties: {
//         id: `${sourceId}_${relationshipType}_${targetId}`,
//         createdAt: new Date().toISOString(),
//         confidence: 1.0,
//         source: 'ast',
//         ...properties
//       } as Neo4jEdgeProperties,
//       createdAt: new Date()
//     };
//   }
//   
//   // Imports (File A imports from File B)
//   static createImports(
//     sourceFileId: string,
//     targetFileId: string,
//     importProps: {
//       importType: 'named' | 'default' | 'namespace' | 'side-effect';
//       importedSymbols: string[];
//       isTypeOnly: boolean;
//       moduleSpecifier: string;
//       filePath: string;
//       lineNumber: number;
//     }
//   ): CodeGraphEdge {
//     return this.createBaseEdge('IMPORTS', sourceFileId, targetFileId, 'OUTGOING', {
//       coreType: CoreEdgeType.IMPORTS,
//       semanticTypes: [SemanticEdgeType.MODULE_IMPORTS],
//       ...importProps
//     });
//   }
//   
//   // Dependency Injection (Controller injects Service)
//   static createInjects(
//     controllerId: string,
//     serviceId: string,
//     injectionProps: {
//       injectionType: 'constructor' | 'property' | 'setter';
//       parameterIndex?: number;
//       isOptional: boolean;
//       injectionToken?: string;
//       scope: 'DEFAULT' | 'REQUEST' | 'TRANSIENT';
//       filePath: string;
//       lineNumber: number;
//     }
//   ): CodeGraphEdge {
//     return this.createBaseEdge('INJECTS', controllerId, serviceId, 'OUTGOING', {
//       coreType: CoreEdgeType.CALLS,
//       semanticTypes: [SemanticEdgeType.INJECTS],
//       source: 'decorator',
//       ...injectionProps
//     });
//   }
//   
//   // HTTP Endpoint Exposure (Controller exposes Endpoint)
//   static createExposes(
//     controllerId: string,
//     endpointId: string,
//     endpointProps: {
//       httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
//       path: string;
//       fullPath: string;
//       statusCode?: number;
//       isAsync: boolean;
//       middlewareCount: number;
//       filePath: string;
//       lineNumber: number;
//     }
//   ): CodeGraphEdge {
//     return this.createBaseEdge('EXPOSES', controllerId, endpointId, 'OUTGOING', {
//       coreType: CoreEdgeType.HAS_MEMBER,
//       semanticTypes: [SemanticEdgeType.EXPOSES],
//       source: 'decorator',
//       ...endpointProps
//     });
//   }
//   
//   // Method Calls (Method A calls Method B)
//   static createCalls(
//     sourceMethodId: string,
//     targetMethodId: string,
//     callProps: {
//       callType: 'direct' | 'indirect' | 'async' | 'conditional';
//       frequency?: number;
//       arguments: string[];
//       isConditional: boolean;
//       filePath: string;
//       lineNumber: number;
//     }
//   ): CodeGraphEdge {
//     return this.createBaseEdge('CALLS', sourceMethodId, targetMethodId, 'OUTGOING', {
//       coreType: CoreEdgeType.CALLS,
//       semanticTypes: [],
//       ...callProps
//     });
//   }
//   
//   // Class Inheritance (Class A extends Class B)
//   static createExtends(
//     subclassId: string,
//     superclassId: string,
//     inheritanceProps: {
//       overriddenMethods: string[];
//       addedMethods: string[];
//       filePath: string;
//       lineNumber: number;
//     }
//   ): CodeGraphEdge {
//     return this.createBaseEdge('EXTENDS', subclassId, superclassId, 'OUTGOING', {
//       coreType: CoreEdgeType.EXTENDS,
//       semanticTypes: [],
//       ...inheritanceProps
//     });
//   }
//   
//   // Decoration (Class/Method decorated with Decorator)
//   static createDecoratedWith(
//     targetId: string,
//     decoratorId: string,
//     decoratorProps: {
//       decoratorName: string;
//       decoratorArguments: unknown[];
//       target: 'class' | 'method' | 'property' | 'parameter';
//       position: number;
//       filePath: string;
//       lineNumber: number;
//     }
//   ): CodeGraphEdge {
//     return this.createBaseEdge('DECORATED_WITH', targetId, decoratorId, 'OUTGOING', {
//       coreType: CoreEdgeType.DECORATED_WITH,
//       semanticTypes: [],
//       source: 'decorator',
//       ...decoratorProps
//     });
//   }
//   
//   // Guards (Endpoint guarded by Guard)
//   static createGuardedBy(
//     endpointId: string,
//     guardId: string,
//     guardProps: {
//       guardType: string;
//       isGlobal: boolean;
//       conditions: string[];
//       priority: number;
//       filePath: string;
//       lineNumber: number;
//     }
//   ): CodeGraphEdge {
//     return this.createBaseEdge('GUARDED_BY', endpointId, guardId, 'OUTGOING', {
//       coreType: CoreEdgeType.DECORATED_WITH,
//       semanticTypes: [SemanticEdgeType.GUARDED_BY],
//       source: 'decorator',
//       ...guardProps
//     });
//   }
//   
//   // DTO Acceptance (Endpoint accepts DTO)
//   static createAccepts(
//     endpointId: string,
//     dtoId: string,
//     acceptanceProps: {
//       parameterType: 'body' | 'query' | 'param' | 'header';
//       isOptional: boolean;
//       validationRules: string[];
//       transformationType?: string;
//       filePath: string;
//       lineNumber: number;
//     }
//   ): CodeGraphEdge {
//     return this.createBaseEdge('ACCEPTS', endpointId, dtoId, 'OUTGOING', {
//       coreType: CoreEdgeType.HAS_PARAMETER,
//       semanticTypes: [SemanticEdgeType.ACCEPTS],
//       source: 'decorator',
//       ...acceptanceProps
//     });
//   }
//   
//   // Containment (File contains Class, Class contains Method)
//   static createContains(
//     containerId: string,
//     containedId: string,
//     containmentProps: {
//       position: number;
//       isExported: boolean;
//       filePath: string;
//       lineNumber: number;
//     }
//   ): CodeGraphEdge {
//     return this.createBaseEdge('CONTAINS', containerId, containedId, 'OUTGOING', {
//       coreType: CoreEdgeType.CONTAINS,
//       semanticTypes: [],
//       ...containmentProps
//     });
//   }
// }

