import fs from 'fs';

import OpenAI from 'openai';

export class NaturalLanguageToCypherService {
  private assistantId: string;
  private readonly openai: OpenAI;
  private readonly MODEL = 'gpt-4o-mini'; // Using GPT-4 Turbo
  private readonly messageInstructions = `
Analyze the Neo4j database schema provided in the neo4j-apoc-schema.json file and convert natural language requests into valid Cypher queries.

The schema contains node types like Service, Class, Method, Property, Interface, Enum, Function, Variable, Import, Export, Decorator, and File with their properties and relationships.

Your response must be a valid JSON object with this exact structure:
{
  "cypher": "MATCH (n:NodeType) WHERE n.property = $param RETURN n",
  "parameters": { "param": "value" } | null,
  "explanation": "Concise explanation of what the query does and why it matches the user's request"
}

Cypher query formatting requirements:
1. SCHEMA: Use only node labels and properties that exist in the provided schema
2. SYNTAX: Follow proper Cypher syntax with correct keywords (MATCH, WHERE, RETURN, etc.)
3. PARAMETERS: Use parameterized queries with $ syntax for dynamic values
4. PATTERNS: Use appropriate relationship patterns when traversing the graph
5. FILTERING: Include proper WHERE clauses for filtering based on user requirements
6. RETURN: Select only the data relevant to the user's request
7. PERFORMANCE: Consider using indexes and efficient query patterns

Available node types: Service, Class, Method, Property, Interface, Enum, Function, Variable, Import, Export, Decorator, File
Common properties: id, name, filePath, startLine, endLine, sourceCode, visibility, semanticType

Provide ONLY the JSON response with no additional text, markdown formatting, or explanations outside the JSON structure.
`;
  constructor() {
    // TODO: share with embedding service
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  public async getOrCreateAssistant(schemaPath: string): Promise<string> {
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

  async promptToQuery(userPrompt: string) {
    const prompt = `Please convert this request to a valid Neo4j Cypher query: ${userPrompt}.
      Use the Neo4j schema provided and follow the format specified in the instructions.
`;

    console.log('Prompt:', prompt);
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
    console.log(`Thread ID: ${threadId} `);
    console.log('run status:', run.status);

    console.log('actions:', run.required_action);
    console.log('action typpe:', run.required_action?.type);
    const messages = await this.openai.beta.threads.messages.list(threadId);
    const latestMessage = messages.data[0].content[0]; // Most recent message first
    console.log('Latest message:', latestMessage);
    const status = run.status;
    console.log('text:', (latestMessage as any).text);
    console.log('latest messagae text type:', typeof (latestMessage as any).text);
    return JSON.parse((latestMessage as any).text.value);
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
