/**
 * Sliding Window Rate Limit Algorithm
 *
 * Fixed window algorithm that resets counters when the window expires.
 * Extracted from the original limiter.ts implementation.
 */

import type {
  RateLimitState,
  RateLimiterConfig,
  RateLimitResult,
  RequestInfo,
} from "../types";
import { RATE_WINDOWS } from "../types";
import type { RateLimitAlgorithm } from "./interface";

export class SlidingWindowAlgorithm implements RateLimitAlgorithm {
  readonly name = "sliding-window";

  check(
    state: RateLimitState,
    config: RateLimiterConfig,
    request: RequestInfo,
  ): RateLimitResult {
    this.updateWindows(state, Date.now());

    // Check concurrent
    if (state.concurrent >= config.maxConcurrent) {
      return this.blocked(state, config, "concurrent");
    }

    // Check minute limit
    if (state.buckets.minute.count >= config.requestsPerMinute) {
      return this.blocked(state, config, "minute");
    }

    // Check hour limit
    if (state.buckets.hour.count >= config.requestsPerHour) {
      return this.blocked(state, config, "hour");
    }

    // Check day limit
    if (state.buckets.day.count >= config.requestsPerDay) {
      return this.blocked(state, config, "day");
    }

    // Check tokens if provided
    if (request.tokens && request.tokens > config.maxTokensPerRequest) {
      return this.blocked(state, config, "tokens");
    }

    return this.allowed(state, config);
  }

  consume(
    state: RateLimitState,
    config: RateLimiterConfig,
    request: RequestInfo,
  ): RateLimitResult {
    const result = this.check(state, config, request);

    if (result.allowed) {
      const now = Date.now();

      state.buckets.minute.count++;
      state.buckets.hour.count++;
      state.buckets.day.count++;
      state.concurrent++;
      state.updatedAt = now;

      if (request.tokens) {
        state.buckets.minute.tokens += request.tokens;
        state.buckets.hour.tokens += request.tokens;
        state.buckets.day.tokens += request.tokens;
      }

      // Return updated remaining counts
      return this.allowed(state, config);
    }

    return result;
  }

  updateWindows(state: RateLimitState, now: number): void {
    for (const [window, duration] of Object.entries(RATE_WINDOWS)) {
      const bucket = state.buckets[window];
      if (bucket && now - bucket.windowStart >= duration) {
        bucket.windowStart = now;
        bucket.count = 0;
        bucket.tokens = 0;
      }
    }
  }

  private allowed(
    state: RateLimitState,
    config: RateLimiterConfig,
  ): RateLimitResult {
    return {
      allowed: true,
      remaining: {
        minute: config.requestsPerMinute - state.buckets.minute.count,
        hour: config.requestsPerHour - state.buckets.hour.count,
        day: config.requestsPerDay - state.buckets.day.count,
        tokens: config.maxTokensPerRequest,
        concurrent: config.maxConcurrent - state.concurrent,
      },
    };
  }

  private blocked(
    state: RateLimitState,
    config: RateLimiterConfig,
    limitHit: "minute" | "hour" | "day" | "tokens" | "concurrent",
  ): RateLimitResult {
    let reason: string;
    let resetIn: number;
    const now = Date.now();

    switch (limitHit) {
      case "minute":
        reason = "Per-minute rate limit exceeded";
        resetIn = RATE_WINDOWS.minute - (now - state.buckets.minute.windowStart);
        break;
      case "hour":
        reason = "Per-hour rate limit exceeded";
        resetIn = RATE_WINDOWS.hour - (now - state.buckets.hour.windowStart);
        break;
      case "day":
        reason = "Per-day rate limit exceeded";
        resetIn = RATE_WINDOWS.day - (now - state.buckets.day.windowStart);
        break;
      case "tokens":
        reason = "Token limit exceeded for single request";
        resetIn = 0;
        break;
      case "concurrent":
        reason = "Maximum concurrent requests exceeded";
        resetIn = 1000;
        break;
    }

    return {
      allowed: false,
      reason,
      limitHit,
      remaining: {
        minute: Math.max(0, config.requestsPerMinute - state.buckets.minute.count),
        hour: Math.max(0, config.requestsPerHour - state.buckets.hour.count),
        day: Math.max(0, config.requestsPerDay - state.buckets.day.count),
        tokens: config.maxTokensPerRequest,
        concurrent: Math.max(0, config.maxConcurrent - state.concurrent),
      },
      resetIn,
      retryAfter: Math.ceil(resetIn / 1000),
    };
  }
}
