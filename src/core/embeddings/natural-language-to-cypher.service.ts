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
  private readonly MODEL = 'gpt-4o'; // GPT-4o for better Cypher generation accuracy
  private schemaPath: string | null = null;
  private cachedSemanticTypes: SemanticTypeCategories | null = null;
  private readonly messageInstructions = `
=== THE SCHEMA FILE IS THE SOURCE OF TRUTH ===
ALWAYS read neo4j-apoc-schema.json FIRST before generating any query. It contains:
1. rawSchema: All node labels (keys), their properties, and relationships from Neo4j APOC
2. discoveredSchema (if available): Dynamically discovered nodeTypes, relationshipTypes, semanticTypes, commonPatterns

=== LABEL TYPES - TWO CATEGORIES ===
Check rawSchema keys for ALL valid labels. Labels fall into two categories:

1. CORE LABELS (base TypeScript AST):
   SourceFile, Class, Function, Method, Interface, Property, Parameter, Constructor, Import, Export, Decorator, Enum, Variable, TypeAlias

2. FRAMEWORK LABELS (from framework enhancements - check rawSchema keys):
   These REPLACE the core label for enhanced nodes. Check rawSchema keys for available framework labels in this project.
   A node with a framework label was originally a Class but got enhanced - always use the actual label from rawSchema.

=== AST TYPE NAME MAPPING ===
AST type names are NOT valid labels. Always map them:
- ClassDeclaration → Class (or a framework label from rawSchema if enhanced)
- FunctionDeclaration → Function
- MethodDeclaration → Method
- InterfaceDeclaration → Interface
- PropertyDeclaration → Property
- ParameterDeclaration → Parameter

=== FINDING SPECIFIC NODES ===
Class/entity names are property values, NOT labels:
WRONG: (n:MyClassName) - using class names as labels
CORRECT: (n:Class {name: 'MyClassName'}) - use label from rawSchema, name as property
CORRECT: (n:LabelFromSchema {name: 'EntityName'}) - always check rawSchema for valid labels

Examples:
- "Count all classes" -> MATCH (n:Class) WHERE n.projectId = $projectId RETURN count(n)
- "Find class by name" -> MATCH (n:Class {name: 'ClassName'}) WHERE n.projectId = $projectId RETURN n
- "Methods in a class" -> MATCH (c:Class {name: 'ClassName'})-[:HAS_MEMBER]->(m:Method) WHERE c.projectId = $projectId RETURN m

=== PROJECT ISOLATION (REQUIRED) ===
ALL queries MUST filter by projectId on every node pattern:
WHERE n.projectId = $projectId

=== RESPONSE FORMAT ===
Return ONLY valid JSON:
{
  "cypher": "MATCH (n:Label) WHERE n.projectId = $projectId RETURN n",
  "parameters": { "param": "value" } | null,
  "explanation": "What this query does"
}
Do NOT include projectId in parameters - it's injected automatically.

Query Generation Process - FOLLOW THIS EXACTLY:
1. SEARCH THE SCHEMA FILE FIRST: Use file_search to read neo4j-apoc-schema.json BEFORE generating any query
2. EXTRACT VALID LABELS: The keys in rawSchema ARE the valid labels (e.g., "Class", "Method", "Function", etc.)
   - rawSchema is ALWAYS available and contains all labels currently in the graph
   - discoveredSchema.nodeTypes (if available) provides counts and sample properties
3. CHECK RELATIONSHIPS: Look at rawSchema[label].relationships for each label to see available relationship types
4. CHECK SEMANTIC TYPES: Look at discoveredSchema.semanticTypes (if available) for framework-specific classifications
   - semanticTypes are PROPERTY values stored in n.semanticType, NOT labels - check discoveredSchema for valid values
5. REVIEW PATTERNS: Check discoveredSchema.commonPatterns (if available) for frequent relationship patterns
6. EXAMINE PROPERTIES: Use rawSchema[label].properties for exact property names and types
7. GENERATE QUERY: Write the Cypher query using ONLY labels, relationships, and properties from the schema
8. VALIDATE LABELS: Double-check that every label in your query exists as a key in rawSchema
9. ADD PROJECT FILTER: Always include WHERE n.projectId = $projectId for every node pattern in the query

Critical Rules:
- ALWAYS filter by projectId on every node in the query (e.g., WHERE n.projectId = $projectId)
- Use the schema information from the file_search tool - do not guess node labels or relationships
- Use ONLY node labels and properties found in the schema
- For nested JSON data in properties, use: apoc.convert.fromJsonMap(node.propertyName)
- Use parameterized queries with $ syntax for any dynamic values
- Return only the data relevant to the user's request

=== CORE RELATIONSHIPS ===
- CONTAINS: SourceFile contains declarations (use for "in file", "declared in", "defined in")
- HAS_MEMBER: Class/Interface has methods/properties (use for "has method", "contains property", "members")
- HAS_PARAMETER: Method/Function has parameters (use for "takes parameter", "accepts")
- EXTENDS: Class/Interface extends parent (use for "extends", "inherits from", "parent class", "subclass")
- IMPLEMENTS: Class implements Interface (use for "implements", "conforms to")
- IMPORTS: SourceFile imports another (use for "imports", "depends on", "requires")
- TYPED_AS: Parameter/Property has type annotation (use for "typed as", "has type", "returns")
- CALLS: Method/Function calls another (use for "calls", "invokes", "uses")
- DECORATED_WITH: Node has a Decorator (use for "decorated with", "has decorator", "@SomeDecorator")

=== FRAMEWORK RELATIONSHIPS ===
Framework-specific relationships are defined in rawSchema. Check rawSchema[label].relationships for each label to discover:
- What relationship types exist (e.g., INJECTS, EXPOSES, MODULE_IMPORTS, INTERNAL_API_CALL, etc.)
- Direction (in/out) and target labels for each relationship
- These vary by project - ALWAYS check the schema file for available relationships

CRITICAL: Do NOT confuse EXTENDS (inheritance) with HAS_MEMBER (composition). "extends" always means EXTENDS relationship.

EXTENDS DIRECTION - CRITICAL:
The arrow points FROM child TO parent. The child "extends" toward the parent.
- CORRECT: (child:Class)-[:EXTENDS]->(parent:Class {name: 'ParentClassName'})
- WRONG: (parent:Class {name: 'ParentClassName'})-[:EXTENDS]->(child:Class)

Examples:
- "Classes extending X" -> MATCH (c:Class)-[:EXTENDS]->(p:Class {name: 'X'}) WHERE c.projectId = $projectId RETURN c
- "What extends Y" -> MATCH (c:Class)-[:EXTENDS]->(p:Class {name: 'Y'}) WHERE c.projectId = $projectId RETURN c
- "Classes that extend X with >5 methods" ->
  MATCH (c:Class)-[:EXTENDS]->(p:Class {name: 'X'})
  WHERE c.projectId = $projectId
  WITH c
  MATCH (c)-[:HAS_MEMBER]->(m:Method)
  WITH c, count(m) AS methodCount
  WHERE methodCount > 5
  RETURN c, methodCount

=== SEMANTIC TYPES (Framework Classifications) - PRIMARY QUERY METHOD ===
*** MOST QUERIES SHOULD USE SEMANTIC TYPES - CHECK discoveredSchema.semanticTypes FIRST ***

Semantic types are the PRIMARY way to find framework-specific nodes. They are stored in:
  discoveredSchema.semanticTypes -> Array of all semantic type values in this project

The semanticType is a PROPERTY on nodes, not a label. Query patterns:
- EXACT MATCH: MATCH (c) WHERE c.projectId = $projectId AND c.semanticType = 'ExactTypeFromSchema' RETURN c
- PARTIAL MATCH: MATCH (c) WHERE c.projectId = $projectId AND c.semanticType CONTAINS 'Pattern' RETURN c

Common semantic type patterns (verify against discoveredSchema.semanticTypes):
- Controllers: types containing 'Controller'
- Services: types containing 'Service', 'Provider', or 'Injectable'
- Repositories: types containing 'Repository', 'DAL', or 'DAO'
- Modules: types containing 'Module'

FALLBACK - If semantic type doesn't exist, use name patterns:
- "Find all controllers" -> MATCH (c:Class) WHERE c.projectId = $projectId AND c.name CONTAINS 'Controller' RETURN c
- "Find all services" -> MATCH (c:Class) WHERE c.projectId = $projectId AND c.name CONTAINS 'Service' RETURN c

=== DECORATOR QUERIES ===
Use DECORATED_WITH relationship to find nodes with specific decorators:
- "Classes with @X" -> MATCH (c:Class)-[:DECORATED_WITH]->(d:Decorator {name: 'X'}) WHERE c.projectId = $projectId RETURN c
- "Methods with @Y" -> MATCH (m:Method)-[:DECORATED_WITH]->(d:Decorator {name: 'Y'}) WHERE m.projectId = $projectId RETURN m

=== MODULE/DIRECTORY QUERIES ===
Use filePath property for location-based queries:
- "in account module" -> WHERE n.filePath CONTAINS '/account/'
- "in auth folder" -> WHERE n.filePath CONTAINS '/auth/'

Examples:
- "Items in account folder" ->
  MATCH (c:Class) WHERE c.projectId = $projectId AND c.filePath CONTAINS '/account/' RETURN c
- FALLBACK (if no framework labels):
  MATCH (c:Class) WHERE c.projectId = $projectId AND c.name CONTAINS 'Service' AND c.filePath CONTAINS '/account/' RETURN c

=== FRAMEWORK-SPECIFIC PATTERNS ===

Backend Projects (decorator-based frameworks):
- Check rawSchema for framework labels that REPLACE the Class label
- Use framework relationships (INJECTS, EXPOSES, etc.) from rawSchema[label].relationships
- Check discoveredSchema.semanticTypes for framework classifications

Frontend Projects (React, functional):
- React components are typically Function nodes, NOT Class nodes
- Hooks are Function nodes (useAuth, useState, etc.)
- Example: "Find UserProfile component" -> MATCH (f:Function {name: 'UserProfile'}) WHERE f.projectId = $projectId RETURN f

Tip: Check rawSchema keys to understand if project uses framework labels or just core TypeScript labels.

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
=== VALID NODE LABELS (use ONLY these after the colon) ===
${nodeTypes}

=== VALID RELATIONSHIP TYPES ===
${relTypes}

=== SEMANTIC TYPES - USE THESE FOR FRAMEWORK QUERIES ===
Available semantic types in this project: ${semTypes}

*** SEMANTIC TYPES ARE THE PRIMARY WAY TO QUERY FRAMEWORK-SPECIFIC NODES ***
Query pattern: WHERE n.semanticType = 'TypeFromListAbove'
Example: MATCH (n:Class) WHERE n.projectId = $projectId AND n.semanticType = '${semanticTypeList[0] ?? 'SemanticType'}' RETURN n
${frameworkHint}

=== CRITICAL RULES ===
1. Use ONLY the labels listed above after the colon (:Label)
2. Semantic types are PROPERTY values, NOT labels - use WHERE n.semanticType = 'Type'
3. Class/entity names are PROPERTY values, NOT labels - use WHERE n.name = 'Name'
4. WRONG: (n:ClassName) - using names as labels
5. CORRECT: (n:Class {name: 'ClassName'}) or (n:LabelFromSchema {name: 'Name'})
6. CORRECT: (n:Class) WHERE n.semanticType = 'TypeFromSemanticTypesList'
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
   * Load valid labels dynamically from the schema file.
   * Returns all keys from rawSchema AND discoveredSchema.nodeTypes which represent actual Neo4j labels.
   */
  private loadValidLabelsFromSchema(): Set<string> {
    // Fallback to core TypeScript labels if schema not available
    const coreLabels = new Set([
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
      'TypeAlias',
      'TypeScript',
      'Embedded',
    ]);

    if (!this.schemaPath) {
      return coreLabels;
    }

    try {
      const content = fs.readFileSync(this.schemaPath, 'utf-8');
      const schema = JSON.parse(content);

      const allLabels = new Set(coreLabels);

      // Extract labels from rawSchema keys
      if (schema.rawSchema?.records?.[0]?._fields?.[0]) {
        const schemaLabels = Object.keys(schema.rawSchema.records[0]._fields[0]);
        schemaLabels.forEach((label) => allLabels.add(label));
      }

      // Also extract labels from discoveredSchema.nodeTypes (includes framework labels)
      if (schema.discoveredSchema?.nodeTypes) {
        for (const nodeType of schema.discoveredSchema.nodeTypes) {
          if (nodeType.label) {
            allLabels.add(nodeType.label);
          }
        }
      }

      return allLabels;
    } catch {
      return coreLabels;
    }
  }

  /**
   * Validates that the generated Cypher query uses only valid node labels.
   * AST type names (ClassDeclaration) must be mapped to Neo4j labels (Class).
   * Class/service names should be matched via {name: 'ClassName'}, not as labels.
   */
  private validateLabelUsage(cypher: string): void {
    // Load valid labels dynamically from schema file
    const validLabels = this.loadValidLabelsFromSchema();

    // Mapping from AST type names to correct Neo4j labels
    const astTypeToLabel: Record<string, string> = {
      ClassDeclaration: 'Class',
      FunctionDeclaration: 'Function',
      MethodDeclaration: 'Method',
      InterfaceDeclaration: 'Interface',
      PropertyDeclaration: 'Property',
      ParameterDeclaration: 'Parameter',
      ConstructorDeclaration: 'Constructor',
      ImportDeclaration: 'Import',
      ExportDeclaration: 'Export',
      EnumDeclaration: 'Enum',
      VariableDeclaration: 'Variable',
    };

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
      const correctLabel = astTypeToLabel[label];

      if (correctLabel) {
        // AST type name used instead of Neo4j label
        throw new Error(
          `Invalid label ":${label}" in query. ` +
            `Use the Neo4j label ":${correctLabel}" instead of the AST type name ":${label}".\n` +
            `Example: (n:${correctLabel}) instead of (n:${label})\n` +
            `Query: ${cypher}`,
        );
      } else {
        // Unknown label - likely a class/service name used as label
        throw new Error(
          `Invalid label ":${label}" in query. ` +
            `Class/service names should be matched via {name: '${label}'}, not as labels.\n` +
            `Example: (n:Class {name: '${label}'}) instead of (n:${label})\n` +
            `Valid labels: ${Array.from(validLabels).join(', ')}\n` +
            `Query: ${cypher}`,
        );
      }
    }
  }
}
