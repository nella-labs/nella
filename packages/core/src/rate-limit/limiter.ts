/**
 * Rate Limiter
 *
 * Orchestrates rate limiting with pluggable backends, algorithms,
 * priority handling, dynamic limits, and graceful degradation.
 * Backward compatible with the original in-memory sliding window API.
 */

import type {
  RateLimitState,
  RateLimitResult,
  RateLimiterConfig,
  RateLimitEvent,
  RequestInfo,
  GracefulDegradationConfig,
} from "./types";
import {
  DEFAULT_RATE_LIMITER_CONFIG,
  DEFAULT_GRACEFUL_DEGRADATION_CONFIG,
  RATE_WINDOWS,
} from "./types";
import type { RateLimitBackend } from "./backends/interface";
import { createBackend, MemoryBackend } from "./backends";
import type { RateLimitAlgorithm } from "./algorithms/interface";
import { createAlgorithm, TokenBucketAlgorithm } from "./algorithms";
import { generateHeaders } from "./headers";
import { PriorityHandler } from "./priority";
import { DynamicLimitAdjuster } from "./dynamic-limits";

// =============================================================================
// Types
// =============================================================================

export type RateLimitEventHandler = (event: RateLimitEvent) => void;

// =============================================================================
// Rate Limiter Class
// =============================================================================

export class RateLimiter {
  private backend: RateLimitBackend;
  private algorithm: RateLimitAlgorithm;
  private priorityHandler: PriorityHandler;
  private dynamicAdjuster: DynamicLimitAdjuster;
  private configs: Map<string, RateLimiterConfig> = new Map();
  private defaultConfig: RateLimiterConfig;
  private eventHandlers: RateLimitEventHandler[] = [];
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private degradationConfig: GracefulDegradationConfig;

  // Keep a local state cache for synchronous access (backward compat)
  private stateCache: Map<string, RateLimitState> = new Map();

