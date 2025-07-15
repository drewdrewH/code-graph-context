// import { CoreNodeType, DecoratorProperties, ImportDeclarationProperties, ClassDeclarationProperties, MethodDeclarationProperties, ParameterDeclarationProperties, CodeGraphNode, DTOClassProperties, HttpEndpointProperties, NestControllerProperties, NestModuleProperties, NestServiceProperties, SemanticNodeType } from '../../types';
// export class NodeFactory {
//   // Core AST node factories
//   static createClassDeclaration(properties: ClassDeclarationProperties): CodeGraphNode {
//     return {
//       coreType: CoreNodeType.CLASS_DECLARATION,
//       semanticTypes: [],
//       labels: ['ClassDeclaration', 'TypeScript'],
//       properties
//     };
//   }
//   
//   static createMethodDeclaration(properties: MethodDeclarationProperties): CodeGraphNode {
//     const labels = ['MethodDeclaration', 'TypeScript'];
//     if (properties.isAsync) labels.push('Async');
//     if (properties.isStatic) labels.push('Static');
//     
//     return {
//       coreType: CoreNodeType.METHOD_DECLARATION,
//       semanticTypes: [],
//       labels,
//       properties
//     };
//   }
//   
//   static createParameterDeclaration(properties: ParameterDeclarationProperties): CodeGraphNode {
//     const labels = ['ParameterDeclaration', 'TypeScript'];
//     if (properties.isOptional) labels.push('Optional');
//     if (properties.isRestParameter) labels.push('RestParameter');
//     
//     return {
//       coreType: CoreNodeType.PARAMETER_DECLARATION,
//       semanticTypes: [],
//       labels,
//       properties
//     };
//   }
//   
//   static createImportDeclaration(properties: ImportDeclarationProperties): CodeGraphNode {
//     const labels = ['ImportDeclaration', 'TypeScript'];
//     if (properties.isTypeOnly) labels.push('TypeOnly');
//     
//     return {
//       coreType: CoreNodeType.IMPORT_DECLARATION,
//       semanticTypes: [],
//       labels,
//       properties
//     };
//   }
//   
//   static createDecorator(properties: DecoratorProperties): CodeGraphNode {
//     return {
//       coreType: CoreNodeType.DECORATOR,
//       semanticTypes: [],
//       labels: ['Decorator', 'TypeScript', properties.decoratorName],
//       properties
//     };
//   }
//   
//   // Semantic node factories (these enhance core nodes)
//   static enhanceAsNestModule(
//     coreNode: CodeGraphNode, 
//     semanticProperties: Partial<NestModuleProperties>
//   ): CodeGraphNode {
//     return {
//       ...coreNode,
//       semanticTypes: [SemanticNodeType.NEST_MODULE],
//       labels: [...coreNode.labels, 'NestModule', 'NestJS'],
//       properties: { ...coreNode.properties, ...semanticProperties }
//     };
//   }
//   
//   static enhanceAsNestController(
//     coreNode: CodeGraphNode,
//     semanticProperties: Partial<NestControllerProperties>
//   ): CodeGraphNode {
//     return {
//       ...coreNode,
//       semanticTypes: [SemanticNodeType.NEST_CONTROLLER],
//       labels: [...coreNode.labels, 'NestController', 'NestJS', 'HTTPHandler'],
//       properties: { ...coreNode.properties, ...semanticProperties }
//     };
//   }
//   
//   static enhanceAsNestService(
//     coreNode: CodeGraphNode,
//     semanticProperties: Partial<NestServiceProperties>
//   ): CodeGraphNode {
//     return {
//       ...coreNode,
//       semanticTypes: [SemanticNodeType.NEST_SERVICE],
//       labels: [...coreNode.labels, 'NestService', 'NestJS', 'Injectable'],
//       properties: { ...coreNode.properties, ...semanticProperties }
//     };
//   }
//   
//   static enhanceAsHttpEndpoint(
//     coreNode: CodeGraphNode,
//     semanticProperties: Partial<HttpEndpointProperties>
//   ): CodeGraphNode {
//     const httpMethod = (semanticProperties as HttpEndpointProperties).httpMethod;
//     return {
//       ...coreNode,
//       semanticTypes: [SemanticNodeType.HTTP_ENDPOINT],
//       labels: [...coreNode.labels, 'HttpEndpoint', 'HTTPMethod', httpMethod],
//       properties: { ...coreNode.properties, ...semanticProperties }
//     };
//   }
//   
//   static enhanceAsDTO(
//     coreNode: CodeGraphNode,
//     semanticProperties: Partial<DTOClassProperties>
//   ): CodeGraphNode {
//     const labels = [...coreNode.labels, 'DTO', 'DataTransfer'];
//     const dtoProps = semanticProperties as DTOClassProperties;
//     if (dtoProps.isRequestDto) labels.push('RequestDTO');
//     if (dtoProps.isResponseDto) labels.push('ResponseDTO');
//     
//     return {
//       ...coreNode,
//       semanticTypes: [SemanticNodeType.DTO_CLASS],
//       labels,
//       properties: { ...coreNode.properties, ...semanticProperties }
//     };
//   }
// }

