/**
 * Local Embeddings Service
 * Uses a Python sidecar running Qodo-Embed-1-1.5B (or configurable model).
 * Default provider — no API key required.
 */

import { debugLog } from '../../mcp/utils.js';

import { getEmbeddingSidecar } from './embedding-sidecar.js';

const BATCH_CONFIG = {
  maxBatchSize: 16, // Small batches — 1.5B model on MPS has limited VRAM
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
    batchSize: number = BATCH_CONFIG.maxBatchSize,
  ): Promise<(number[] | null)[]> {
    await debugLog('Batch embedding started', { provider: 'local', textCount: texts.length });

    const sidecar = getEmbeddingSidecar();
    const results: (number[] | null)[] = [];
    const totalBatches = Math.ceil(texts.length / batchSize);

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchIndex = Math.floor(i / batchSize) + 1;
      await debugLog('Embedding batch progress', {
        provider: 'local',
        batchIndex,
        totalBatches,
        batchSize: batch.length,
      });

      const batchResults = await sidecar.embed(batch);
      results.push(...batchResults);
    }

    return results;
  }
}
