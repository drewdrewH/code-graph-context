import fs from 'fs';

import OpenAI from 'openai';
import type { TextContentBlock } from 'openai/resources/beta/threads/messages';

export class NaturalLanguageToCypherService {
  private assistantId: string;
  private readonly openai: OpenAI;
  private readonly MODEL = 'gpt-4o-mini'; // Using GPT-4 Turbo
  private readonly messageInstructions = `
The schema file (neo4j-apoc-schema.json) contains two sections:
1. rawSchema: Complete Neo4j APOC schema with all node labels, properties, and relationships in the graph
2. domainContext: Framework-specific semantics including:
   - nodeTypes: Descriptions and example queries for each node type
   - relationships: How nodes connect with context about relationship properties
   - commonQueryPatterns: Pre-built example queries for common use cases

Your response must be a valid JSON object with this exact structure:
{
  "cypher": "MATCH (n:NodeType) WHERE n.property = $param RETURN n",
  "parameters": { "param": "value" } | null,
  "explanation": "Concise explanation of what the query does and why it matches the user's request"
}

Query Generation Process:
1. CHECK DOMAIN CONTEXT: Look at domainContext.nodeTypes to understand available node types and their properties
2. REVIEW EXAMPLES: Check domainContext.commonQueryPatterns for similar query examples
3. CHECK RELATIONSHIPS: Look at domainContext.relationships to understand how nodes connect
4. EXAMINE NODE PROPERTIES: Use rawSchema to see exact property names and types
5. HANDLE JSON PROPERTIES: If properties or relationship context are stored as JSON strings, use apoc.convert.fromJsonMap() to parse them
6. GENERATE QUERY: Write the Cypher query using only node labels, relationships, and properties that exist in the schema

Critical Rules:
- Use the schema information from the file_search tool - do not guess node labels or relationships
- Use ONLY node labels and properties found in rawSchema
- For nested JSON data in properties, use: apoc.convert.fromJsonMap(node.propertyName) or apoc.convert.fromJsonMap(relationship.context)
- Check domainContext for parsing instructions specific to certain node types (e.g., some nodes may store arrays of objects in JSON format)
- Follow the example queries in commonQueryPatterns for proper syntax patterns
- Use parameterized queries with $ syntax for any dynamic values
- Return only the data relevant to the user's request

Provide ONLY the JSON response with no additional text, markdown formatting, or explanations outside the JSON structure.
`;
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.openai = new OpenAI({ apiKey });
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
    console.log(`Thread ID: ${threadId}`);
    console.log('Run status:', run.status);
    console.log('Required actions:', run.required_action);
    console.log('Last error:', run.last_error);

    // Validate run completed successfully
    if (run.status !== 'completed') {
      console.error('Full run object:', JSON.stringify(run, null, 2));
      throw new Error(
        `Assistant run did not complete. Status: ${run.status}. ` +
          `Last error: ${run.last_error ? JSON.stringify(run.last_error) : 'none'}`,
      );
    }

    const messages = await this.openai.beta.threads.messages.list(threadId);

    // Find the first text content in the latest message
    const latestMessage = messages.data[0];
    console.log('Latest message:', JSON.stringify(latestMessage, null, 2));

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

    console.log('text value:', textValue);

    return JSON.parse(textValue);
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
