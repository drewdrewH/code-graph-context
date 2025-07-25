export interface CypherResult {
  nodes?: Array<{
    identity: string;
    labels: string[];
    properties: Record<string, any>;
  }>;
  relationships?: Array<{
    identity: string;
    type: string;
    properties: Record<string, any>;
    start: string;
    end: string;
  }>;
  paths?: Array<{
    start: any;
    end: any;
    segments: any[];
    length: number;
  }>;
  data?: Record<string, any>[];
  summary?: {
    query: string;
    parameters: Record<string, any>;
    resultAvailableAfter: number;
    resultConsumedAfter: number;
  };
}
export class CypherResultParser {
  public static parseCypherResult(result: Record<string, any>[]): string {
    if (!result || result.length === 0) {
      return 'No results found.';
    }

    const parsedResults: CypherResult = {};

    // Parse nodes
    if (result[0].nodes) {
      parsedResults.nodes = result[0].nodes.map((node: any) => ({
        identity: node.identity.toString(),
        labels: node.labels,
        properties: node.properties,
      }));
    }

    // Parse relationships
    if (result[0].relationships) {
      parsedResults.relationships = result[0].relationships.map((rel: any) => ({
        identity: rel.identity.toString(),
        type: rel.type,
        properties: rel.properties,
        start: rel.start.toString(),
        end: rel.end.toString(),
      }));
    }

    // Parse paths
    if (result[0].paths) {
      parsedResults.paths = result[0].paths.map((path: any) => ({
        start: path.start,
        end: path.end,
        segments: path.segments,
        length: path.length,
      }));
    }

    // Parse data
    if (result[0].data) {
      parsedResults.data = result[0].data;
    }

    // Parse summary
    if (result[0].summary) {
      parsedResults.summary = result[0].summary;
    }

    return JSON.stringify(parsedResults, null, 2);
  }
}
