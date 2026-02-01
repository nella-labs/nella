/**
 * Rate Limiter
 *
 * In-memory rate limiter with sliding window algorithm.
 * Supports per-key and per-agent limits.
 */

import type {
  RateLimitState,
  RateLimitResult,
  RateLimiterConfig,
  RateLimitEvent,
  RateLimitBucket,
} from "./types";
import { DEFAULT_RATE_LIMITER_CONFIG, RATE_WINDOWS } from "./types";

// =============================================================================
// Types
// =============================================================================

export type RateLimitEventHandler = (event: RateLimitEvent) => void;

interface RequestInfo {
  entityId: string;
  entityType: "key" | "agent";
  tokens?: number;
}

// =============================================================================
// Rate Limiter Class
// =============================================================================

export class RateLimiter {
  private states: Map<string, RateLimitState> = new Map();
  private configs: Map<string, RateLimiterConfig> = new Map();
  private defaultConfig: RateLimiterConfig;
  private eventHandlers: RateLimitEventHandler[] = [];
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(defaultConfig?: Partial<RateLimiterConfig>) {
    this.defaultConfig = { ...DEFAULT_RATE_LIMITER_CONFIG, ...defaultConfig };
    
    // Start cleanup interval (every minute)
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  onEvent(handler: RateLimitEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: RateLimitEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Rate limit event handler error:", error);
      }
    }
  }

  // =============================================================================
  // Configuration
  // =============================================================================

  /**
   * Set config for specific entity
   */
  setConfig(entityId: string, config: Partial<RateLimiterConfig>): void {
    const existing = this.configs.get(entityId) || this.defaultConfig;
    this.configs.set(entityId, { ...existing, ...config });
  }

  /**
   * Get config for entity (or default)
   */
  getConfig(entityId: string): RateLimiterConfig {
    return this.configs.get(entityId) || this.defaultConfig;
  }

  /**
   * Remove entity config
   */
  removeConfig(entityId: string): void {
    this.configs.delete(entityId);
  }

  // =============================================================================
  // Rate Limiting
  // =============================================================================

  /**
   * Check if request is allowed (doesn't consume)
   */
  check(request: RequestInfo): RateLimitResult {
    const state = this.getOrCreateState(request);
    const config = this.getConfig(request.entityId);
    const now = Date.now();

    // Update buckets
    this.updateBuckets(state, now);

    // Check concurrent
    if (state.concurrent >= config.maxConcurrent) {
      return this.blocked(state, config, "concurrent");
    }

    // Check minute limit
    const minuteBucket = state.buckets.minute;
    if (minuteBucket.count >= config.requestsPerMinute) {
      return this.blocked(state, config, "minute");
    }

    // Check hour limit
    const hourBucket = state.buckets.hour;
    if (hourBucket.count >= config.requestsPerHour) {
      return this.blocked(state, config, "hour");
    }

    // Check day limit
    const dayBucket = state.buckets.day;
    if (dayBucket.count >= config.requestsPerDay) {
      return this.blocked(state, config, "day");
    }

    // Check tokens if provided
    if (request.tokens && request.tokens > config.maxTokensPerRequest) {
      return this.blocked(state, config, "tokens");
    }

    return this.allowed(state, config);
  }

  /**
   * Consume a request (check + record)
   */
  consume(request: RequestInfo): RateLimitResult {
    const result = this.check(request);

    if (result.allowed) {
      const state = this.getOrCreateState(request);
      const now = Date.now();

      // Increment counters
      state.buckets.minute.count++;
      state.buckets.hour.count++;
      state.buckets.day.count++;
      state.concurrent++;
      state.updatedAt = now;

      // Track tokens
      if (request.tokens) {
        state.buckets.minute.tokens += request.tokens;
        state.buckets.hour.tokens += request.tokens;
        state.buckets.day.tokens += request.tokens;
      }

      this.states.set(request.entityId, state);

      // Emit warning if approaching limit
      this.checkWarnings(state, this.getConfig(request.entityId));

      this.emit({ type: "rate:check", entityId: request.entityId, allowed: true });
    } else {
      this.emit({
        type: "rate:limited",
        entityId: request.entityId,
        limitHit: result.limitHit || "unknown",
        retryAfter: result.retryAfter || 0,
      });
    }

    return result;
  }

  /**
   * Release a concurrent slot
   */
  release(entityId: string): void {
    const state = this.states.get(entityId);
    if (state && state.concurrent > 0) {
      state.concurrent--;
      state.updatedAt = Date.now();
    }
  }

  /**
   * Get current usage for entity
   */
  getUsage(entityId: string): {
    minute: { count: number; limit: number };
    hour: { count: number; limit: number };
    day: { count: number; limit: number };
    concurrent: { count: number; limit: number };
  } | null {
    const state = this.states.get(entityId);
    if (!state) return null;

    const config = this.getConfig(entityId);

    // Update buckets first
    this.updateBuckets(state, Date.now());

    return {
      minute: { count: state.buckets.minute.count, limit: config.requestsPerMinute },
      hour: { count: state.buckets.hour.count, limit: config.requestsPerHour },
      day: { count: state.buckets.day.count, limit: config.requestsPerDay },
      concurrent: { count: state.concurrent, limit: config.maxConcurrent },
    };
  }

  /**
   * Reset limits for entity
   */
  reset(entityId: string): void {
    this.states.delete(entityId);
    this.emit({ type: "rate:reset", entityId, window: "all" });
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private getOrCreateState(request: RequestInfo): RateLimitState {
    let state = this.states.get(request.entityId);

    if (!state) {
      const now = Date.now();
      state = {
        entityId: request.entityId,
        entityType: request.entityType,
        buckets: {
          minute: { windowStart: now, count: 0, tokens: 0 },
          hour: { windowStart: now, count: 0, tokens: 0 },
          day: { windowStart: now, count: 0, tokens: 0 },
        },
        concurrent: 0,
        updatedAt: now,
      };
      this.states.set(request.entityId, state);
    }

    return state;
  }

  private updateBuckets(state: RateLimitState, now: number): void {
    // Reset buckets if window has passed
    for (const [window, duration] of Object.entries(RATE_WINDOWS)) {
      const bucket = state.buckets[window];
      if (now - bucket.windowStart >= duration) {
        // Window expired, reset
        bucket.windowStart = now;
        bucket.count = 0;
        bucket.tokens = 0;

        this.emit({ type: "rate:reset", entityId: state.entityId, window });
      }
    }
  }

  private allowed(state: RateLimitState, config: RateLimiterConfig): RateLimitResult {
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
    limitHit: "minute" | "hour" | "day" | "tokens" | "concurrent"
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
        resetIn = 1000; // Wait 1 second
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

  private checkWarnings(state: RateLimitState, config: RateLimiterConfig): void {
    // Warn at 80% usage
    const threshold = 0.8;

    const minutePercent = state.buckets.minute.count / config.requestsPerMinute;
    if (minutePercent >= threshold) {
      this.emit({
        type: "rate:warning",
        entityId: state.entityId,
        window: "minute",
        percentUsed: minutePercent * 100,
      });
    }

    const hourPercent = state.buckets.hour.count / config.requestsPerHour;
    if (hourPercent >= threshold) {
      this.emit({
        type: "rate:warning",
        entityId: state.entityId,
        window: "hour",
        percentUsed: hourPercent * 100,
      });
    }
  }

  private cleanup(): void {
    // Remove stale states (no activity for > 1 hour)
    const cutoff = Date.now() - RATE_WINDOWS.hour;
    for (const [id, state] of this.states.entries()) {
      if (state.updatedAt < cutoff && state.concurrent === 0) {
        this.states.delete(id);
      }
    }
  }

  /**
   * Stop cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiter {
  return new RateLimiter(config);
}

// =============================================================================
// Singleton
// =============================================================================

let defaultLimiter: RateLimiter | null = null;

export function getRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiter {
  if (!defaultLimiter) {
    defaultLimiter = new RateLimiter(config);
  }
  return defaultLimiter;
}
