/**
 * MCP Retry Logic
 *
 * Exponential backoff with jitter for transient failures.
 */

import { RetryExhaustedError } from "./errors";

// =============================================================================
// Types
// =============================================================================

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in ms (default: 1000) */
  baseDelay: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelay: number;
  /** Predicate to determine if an error is retryable */
  retryable?: (error: Error) => boolean;
  /** Callback on each retry attempt */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

export interface RetryResult<T> {
  result: T;
  attempts: number;
  totalDelay: number;
}

// =============================================================================
// Default Options
// =============================================================================

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  retryable: isTransientError,
};

// =============================================================================
// Retry Function
// =============================================================================

/**
 * Execute a function with exponential backoff retry.
 *
 * Delay formula: min(baseDelay * 2^attempt + jitter, maxDelay)
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;
  let totalDelay = 0;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, attempts: attempt + 1, totalDelay };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if we've exhausted attempts
      if (attempt >= opts.maxRetries) break;

      // Don't retry non-retryable errors
      if (opts.retryable && !opts.retryable(lastError)) break;

      // Calculate delay with exponential backoff + jitter
      const exponentialDelay = opts.baseDelay * Math.pow(2, attempt);
      const jitter = Math.random() * opts.baseDelay * 0.5;
      const delay = Math.min(exponentialDelay + jitter, opts.maxDelay);

      totalDelay += delay;

      // Notify callback
      if (opts.onRetry) {
        opts.onRetry(attempt + 1, lastError, delay);
      }

      // Wait
      await sleep(delay);
    }
  }

  throw new RetryExhaustedError(opts.maxRetries + 1, lastError!);
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Default predicate for transient errors.
 * Retries on network errors, timeouts, and 5xx-like messages.
 */
function isTransientError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Network errors
  if (
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("epipe") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("fetch failed") ||
    message.includes("network")
  ) {
    return true;
  }

  // Server errors
  if (
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("internal server error") ||
    message.includes("service unavailable") ||
    message.includes("gateway timeout")
  ) {
    return true;
  }

  // Rate limiting (should not normally hit here, but safety net)
  if (message.includes("429") || message.includes("too many requests")) {
    return true;
  }

  // Timeout-style errors
  if (message.includes("timeout") || message.includes("timed out")) {
    return true;
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