  constructor(defaultConfig?: Partial<RateLimiterConfig>) {
    this.defaultConfig = { ...DEFAULT_RATE_LIMITER_CONFIG, ...defaultConfig };

    // Initialize backend
    this.backend = createBackend({
      type: this.defaultConfig.backend || "memory",
      redisOptions: this.defaultConfig.redisOptions,
      sqlitePath: this.defaultConfig.sqlitePath,
      onEvent: (event) => this.emit(event),
    });

    // Initialize algorithm
    this.algorithm = createAlgorithm(this.defaultConfig.algorithm);

    // Initialize priority handler
    this.priorityHandler = new PriorityHandler(this.defaultConfig.priority);

    // Initialize dynamic adjuster
    this.dynamicAdjuster = new DynamicLimitAdjuster(this.defaultConfig.dynamicLimits);
    this.dynamicAdjuster.onEvent((event) => this.emit(event));

    // Graceful degradation config
    this.degradationConfig = {
      ...DEFAULT_GRACEFUL_DEGRADATION_CONFIG,
      ...this.defaultConfig.gracefulDegradation,
    };

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
   * Get config for entity (or default), with dynamic adjustment applied
   */
  getConfig(entityId: string): RateLimiterConfig {
    const base = this.configs.get(entityId) || this.defaultConfig;
    return this.dynamicAdjuster.getAdjustedConfig(base);
  }

  /**
   * Remove entity config
   */
  removeConfig(entityId: string): void {
    this.configs.delete(entityId);
  }

  // =============================================================================
  // Synchronous Rate Limiting (backward compatible API)
  // =============================================================================

  /**
   * Check if request is allowed (doesn't consume).
   * Uses local state cache for synchronous access.
   */
  check(request: RequestInfo): RateLimitResult {
    const state = this.getOrCreateStateSync(request);
    const config = this.getEffectiveConfig(request);

    // Priority bypass
    if (request.priority && this.priorityHandler.shouldBypass(request.priority)) {
      this.emit({
        type: "rate:priority:bypass",
        entityId: request.entityId,
        priority: request.priority,
      });
      const result = this.buildAllowedResult(state, config);
      result.appliedPriority = request.priority;
      result.headers = generateHeaders(result, config);
      return result;
    }

    // Refill tokens if using token bucket
    if (this.algorithm instanceof TokenBucketAlgorithm) {
      this.algorithm.refillTokens(state, config, Date.now());
    }

    let result = this.algorithm.check(state, config, request);

    // Apply graceful degradation
    result = this.applyGracefulDegradation(result, state, config, request);

    // Attach priority and headers
    if (request.priority) {
      result.appliedPriority = request.priority;
    }
    result.headers = generateHeaders(result, config);

    return result;
  }

  /**
   * Consume a request (check + record).
   * Uses local state cache for synchronous access.
   */
  consume(request: RequestInfo): RateLimitResult {
    const state = this.getOrCreateStateSync(request);
    const config = this.getEffectiveConfig(request);

    // Priority bypass
    if (request.priority && this.priorityHandler.shouldBypass(request.priority)) {
      this.emit({
        type: "rate:priority:bypass",
        entityId: request.entityId,
        priority: request.priority,
      });
      state.concurrent++;
      state.updatedAt = Date.now();
      state.buckets.minute.count++;
      state.buckets.hour.count++;
      state.buckets.day.count++;
      this.syncToBackend(request.entityId, state);

      const result = this.buildAllowedResult(state, config);
      result.appliedPriority = request.priority;
      result.headers = generateHeaders(result, config);
      this.emit({ type: "rate:check", entityId: request.entityId, allowed: true });
      return result;
    }

    // Refill tokens if using token bucket
    if (this.algorithm instanceof TokenBucketAlgorithm) {
      this.algorithm.refillTokens(state, config, Date.now());
    }

    let result = this.algorithm.consume(state, config, request);

    // Apply graceful degradation
    result = this.applyGracefulDegradation(result, state, config, request);

    if (result.allowed) {
      this.syncToBackend(request.entityId, state);
      this.checkWarnings(state, config);

      if (request.priority) {
        result.appliedPriority = request.priority;
      }
      result.headers = generateHeaders(result, config);
      this.emit({ type: "rate:check", entityId: request.entityId, allowed: true });
    } else {
      if (request.priority) {
        result.appliedPriority = request.priority;
      }
      result.headers = generateHeaders(result, config);
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
    const state = this.stateCache.get(entityId);
    if (state && state.concurrent > 0) {
      state.concurrent--;
      state.updatedAt = Date.now();
      this.syncToBackend(entityId, state);
    }
  }

  // =============================================================================
  // Async Rate Limiting (for distributed backends like Redis)
  // =============================================================================

  /**
   * Check if request is allowed (async version for distributed backends).
   */
  async checkAsync(request: RequestInfo): Promise<RateLimitResult> {
    const state = await this.getOrCreateStateAsync(request);
    const config = this.getEffectiveConfig(request);

    if (request.priority && this.priorityHandler.shouldBypass(request.priority)) {
      this.emit({
        type: "rate:priority:bypass",
        entityId: request.entityId,
        priority: request.priority,
      });
      const result = this.buildAllowedResult(state, config);
      result.appliedPriority = request.priority;
      result.headers = generateHeaders(result, config);
      return result;
    }

    if (this.algorithm instanceof TokenBucketAlgorithm) {
      this.algorithm.refillTokens(state, config, Date.now());
    }

    let result = this.algorithm.check(state, config, request);
    result = this.applyGracefulDegradation(result, state, config, request);

    if (request.priority) {
      result.appliedPriority = request.priority;
    }
    result.headers = generateHeaders(result, config);

    return result;
  }

  /**
   * Consume a request (async version for distributed backends).
   */
  async consumeAsync(request: RequestInfo): Promise<RateLimitResult> {
    const state = await this.getOrCreateStateAsync(request);
    const config = this.getEffectiveConfig(request);

    if (request.priority && this.priorityHandler.shouldBypass(request.priority)) {
      this.emit({
        type: "rate:priority:bypass",
        entityId: request.entityId,
        priority: request.priority,
      });
      state.concurrent++;
      state.updatedAt = Date.now();
      state.buckets.minute.count++;
      state.buckets.hour.count++;
      state.buckets.day.count++;
      await this.backend.setState(request.entityId, state);

      const result = this.buildAllowedResult(state, config);
      result.appliedPriority = request.priority;
      result.headers = generateHeaders(result, config);
      this.emit({ type: "rate:check", entityId: request.entityId, allowed: true });
      return result;
    }

    if (this.algorithm instanceof TokenBucketAlgorithm) {
      this.algorithm.refillTokens(state, config, Date.now());
    }

    let result = this.algorithm.consume(state, config, request);
    result = this.applyGracefulDegradation(result, state, config, request);

    if (result.allowed) {
      await this.backend.setState(request.entityId, state);
      this.checkWarnings(state, config);

      if (request.priority) {
        result.appliedPriority = request.priority;
      }
      result.headers = generateHeaders(result, config);
      this.emit({ type: "rate:check", entityId: request.entityId, allowed: true });
    } else {
      if (request.priority) {
        result.appliedPriority = request.priority;
      }
      result.headers = generateHeaders(result, config);
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
   * Release a concurrent slot (async version)
   */
  async releaseAsync(entityId: string): Promise<void> {
    const state = await this.backend.getState(entityId);
    if (state && state.concurrent > 0) {
      state.concurrent--;
      state.updatedAt = Date.now();
      await this.backend.setState(entityId, state);
    }
  }

  // =============================================================================
  // Usage & State
  // =============================================================================

  /**
   * Get current usage for entity (synchronous, uses local cache)
   */
  getUsage(entityId: string): {
    minute: { count: number; limit: number };
    hour: { count: number; limit: number };
    day: { count: number; limit: number };
    concurrent: { count: number; limit: number };
  } | null {
    const state = this.stateCache.get(entityId);
    if (!state) return null;

    const config = this.getConfig(entityId);
    this.algorithm.updateWindows(state, Date.now());

    return {
      minute: { count: state.buckets.minute.count, limit: config.requestsPerMinute },
      hour: { count: state.buckets.hour.count, limit: config.requestsPerHour },
      day: { count: state.buckets.day.count, limit: config.requestsPerDay },
      concurrent: { count: state.concurrent, limit: config.maxConcurrent },
    };
  }

  /**
   * Get current usage for entity (async, reads from backend)
   */
  async getUsageAsync(entityId: string): Promise<{
    minute: { count: number; limit: number };
    hour: { count: number; limit: number };
    day: { count: number; limit: number };
    concurrent: { count: number; limit: number };
  } | null> {
    const state = await this.backend.getState(entityId);
    if (!state) return null;

    const config = this.getConfig(entityId);
    this.algorithm.updateWindows(state, Date.now());

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
    this.stateCache.delete(entityId);
    this.backend.deleteState(entityId);
    this.emit({ type: "rate:reset", entityId, window: "all" });
  }

  /**
   * Save all state (for persistence across restarts)
   */
  async saveState(): Promise<void> {
    // Sync local cache to backend first
    for (const [entityId, state] of this.stateCache) {
      await this.backend.setState(entityId, state);
    }

    // If using MemoryBackend with persistence, trigger file save
    if (this.backend instanceof MemoryBackend) {
      await this.backend.save();
    }

    const states = await this.backend.exportState();
    this.emit({ type: "rate:state:saved", entityCount: states.size });
  }

  /**
   * Load state from persistence
   */
  async loadState(states: Map<string, RateLimitState>): Promise<void> {
    await this.backend.importState(states);

    // Update local cache
    for (const [entityId, state] of states) {
      this.stateCache.set(entityId, state);
    }

    this.emit({ type: "rate:state:restored", entityCount: states.size });
  }

  /**
   * Get the current backend instance
   */
  getBackend(): RateLimitBackend {
    return this.backend;
  }

  /**
   * Get the current algorithm instance
   */
  getAlgorithm(): RateLimitAlgorithm {
    return this.algorithm;
  }

  // =============================================================================
  // Lifecycle
  // =============================================================================

  /**
   * Stop cleanup interval and destroy backend
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.dynamicAdjuster.destroy();
    this.backend.destroy();
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private getEffectiveConfig(request: RequestInfo): RateLimiterConfig {
    let config = this.getConfig(request.entityId);

    if (request.priority) {
      config = this.priorityHandler.getEffectiveConfig(config, request.priority);
    }

    return config;
  }

  private getOrCreateStateSync(request: RequestInfo): RateLimitState {
    let state = this.stateCache.get(request.entityId);

    if (!state) {
      state = this.createNewState(request);
      this.stateCache.set(request.entityId, state);
      this.syncToBackend(request.entityId, state);
    }

    return state;
  }

  private async getOrCreateStateAsync(request: RequestInfo): Promise<RateLimitState> {
    let state = await this.backend.getState(request.entityId);

    if (!state) {
      state = this.createNewState(request);
      await this.backend.setState(request.entityId, state);
    }

    // Update local cache
    this.stateCache.set(request.entityId, state);
    return state;
  }

  private createNewState(request: RequestInfo): RateLimitState {
    const now = Date.now();
    const state: RateLimitState = {
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

    // Initialize token bucket state if using token bucket algorithm
    const config = this.getConfig(request.entityId);
    if (config.algorithm === "token-bucket" && config.tokenBucket) {
      state.tokenBucketState = {
        availableTokens: config.tokenBucket.bucketSize,
        lastRefill: now,
      };
    }

    return state;
  }

  private syncToBackend(entityId: string, state: RateLimitState): void {
    // Fire-and-forget sync to backend
    this.backend.setState(entityId, state).catch(() => {
      // Silently fail - local cache is source of truth for sync API
    });
  }

  private buildAllowedResult(
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

  private applyGracefulDegradation(
    result: RateLimitResult,
    state: RateLimitState,
    config: RateLimiterConfig,
    request: RequestInfo,
  ): RateLimitResult {
    if (!this.degradationConfig.enabled) return result;

    if (result.allowed) {
      const threshold = this.degradationConfig.softLimitThreshold;

      const minutePercent = state.buckets.minute.count / config.requestsPerMinute;
      const hourPercent = state.buckets.hour.count / config.requestsPerHour;
      const dayPercent = state.buckets.day.count / config.requestsPerDay;

      const maxPercent = Math.max(minutePercent, hourPercent, dayPercent);

      if (maxPercent >= threshold) {
        result.warning = true;
        result.warningMessage = this.degradationConfig.warningMessage;

        let warningWindow = "minute";
        if (hourPercent === maxPercent) warningWindow = "hour";
        if (dayPercent === maxPercent) warningWindow = "day";

        this.emit({
          type: "rate:soft-limit",
          entityId: request.entityId,
          window: warningWindow,
          percentUsed: maxPercent * 100,
        });
      }
    }

    return result;
  }

  private checkWarnings(state: RateLimitState, config: RateLimiterConfig): void {
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
    // Clean local cache
    const cutoff = Date.now() - RATE_WINDOWS.hour;
    for (const [id, state] of this.stateCache.entries()) {
      if (state.updatedAt < cutoff && state.concurrent === 0) {
        this.stateCache.delete(id);
      }
    }

    // Clean backend
    this.backend.cleanup(RATE_WINDOWS.hour);
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
