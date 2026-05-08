import { SmartSuiteError } from '../errors.js';

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const baseDelay = opts.baseDelayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable =
        err instanceof SmartSuiteError && err.statusCode != null && RETRYABLE_STATUS.has(err.statusCode);
      if (!isRetryable || attempt === opts.maxAttempts - 1) throw err;
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 100;
      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
