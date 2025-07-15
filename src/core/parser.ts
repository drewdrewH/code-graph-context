// /* eslint-disable @typescript-eslint/no-explicit-any */
// import { TypeScriptParser, ParsedNode, ParsedEdge } from './parsers/typescript-parser';
// import { NESTJS_TYPESCRIPT_SCHEMA, CodeGraphSchema, CodeGraph, ParsingConfig, DEFAULT_PARSING_CONFIG } from './types/graph';
//
// export interface ParseProgress {
//   phase: 'initialization' | 'file-discovery' | 'parsing' | 'relationship-analysis' | 'completed' | 'error';
//   current: number;
//   total: number;
//   message: string;
//   details?: any;
// }
//
// export interface ParseResult {
//   success: boolean;
//   graph?: CodeGraph;
//   // statistics: ParseStatistics;
//   errors: ParseError[];
//   warnings: string[];
//   duration: number;
// }
//
// // export interface ParseStatistics {
// //   totalFiles: number;
// //   parsedFiles: number;
// //   skippedFiles: number;
// //   totalNodes: number;
// //   totalEdges: number;
// //   nodeTypeCounts: Record<string, number>;
// //   edgeTypeCounts: Record<string, number>;
// //   projectsAnalyzed: string[];
// //   frameworksDetected: FrameworkInfo[];
// // }
//
// export interface ParseError {
//   file?: string;
//   message: string;
//   stack?: string;
//   phase: string;
// }export class GraphBuilder {
//   private parser: TypeScriptParser;
//   private schema: CodeGraphSchema;
//   private parseConfig: ParsingConfig;
//   private progressCallback?: (progress: ParseProgress) => void;
//
//   constructor(
//     workspacePath: string,
//     schema: CodeGraphSchema = NESTJS_TYPESCRIPT_SCHEMA,
//     parseConfig: ParsingConfig = DEFAULT_PARSING_CONFIG,
//     progressCallback?: (progress: ParseProgress) => void
//   ) {
//     this.parser = new TypeScriptParser(workspacePath, schema);
//     this.schema = schema;
//     this.parseConfig = parseConfig;
//     this.progressCallback = progressCallback;
//   }
//
//   parseCodeBase(){
//
//     
//     
//   }
//
//
// }
