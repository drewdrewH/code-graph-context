/**
 * Retry utilities with exponential backoff
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/prefer-nullish-coalescing */
export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  shouldRetry?: (error: any) => boolean;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  shouldRetry: (error: any) => {
    // Retry on rate limits and transient errors
    return (
      error.status === 429 ||
      error.code === 'ETIMEDOUT' ||
      error.message?.includes('timeout') ||
      error.message?.includes('ECONNRESET')
    );
  },
};

/**
 * Execute a function with automatic retry and exponential backoff.
 * @param fn The async function to execute
 * @param options Retry configuration options
 * @returns The result of the function
 */
export const withRetry = async <T>(fn: () => Promise<T>, options: Partial<RetryOptions> = {}): Promise<T> => {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: any;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt === opts.maxRetries || !opts.shouldRetry?.(error)) {
        throw error;
      }

      // Exponential backoff with jitter
      const delay = Math.min(opts.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000, opts.maxDelayMs);

      console.warn(
        `Retry attempt ${attempt + 1}/${opts.maxRetries} after ${Math.round(delay)}ms. Error: ${error.message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
};
