/**
 * Local Embeddings Service
 * Uses a Python sidecar running CodeSage-Base-v2 (or configurable model).
 * Default provider — no API key required.
 */

import { debugLog } from '../../mcp/utils.js';

import { getEmbeddingSidecar } from './embedding-sidecar.js';

const BATCH_CONFIG = {
  maxBatchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE ?? '', 10) || 8,
} as const;

export class LocalEmbeddingsService {
  async embedText(text: string): Promise<number[]> {
    const sidecar = getEmbeddingSidecar();
    return sidecar.embedText(text);
  }

  async embedTexts(texts: string[]): Promise<(number[] | null)[]> {
    if (texts.length === 0) return [];
    const sidecar = getEmbeddingSidecar();
    return sidecar.embed(texts);
  }

  async embedTextsInBatches(
    texts: string[],
    _batchSize?: number,
  ): Promise<(number[] | null)[]> {
    if (texts.length === 0) return [];

    // GPU batch size controls how many texts the model processes at once (memory-bound).
    // We send ALL texts in a single HTTP request and let the sidecar handle GPU batching
    // internally via model.encode(batch_size=N). This eliminates HTTP round-trip overhead.
    const gpuBatchSize = BATCH_CONFIG.maxBatchSize;
    const gpuBatches = Math.ceil(texts.length / gpuBatchSize);
    console.error(`[embedding] Sending ${texts.length} texts in 1 request (gpu_batch_size=${gpuBatchSize}, ~${gpuBatches} GPU batches)`);
    await debugLog('Batch embedding started', { provider: 'local', textCount: texts.length, gpuBatchSize });

    const sidecar = getEmbeddingSidecar();

    try {
      const results = await sidecar.embed(texts, gpuBatchSize);
      return results;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[embedding] FAILED (${texts.length} texts, gpuBatchSize=${gpuBatchSize}): ${msg}`);
      throw error;
    }
  }
}
