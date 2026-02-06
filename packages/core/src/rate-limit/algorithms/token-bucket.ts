/**
 * Token Bucket Rate Limit Algorithm
 *
 * Tokens are added at a fixed rate. Each request consumes a token.
 * Allows natural bursting when the bucket is full.
 * Better for smoothing traffic compared to sliding window.
 */

import type {
  RateLimitState,
  RateLimiterConfig,
  RateLimitResult,
  RequestInfo,
} from "../types";
import type { RateLimitAlgorithm } from "./interface";

export class TokenBucketAlgorithm implements RateLimitAlgorithm {
  readonly name = "token-bucket";

  check(
    state: RateLimitState,
    config: RateLimiterConfig,
    request: RequestInfo,
  ): RateLimitResult {
    const tbConfig = config.tokenBucket;
    if (!tbConfig) {
      throw new Error(
        "tokenBucket config is required when using token-bucket algorithm",
      );
    }

    this.updateWindows(state, Date.now());

    // Check concurrent
    if (state.concurrent >= config.maxConcurrent) {
      return this.blocked(state, config, "concurrent");
    }

    const tbState = state.tokenBucketState!;
    const tokensNeeded = request.tokens ? Math.max(1, request.tokens) : 1;

    if (tbState.availableTokens < tokensNeeded) {
      // Calculate when enough tokens will be available
      const tokensDeficit = tokensNeeded - tbState.availableTokens;
      const resetIn = Math.ceil((tokensDeficit / tbConfig.refillRate) * 1000);

      return {
        allowed: false,
        reason: "Token bucket empty",
        limitHit: "minute",
        remaining: {
          minute: Math.floor(tbState.availableTokens),
          hour: Math.floor(tbState.availableTokens),
          day: Math.floor(tbState.availableTokens),
          tokens: config.maxTokensPerRequest,
          concurrent: config.maxConcurrent - state.concurrent,
        },
        resetIn,
        retryAfter: Math.ceil(resetIn / 1000),
      };
    }

    // Check token size limit
    if (request.tokens && request.tokens > config.maxTokensPerRequest) {
      return this.blocked(state, config, "tokens");
    }

    return {
      allowed: true,
      remaining: {
        minute: Math.floor(tbState.availableTokens),
        hour: Math.floor(tbState.availableTokens),
        day: Math.floor(tbState.availableTokens),
        tokens: config.maxTokensPerRequest,
        concurrent: config.maxConcurrent - state.concurrent,
      },
    };
  }

  consume(
    state: RateLimitState,
    config: RateLimiterConfig,
    request: RequestInfo,
  ): RateLimitResult {
    const result = this.check(state, config, request);

    if (result.allowed) {
      const tbState = state.tokenBucketState!;
      const tokensNeeded = request.tokens ? Math.max(1, request.tokens) : 1;

      tbState.availableTokens -= tokensNeeded;
      state.concurrent++;
      state.updatedAt = Date.now();

      // Also track in sliding window buckets for compatibility with getUsage()
      state.buckets.minute.count++;
      state.buckets.hour.count++;
      state.buckets.day.count++;

      if (request.tokens) {
        state.buckets.minute.tokens += request.tokens;
        state.buckets.hour.tokens += request.tokens;
        state.buckets.day.tokens += request.tokens;
      }

      // Return updated remaining
      return {
        allowed: true,
        remaining: {
          minute: Math.floor(tbState.availableTokens),
          hour: Math.floor(tbState.availableTokens),
          day: Math.floor(tbState.availableTokens),
          tokens: config.maxTokensPerRequest,
          concurrent: config.maxConcurrent - state.concurrent,
        },
      };
    }

    return result;
  }

  updateWindows(state: RateLimitState, now: number): void {
    // Initialize token bucket state if missing
    if (!state.tokenBucketState) {
      state.tokenBucketState = {
        availableTokens: 0,
        lastRefill: now,
      };
    }

    const tbState = state.tokenBucketState;
    const elapsed = now - tbState.lastRefill;

    if (elapsed <= 0) return;

    // We need the config's tokenBucket to know refillRate and bucketSize.
    // Since the algorithm doesn't store config, we use a reasonable fallback:
    // The config is passed via check/consume. For updateWindows standalone,
    // we refill based on time elapsed only if we've seen config before.
    // The actual refill happens in the refillTokens method called from check/consume.
    tbState.lastRefill = now;
  }

  /**
   * Refill tokens based on elapsed time.
   * Should be called before check/consume with the config available.
   */
  refillTokens(state: RateLimitState, config: RateLimiterConfig, now: number): void {
    const tbConfig = config.tokenBucket;
    if (!tbConfig) return;

    if (!state.tokenBucketState) {
      state.tokenBucketState = {
        availableTokens: tbConfig.bucketSize,
        lastRefill: now,
      };
      return;
    }

    const tbState = state.tokenBucketState;
    const elapsed = (now - tbState.lastRefill) / 1000; // seconds

    if (elapsed > 0) {
      const tokensToAdd = elapsed * tbConfig.refillRate;
      tbState.availableTokens = Math.min(
        tbConfig.bucketSize,
        tbState.availableTokens + tokensToAdd,
      );
      tbState.lastRefill = now;
    }
  }

  private blocked(
    state: RateLimitState,
    config: RateLimiterConfig,
    limitHit: "minute" | "hour" | "day" | "tokens" | "concurrent",
  ): RateLimitResult {
    let reason: string;
    let resetIn: number;

    switch (limitHit) {
      case "tokens":
        reason = "Token limit exceeded for single request";
        resetIn = 0;
        break;
      case "concurrent":
        reason = "Maximum concurrent requests exceeded";
        resetIn = 1000;
        break;
      default:
        reason = "Rate limit exceeded";
        resetIn = 1000;
        break;
    }

    const tbTokens = state.tokenBucketState
      ? Math.floor(state.tokenBucketState.availableTokens)
      : 0;

    return {
      allowed: false,
      reason,
      limitHit,
      remaining: {
        minute: tbTokens,
        hour: tbTokens,
        day: tbTokens,
        tokens: config.maxTokensPerRequest,
        concurrent: Math.max(0, config.maxConcurrent - state.concurrent),
      },
      resetIn,
      retryAfter: Math.ceil(resetIn / 1000),
    };
  }
}
