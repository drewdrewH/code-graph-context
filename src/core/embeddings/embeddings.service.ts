import OpenAI from 'openai';

import { debugLog } from '../../mcp/utils.js';
import { getTimeoutConfig } from '../config/timeouts.js';

/**
 * Custom error class for OpenAI configuration issues
 * Provides helpful guidance on how to resolve the issue
 */
export class OpenAIConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenAIConfigError';
  }
}

/**
 * Custom error class for OpenAI API issues (rate limits, quota, etc.)
 */
export class OpenAIAPIError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'OpenAIAPIError';
  }
}

export const EMBEDDING_BATCH_CONFIG = {
  maxBatchSize: 100, // OpenAI supports up to 2048, but 100 is efficient
  delayBetweenBatchesMs: 500, // Rate limit protection (500ms = ~2 batches/sec)
} as const;

export class EmbeddingsService {
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(model: string = 'text-embedding-3-large') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new OpenAIConfigError(
        'OPENAI_API_KEY environment variable is required.\n\n' +
          'To use semantic search features (search_codebase, natural_language_to_cypher), ' +
          'you need an OpenAI API key.\n\n' +
          'Set it in your environment:\n' +
          '  export OPENAI_API_KEY=sk-...\n\n' +
          'Or in .env file:\n' +
          '  OPENAI_API_KEY=sk-...\n\n' +
          'Alternative: Use impact_analysis or traverse_from_node which do not require OpenAI.',
      );
    }
    const timeoutConfig = getTimeoutConfig();
    this.openai = new OpenAI({
      apiKey,
      timeout: timeoutConfig.openai.embeddingTimeoutMs,
      maxRetries: 2, // Built-in retry for transient errors
    });
    this.model = model;
  }

  /**
   * Embed a single text string
   */
  async embedText(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: text,
      });
      return response.data[0].embedding;
    } catch (error: any) {
      // Handle specific error types with helpful messages
      if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        throw new OpenAIAPIError(
          'OpenAI embedding request timed out. Consider increasing OPENAI_EMBEDDING_TIMEOUT_MS.',
        );
      }

      if (error.status === 429) {
        throw new OpenAIAPIError(
          'OpenAI rate limit exceeded.\n\n' +
            'This usually means:\n' +
            '- You have hit your API rate limit\n' +
            '- You have exceeded your quota\n\n' +
            'Solutions:\n' +
            '- Wait a few minutes and try again\n' +
            '- Check your OpenAI usage at https://platform.openai.com/usage\n' +
            '- Use impact_analysis or traverse_from_node which do not require OpenAI',
          429,
        );
      }

      if (error.status === 401) {
        throw new OpenAIAPIError(
          'OpenAI API key is invalid or expired.\n\n' + 'Please check your OPENAI_API_KEY environment variable.',
          401,
        );
      }

      if (error.status === 402 || error.message?.includes('quota') || error.message?.includes('billing')) {
        throw new OpenAIAPIError(
          'OpenAI quota exceeded or billing issue.\n\n' +
            'Solutions:\n' +
            '- Check your OpenAI billing at https://platform.openai.com/settings/organization/billing\n' +
            '- Add credits to your account\n' +
            '- Use impact_analysis or traverse_from_node which do not require OpenAI',
          402,
        );
      }

      console.error('Error creating embedding:', error);
      throw error;
    }
  }

  /**
   * Embed multiple texts in a single API call.
   * OpenAI's embedding API supports batching natively.
   */
  async embedTexts(texts: string[]): Promise<(number[] | null)[]> {
    if (texts.length === 0) return [];

    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: texts,
      });

      // Map results back to original order (OpenAI returns with index)
      return response.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    } catch (error: any) {
      if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        throw new OpenAIAPIError(
          'OpenAI batch embedding request timed out. Consider reducing batch size or increasing timeout.',
        );
      }
      // Rate limited - SDK already has maxRetries:2, don't add recursive retry
      if (error.status === 429) {
        throw new OpenAIAPIError(
          'OpenAI rate limit exceeded. Wait a few minutes and try again.\n' +
            'Check your usage at https://platform.openai.com/usage',
          429,
        );
      }
      // Re-throw with context
      throw new OpenAIAPIError(`OpenAI embedding failed: ${error.message}`, error.status);
    }
  }

  /**
   * Embed texts in batches with rate limiting.
   * Returns array of embeddings in same order as input.
   * @param texts Array of texts to embed
   * @param batchSize Number of texts per API call (default: 100)
   */
  async embedTextsInBatches(
    texts: string[],
    batchSize: number = EMBEDDING_BATCH_CONFIG.maxBatchSize,
  ): Promise<(number[] | null)[]> {
    await debugLog('Batch embedding started', { textCount: texts.length });

    const results: (number[] | null)[] = [];
    const totalBatches = Math.ceil(texts.length / batchSize);

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchIndex = Math.floor(i / batchSize) + 1;

      await debugLog('Embedding batch progress', { batchIndex, totalBatches, batchSize: batch.length });

      const batchResults = await this.embedTexts(batch);
      results.push(...batchResults);

      // Rate limit protection between batches
      if (i + batchSize < texts.length) {
        await this.delay(EMBEDDING_BATCH_CONFIG.delayBetweenBatchesMs);
      }
    }

    return results;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
