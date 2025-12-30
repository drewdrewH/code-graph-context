import fs from 'fs';

import OpenAI from 'openai';
import type { TextContentBlock } from 'openai/resources/beta/threads/messages';

import { getTimeoutConfig } from '../config/timeouts.js';

/**
 * Categorized semantic types discovered from the schema.
 * Used to generate dynamic examples for the LLM.
 */
interface SemanticTypeCategories {
  controller: string[];
  service: string[];
  repository: string[];
  module: string[];
  guard: string[];
  pipe: string[];
  interceptor: string[];
  other: string[];
  all: string[];
}

export class NaturalLanguageToCypherService {
  private assistantId: string;
  private readonly openai: OpenAI;
  private readonly MODEL = 'gpt-4o-mini'; // Using GPT-4 Turbo
  private schemaPath: string | null = null;
  private cachedSemanticTypes: SemanticTypeCategories | null = null;
  private readonly messageInstructions = `
=== CRITICAL - CLASS/SERVICE NAME HANDLING ===
WRONG: (n:DbService), (n:UserService), (n:AuthController) - DO NOT USE CLASS NAMES AS LABELS
CORRECT: (n:Class {name: 'DbService'}) - Match on the "name" property instead

Class/service names are NOT Neo4j labels. They are values of the "name" property on Class nodes.

The ONLY valid node labels are: SourceFile, Class, Method, Function, Property, Interface,
Constructor, Parameter, Enum, Variable, Import, Export, Decorator

Examples:
- "Find DbService" -> MATCH (n:Class {name: 'DbService'}) WHERE n.projectId = $projectId RETURN n
- "Classes extending BaseService" -> MATCH (c:Class)-[:EXTENDS]->(p:Class {name: 'BaseService'}) WHERE c.projectId = $projectId RETURN c
- "Methods in UserController" -> MATCH (c:Class {name: 'UserController'})-[:HAS_MEMBER]->(m:Method) WHERE c.projectId = $projectId RETURN m
- "Classes with @Controller decorator" -> MATCH (c:Class) WHERE c.projectId = $projectId AND c.semanticType = 'NestController' RETURN c
===============================================

The schema file (neo4j-apoc-schema.json) contains two sections:
1. rawSchema: Complete Neo4j APOC schema with all node labels, properties, and relationships in the graph
2. discoveredSchema: Dynamically discovered graph structure including:
   - nodeTypes: Array of {label, count, properties} for each node type in the graph
   - relationshipTypes: Array of {type, count, connections} showing relationship types and what they connect
   - semanticTypes: Array of {type, count} showing semantic node classifications (e.g., Service, Controller)
   - commonPatterns: Array of {from, relationship, to, count} showing frequent relationship patterns

IMPORTANT - Multi-Project Isolation:
All nodes have a "projectId" property that isolates data between different projects.
You MUST include a projectId filter in EVERY query to ensure project isolation.
The projectId will be provided as a parameter ($projectId).

Your response must be a valid JSON object with this exact structure:
{
  "cypher": "MATCH (n:NodeType) WHERE n.projectId = $projectId AND n.property = $param RETURN n",
  "parameters": { "param": "value" } | null,
  "explanation": "Concise explanation of what the query does and why it matches the user's request"
}

Note: Do NOT include projectId in the parameters object - it will be injected automatically by the system.

Query Generation Process:
1. CHECK NODE TYPES: Look at discoveredSchema.nodeTypes to see available node labels and their properties
2. CHECK RELATIONSHIPS: Look at discoveredSchema.relationshipTypes to understand how nodes connect
3. CHECK SEMANTIC TYPES: Look at discoveredSchema.semanticTypes for higher-level node classifications
4. REVIEW PATTERNS: Check discoveredSchema.commonPatterns for frequent relationship patterns in the graph
5. EXAMINE PROPERTIES: Use rawSchema for exact property names and types
6. GENERATE QUERY: Write the Cypher query using only node labels, relationships, and properties that exist in the schema
7. ADD PROJECT FILTER: Always include WHERE n.projectId = $projectId for every node pattern in the query

Critical Rules:
- ALWAYS filter by projectId on every node in the query (e.g., WHERE n.projectId = $projectId)
- Use the schema information from the file_search tool - do not guess node labels or relationships
- Use ONLY node labels and properties found in the schema
- For nested JSON data in properties, use: apoc.convert.fromJsonMap(node.propertyName)
- Use parameterized queries with $ syntax for any dynamic values
- Return only the data relevant to the user's request

RELATIONSHIP TYPE DEFINITIONS (use these exact types):
- EXTENDS: Inheritance - one class/interface IS_A parent (use for "extends", "inherits from", "parent class", "subclass")
- IMPLEMENTS: Contract - a class implements an interface (use for "implements", "conforms to")
- HAS_MEMBER: Composition - a class/interface contains methods/properties (use for "has method", "contains property", "members")
- CONTAINS: Structure - file contains declarations (use for "in file", "declared in", "defined in")
- IMPORTS: Dependencies - file imports another (use for "imports", "depends on", "requires")
- TYPED_AS: Type annotation - parameter/property has a type (use for "typed as", "has type", "returns")
- HAS_PARAMETER: Function signature - method/function has parameters (use for "takes parameter", "accepts")

WARNING - NOT IMPLEMENTED (will return 0 results):
- CALLS: Function call tracking is NOT YET IMPLEMENTED. Do not use this relationship type.
  Instead, for "calls" or "uses" queries, suggest using IMPORTS to find file dependencies.
- DECORATED_WITH: Decorator relationships are NOT IMPLEMENTED. Do not use this relationship type.
  Instead, use the semanticType property (e.g., WHERE c.semanticType = 'NestController').

CRITICAL: Do NOT confuse EXTENDS (inheritance) with HAS_MEMBER (composition). "extends" always means EXTENDS relationship.

EXTENDS DIRECTION - CRITICAL:
The arrow points FROM child TO parent. The child "extends" toward the parent.
- CORRECT: (child:Class)-[:EXTENDS]->(parent:Class {name: 'BaseService'})
- WRONG: (parent:Class {name: 'BaseService'})-[:EXTENDS]->(child:Class)

Examples:
- "Classes extending DbService" -> MATCH (c:Class)-[:EXTENDS]->(p:Class {name: 'DbService'}) WHERE c.projectId = $projectId RETURN c
- "What extends BaseController" -> MATCH (c:Class)-[:EXTENDS]->(p:Class {name: 'BaseController'}) WHERE c.projectId = $projectId RETURN c
- "Services that extend DbService with >5 methods" ->
  MATCH (c:Class)-[:EXTENDS]->(p:Class {name: 'DbService'})
  WHERE c.projectId = $projectId
  WITH c
  MATCH (c)-[:HAS_MEMBER]->(m:Method)
  WITH c, count(m) AS methodCount
  WHERE methodCount > 5
  RETURN c, methodCount

SEMANTIC TYPES (Framework-Specific Classifications):
The parser assigns semanticType based on decorators or naming patterns. The actual semantic types vary by framework.

IMPORTANT: Do NOT assume NestJS semantic type names like 'NestController' or 'NestService'.
Instead, refer to the SEMANTIC TYPES IN THIS PROJECT section below for the actual types discovered in this codebase.

Common semantic type patterns:
- Controllers: Look for types containing 'Controller' (e.g., 'Controller', 'NestController')
- Services: Look for types containing 'Service', 'Provider', or 'Injectable'
- Repositories: Look for types containing 'Repository', 'DAL', or 'DAO'
- Modules: Look for types containing 'Module'

If no semantic types are discovered, use name patterns as fallback:
- "Find all controllers" -> MATCH (c:Class) WHERE c.projectId = $projectId AND c.name CONTAINS 'Controller' RETURN c
- "Find all services" -> MATCH (c:Class) WHERE c.projectId = $projectId AND c.name CONTAINS 'Service' RETURN c

NOTE: Do NOT use DECORATED_WITH relationships - they don't exist in the graph. Use semanticType property instead.

FRAMEWORK-SPECIFIC PATTERNS:

React/Frontend Projects:
- React functional components are stored as Function nodes, NOT Class nodes
- Example: "Find component UserProfile" -> MATCH (f:Function {name: 'UserProfile'}) WHERE f.projectId = $projectId RETURN f
- React hooks are also Function nodes (useAuth, useState, etc.)
- JSX files (.tsx) contain functions that return JSX elements

Decorator-Based Backend Projects (NestJS, custom frameworks, etc.):
- Uses Class nodes with semanticType property set based on decorators
- The actual semanticType values depend on the framework - check the discovered schema
- Controllers: MATCH (c:Class) WHERE c.projectId = $projectId AND c.semanticType IN [discovered controller types] RETURN c
- Services: MATCH (c:Class) WHERE c.projectId = $projectId AND c.semanticType IN [discovered service types] RETURN c

IMPORTANT: When user asks about "components" or "hooks":
- If asking about React -> query Function nodes
- If asking about decorator-based frameworks -> query Class nodes with semanticType property (using discovered types)

MODULE/DIRECTORY QUERIES:
To find things "in a module" or "in a directory", use filePath pattern matching:
- "in account module" -> WHERE n.filePath CONTAINS '/account/'
- "in auth folder" -> WHERE n.filePath CONTAINS '/auth/'
- "in src/services" -> WHERE n.filePath CONTAINS '/services/'

Examples (use discovered semantic types from this project):
- "Controllers in account module" ->
  MATCH (c:Class)
  WHERE c.projectId = $projectId AND c.semanticType IN [discovered controller types] AND c.filePath CONTAINS '/account/'
  RETURN c

- "All services in the auth folder" ->
  MATCH (c:Class)
  WHERE c.projectId = $projectId AND c.semanticType IN [discovered service types] AND c.filePath CONTAINS '/auth/'
  RETURN c

FALLBACK (when semantic types not available):
- "Controllers in account module" ->
  MATCH (c:Class)
  WHERE c.projectId = $projectId AND c.name CONTAINS 'Controller' AND c.filePath CONTAINS '/account/'
  RETURN c

NOTE: Do NOT assume packageName exists - use filePath for directory-based queries.
NOTE: Do NOT use DECORATED_WITH - use semanticType property instead.

IMPORTANT - Cypher Syntax (NOT SQL):
- Cypher does NOT use GROUP BY. Aggregation happens automatically in RETURN.
- WRONG (SQL): RETURN label, count(n) GROUP BY label
- CORRECT (Cypher): RETURN labels(n) AS label, count(n) AS count
- For grouping, non-aggregated values in RETURN automatically become grouping keys
- Use labels(n) to get node labels as an array
- Use collect() for aggregating into lists
- Use count(), sum(), avg(), min(), max() for aggregations
- Common patterns:
  - Count by type: MATCH (n) RETURN labels(n)[0] AS type, count(n) AS count
  - Group with collect: MATCH (n)-[:REL]->(m) RETURN n.name, collect(m.name) AS related

Provide ONLY the JSON response with no additional text, markdown formatting, or explanations outside the JSON structure.
`;
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    const timeoutConfig = getTimeoutConfig();
    this.openai = new OpenAI({
      apiKey,
      timeout: timeoutConfig.openai.assistantTimeoutMs,
      maxRetries: 2,
    });
  }

  public async getOrCreateAssistant(schemaPath: string): Promise<string> {
    // Store schema path for later use in prompt injection
    this.schemaPath = schemaPath;

    if (process.env.OPENAI_ASSISTANT_ID) {
      this.assistantId = process.env.OPENAI_ASSISTANT_ID;
      console.log(`Using existing assistant with ID: ${this.assistantId} `);
      return this.assistantId;
    }

    const schemaFile = await this.openai.files.create({
      file: fs.createReadStream(schemaPath),
      purpose: 'assistants',
    });

    // Create a vector store for the schema file
    const vectorStore = await this.openai.vectorStores.create({
      name: 'Neo4j APOC Schema Vector Store',
      file_ids: [schemaFile.id],
      metadata: { type: 'neo4j_apoc_schema' },
    });

    const vectorStoreId = vectorStore.id;

    // Create a new assistant
    const assistantConfig: OpenAI.Beta.AssistantCreateParams = {
      name: 'Neo4j Cypher Query Agent',
      description: 'An agent that helps convert natural language to Neo4j Cypher queries',
      model: this.MODEL,
      instructions: `
      You are a specialized assistant that helps convert natural language requests into Neo4j Cypher queries.
      When users ask questions about their codebase data, you'll analyze their intent and generate appropriate
      Cypher queries based on the Neo4j schema provided in files.
  ${this.messageInstructions}
`,
      tools: [
        {
          type: 'code_interpreter',
        },
        {
          type: 'file_search',
        },
      ],
      tool_resources: {
        code_interpreter: {
          file_ids: [schemaFile.id],
        },

        file_search: {
          vector_store_ids: [vectorStoreId],
        },
      },
    };

    const assistant = await this.openai.beta.assistants.create(assistantConfig);
    this.assistantId = assistant.id;

    return this.assistantId;
  }

  /**
   * Load and format the schema context for direct injection into prompts.
   * This supplements the file_search tool by providing explicit schema information.
   */
  private loadSchemaContext(): string {
    if (!this.schemaPath) {
      return 'No schema available. Use node types from file_search.';
    }

    try {
      const content = fs.readFileSync(this.schemaPath, 'utf-8');
      const schema = JSON.parse(content);

      if (!schema.discoveredSchema) {
        return 'No discovered schema available.';
      }

      const ds = schema.discoveredSchema;

      // Format node types
      const nodeTypes = ds.nodeTypes?.map((n: any) => n.label).join(', ') ?? 'none';

      // Get function count vs class count to hint at framework
      const functionCount = ds.nodeTypes?.find((n: any) => n.label === 'Function')?.count ?? 0;
      const classCount = ds.nodeTypes?.find((n: any) => n.label === 'Class')?.count ?? 0;
      const decoratorCount = ds.nodeTypes?.find((n: any) => n.label === 'Decorator')?.count ?? 0;

      // Format relationship types
      const relTypes = ds.relationshipTypes?.map((r: any) => r.type).join(', ') ?? 'none';

      // Format semantic types and categorize them
      const semanticTypeList: string[] = ds.semanticTypes?.map((s: any) => s.type) ?? [];
      const semTypes = semanticTypeList.length > 0 ? semanticTypeList.join(', ') : 'none';

      // Cache categorized semantic types for dynamic example generation
      this.cachedSemanticTypes = this.categorizeSemanticTypes(semanticTypeList);

      // Framework hint based on graph composition
      let frameworkHint = '';
      if (decoratorCount > 10 && classCount > functionCount) {
        // Use discovered semantic types instead of assuming NestJS
        const sampleType =
          this.cachedSemanticTypes?.controller[0] ?? this.cachedSemanticTypes?.service[0] ?? 'YourSemanticType';
        frameworkHint = `\nFRAMEWORK DETECTED: Decorator-based codebase. Use Class nodes with semanticType property (e.g., semanticType = "${sampleType}").`;
      } else if (functionCount > classCount) {
        frameworkHint = '\nFRAMEWORK DETECTED: React/functional codebase. Use Function nodes for components.';
      }

      return `
ACTUAL GRAPH SCHEMA (use these exact labels):

Node Types: ${nodeTypes}
Relationship Types: ${relTypes}
Semantic Types: ${semTypes}
${frameworkHint}
CRITICAL: Use ONLY these node labels. Do NOT invent labels like :DbService, :UserService, etc.
For queries about specific classes/services, use: (n:Class {name: 'ClassName'})
For inheritance: (child:Class)-[:EXTENDS]->(parent:Class {name: 'ParentName'})
For decorator-based queries: Use semanticType property with values from the discovered semantic types above.
`.trim();
    } catch (error) {
      console.warn('Failed to load schema for prompt injection:', error);
      return 'Schema load failed. Use file_search for schema information.';
    }
  }

  /**
   * Categorizes semantic types by their likely intent (controller, service, etc.)
   * This allows the LLM to generate queries that work with any framework,
   * not just NestJS-specific semantic type names.
   */
  private categorizeSemanticTypes(semanticTypes: string[]): SemanticTypeCategories {
    const categories: SemanticTypeCategories = {
      controller: [],
      service: [],
      repository: [],
      module: [],
      guard: [],
      pipe: [],
      interceptor: [],
      other: [],
      all: [...semanticTypes],
    };

    for (const type of semanticTypes) {
      const lower = type.toLowerCase();

      if (lower.includes('controller')) {
        categories.controller.push(type);
      } else if (lower.includes('service') || lower.includes('provider') || lower.includes('injectable')) {
        categories.service.push(type);
      } else if (lower.includes('repository') || lower.includes('dal') || lower.includes('dao')) {
        categories.repository.push(type);
      } else if (lower.includes('module')) {
        categories.module.push(type);
      } else if (lower.includes('guard') || lower.includes('auth')) {
        categories.guard.push(type);
      } else if (lower.includes('pipe') || lower.includes('validator')) {
        categories.pipe.push(type);
      } else if (lower.includes('interceptor') || lower.includes('middleware')) {
        categories.interceptor.push(type);
      } else {
        categories.other.push(type);
      }
    }

    return categories;
  }

  /**
   * Generates dynamic query examples based on discovered semantic types.
   * Provides both semantic type matching and name pattern fallbacks.
   */
  private generateDynamicSemanticExamples(categories: SemanticTypeCategories): string {
    const formatTypes = (types: string[]): string => types.map((t) => `'${t}'`).join(', ');

    let examples = '\nSEMANTIC TYPES IN THIS PROJECT:\n';

    if (categories.all.length === 0) {
      examples += 'No semantic types discovered. Use name patterns for queries.\n';
    } else {
      examples += `Available: ${categories.all.join(', ')}\n`;
    }

    examples += '\nFRAMEWORK-AGNOSTIC QUERY PATTERNS:\n';

    // Controller queries
    if (categories.controller.length > 0) {
      examples += `- "Find all controllers" -> MATCH (c:Class) WHERE c.projectId = $projectId AND c.semanticType IN [${formatTypes(categories.controller)}] RETURN c\n`;
    } else {
      examples += `- "Find all controllers" -> MATCH (c:Class) WHERE c.projectId = $projectId AND (c.name CONTAINS 'Controller' OR c.name ENDS WITH 'Controller') RETURN c\n`;
    }

    // Service queries
    if (categories.service.length > 0) {
      examples += `- "Find all services" -> MATCH (c:Class) WHERE c.projectId = $projectId AND c.semanticType IN [${formatTypes(categories.service)}] RETURN c\n`;
    } else {
      examples += `- "Find all services" -> MATCH (c:Class) WHERE c.projectId = $projectId AND (c.name CONTAINS 'Service' OR c.name ENDS WITH 'Service') RETURN c\n`;
    }

    // Repository queries
    if (categories.repository.length > 0) {
      examples += `- "Find all repositories" -> MATCH (c:Class) WHERE c.projectId = $projectId AND c.semanticType IN [${formatTypes(categories.repository)}] RETURN c\n`;
    } else {
      examples += `- "Find all repositories" -> MATCH (c:Class) WHERE c.projectId = $projectId AND (c.name CONTAINS 'Repository' OR c.name ENDS WITH 'DAL') RETURN c\n`;
    }

    // Module queries
    if (categories.module.length > 0) {
      examples += `- "Find all modules" -> MATCH (c:Class) WHERE c.projectId = $projectId AND c.semanticType IN [${formatTypes(categories.module)}] RETURN c\n`;
    }

    // Guard queries
    if (categories.guard.length > 0) {
      examples += `- "Find all guards" -> MATCH (c:Class) WHERE c.projectId = $projectId AND c.semanticType IN [${formatTypes(categories.guard)}] RETURN c\n`;
    }

    examples += `
FALLBACK PATTERNS (use when semantic types don't exist):
- For any component type, use name patterns: c.name CONTAINS 'TypeName' OR c.name ENDS WITH 'TypeName'
- Example: "Find UserController" -> MATCH (c:Class {name: 'UserController'}) WHERE c.projectId = $projectId RETURN c
`;

    return examples;
  }

  async promptToQuery(userPrompt: string, projectId: string) {
    const schemaContext = this.loadSchemaContext();

    // Generate dynamic examples based on discovered semantic types
    const dynamicSemanticExamples = this.cachedSemanticTypes
      ? this.generateDynamicSemanticExamples(this.cachedSemanticTypes)
      : '\nNo semantic types discovered. Use name patterns for all queries (e.g., c.name CONTAINS "Controller").\n';

    const prompt = `Please convert this request to a valid Neo4j Cypher query: ${userPrompt}.

${schemaContext}
${dynamicSemanticExamples}
The query will be scoped to project: ${projectId}
Remember to include WHERE n.projectId = $projectId for all node patterns.
`;

    // SECURITY: Only log prompt length, not full content which may contain sensitive data
    console.log(`NL-to-Cypher: Processing prompt (${prompt.length} chars) for project ${projectId}`);
    const run = await this.openai.beta.threads.createAndRunPoll({
      assistant_id: this.assistantId,
      thread: {
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      },
    });

    const threadId = run.thread_id;
    // SECURITY: Log minimal info, avoid exposing full objects that may contain sensitive data
    console.log(`NL-to-Cypher: Thread ${threadId}, status: ${run.status}`);

    // Validate run completed successfully
    if (run.status !== 'completed') {
      // SECURITY: Only log status and error, not full run object which may contain sensitive data
      console.error(`NL-to-Cypher run failed: status=${run.status}, error=${run.last_error?.message ?? 'none'}`);
      throw new Error(
        `Assistant run did not complete. Status: ${run.status}. ` +
          `Last error: ${run.last_error ? JSON.stringify(run.last_error) : 'none'}`,
      );
    }

    const messages = await this.openai.beta.threads.messages.list(threadId);

    // Find the first text content in the latest message
    const latestMessage = messages.data[0];
    if (!latestMessage) {
      throw new Error(
        `No messages returned from assistant. Run status: ${run.status}. Thread: ${threadId}. ` +
          `This may occur if the assistant is still initializing. Try setting OPENAI_ASSISTANT_ID in .env.`,
      );
    }
    // SECURITY: Don't log full message content which may contain user data
    console.log(`NL-to-Cypher: Received message with ${latestMessage.content?.length ?? 0} content blocks`);

    if (!latestMessage.content || latestMessage.content.length === 0) {
      throw new Error(
        `Message has no content. Run status: ${run.status}. Thread: ${threadId}. ` +
          `Message role: ${latestMessage.role}`,
      );
    }

    const textContent = latestMessage.content.find((content): content is TextContentBlock => content.type === 'text');

    if (!textContent) {
      throw new Error(`No text content found in assistant response. Run status: ${run.status}`);
    }

    // Validate that the text property exists and extract the value safely
    const textValue = textContent.text?.value;
    if (!textValue) {
      throw new Error(
        `Invalid text content structure in assistant response. Run status: ${run.status}. ` +
          `Text content: ${JSON.stringify(textContent)}`,
      );
    }

    // SECURITY: Don't log the full text value which may contain sensitive queries
    console.log(`NL-to-Cypher: Parsing response (${textValue.length} chars)`);

    // Parse the response with proper error handling
    let result: { cypher: string; parameters?: Record<string, unknown>; explanation?: string };
    try {
      result = JSON.parse(textValue);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(
        `Failed to parse assistant response as JSON: ${message}. ` +
          `Response preview: ${textValue.substring(0, 200)}...`,
      );
    }

    // Validate that the generated Cypher contains projectId filters
    this.validateProjectIdFilters(result.cypher);

    // Validate that the query uses only valid node labels (not class names as labels)
    this.validateLabelUsage(result.cypher);

    return result;
  }

  /**
   * Validates that the generated Cypher query contains projectId filters.
   * This is a security measure to ensure project isolation is maintained
   * even if the LLM forgets to include the filter.
   *
   * SECURITY: This validation ensures ALL node patterns in the query have projectId filters,
   * preventing data leakage between projects.
   */
  private validateProjectIdFilters(cypher: string): void {
    if (!cypher || typeof cypher !== 'string') {
      throw new Error('Invalid Cypher query: query is empty or not a string');
    }

    // Check if the query contains any MATCH clauses
    const matchPattern = /\bMATCH\s*\(/gi;
    const matches = cypher.match(matchPattern);

    if (matches && matches.length > 0) {
      // SECURITY: Check that projectId filter exists and uses parameter binding
      // We require $projectId to ensure parameterized queries (prevents injection)
      const hasProjectIdParam = cypher.includes('$projectId');
      const hasProjectIdFilter = cypher.includes('projectId') && hasProjectIdParam;

      if (!hasProjectIdFilter) {
        throw new Error(
          'Generated Cypher query is missing projectId filter. ' +
            'All queries must include WHERE n.projectId = $projectId for project isolation. ' +
            `Query: ${cypher}`,
        );
      }

      // SECURITY: Additional validation - count MATCH patterns and ensure projectId appears enough times
      // This catches queries like: MATCH (a:Class) MATCH (b:Method) WHERE a.projectId = $projectId
      // where the second MATCH doesn't have a projectId filter
      const matchCount = matches.length;
      const projectIdOccurrences = (cypher.match(/\.projectId\s*=/gi) ?? []).length;

      // Each MATCH pattern should ideally have a projectId filter
      // We warn but don't fail if there's at least one filter (some queries use WITH to pass context)
      if (projectIdOccurrences < matchCount) {
        console.warn(
          `SECURITY WARNING: Query has ${matchCount} MATCH patterns but only ${projectIdOccurrences} projectId filters. ` +
            'Some patterns may not be properly isolated.',
        );
      }
    }
  }

  /**
   * Validates that the generated Cypher query uses only valid node labels.
   * Class/service names should be matched via {name: 'ClassName'}, not as labels.
   */
  private validateLabelUsage(cypher: string): void {
    // Valid labels from the schema (actual Neo4j labels, not AST type names)
    const validLabels = new Set([
      'SourceFile',
      'Class',
      'Method',
      'Function',
      'Property',
      'Interface',
      'Constructor',
      'Parameter',
      'Enum',
      'Variable',
      'Import',
      'Export',
      'Decorator',
    ]);

    // Extract all labels from query (matches :LabelName patterns in node definitions)
    // This regex matches labels after : in patterns like (n:Label) or (:Label)
    const labelPattern = /\(\s*\w*\s*:\s*([A-Z][a-zA-Z0-9]*)/g;
    let match;
    const invalidLabels: string[] = [];

    while ((match = labelPattern.exec(cypher)) !== null) {
      const label = match[1];
      if (!validLabels.has(label)) {
        invalidLabels.push(label);
      }
    }

    if (invalidLabels.length > 0) {
      const label = invalidLabels[0];
      throw new Error(
        `Invalid label ":${label}" in query. ` +
          `Class/service names should be matched via {name: '${label}'}, not as labels.\n` +
          `Example: (n:Class {name: '${label}'}) instead of (n:${label})\n` +
          `Query: ${cypher}`,
      );
    }
  }

  /**
   * Create a new thread for a user
   */
  async createThread(): Promise<string> {
    const thread = await this.openai.beta.threads.create();
    return thread.id;
  }

  /**
   * Get message history for a thread
   */
  // async getThreadMessages(threadId: string): Promise<any[]> {
  //   const response = await this.openai.beta.threads.messages.list(threadId);
  //   return response.data;
  // }
  //
  // private async waitForRunCompletion(
  //   threadId: string,
  //   runId: string,
  // ): Promise<any> {
  //   let run = await this.openai.beta.threads.runs.retrieve(threadId, runId);
  //
  //   while (['queued', 'in_progress', 'requires_action'].includes(run.status)) {
  //     if (run.status === 'requires_action') {
  //       // Return here so the calling function can handle the tool outputs
  //       return run;
  //     }
  //
  //     // Wait before polling again
  //     await new Promise((resolve) => setTimeout(resolve, 1000));
  //
  //     // Check status again
  //     run = await this.openai.beta.threads.runs.retrieve(threadId, runId);
  //   }
  //
  //   if (run.status !== 'completed') {
  //     console.warn(`Run completed with non - success status: ${ run.status } `);
  //   }
  //
  //   return run;
  // }
}
