/**
 * Rate Limit Module
 *
 * Per-agent and per-key rate limiting with pluggable backends,
 * algorithms, priority handling, and graceful degradation.
 */

// Types
export type {
  RateLimitWindow,
  RateLimitBucket,
  RateLimitState,
  RateLimitResult,
  RateLimiterConfig,
  RateLimitEvent,
  RateLimitHeaders,
  BackendType,
  RedisOptions,
  AlgorithmType,
  TokenBucketConfig,
  RequestPriority,
  PriorityConfig,
  DynamicLimitsConfig,
  GracefulDegradationConfig,
  RequestInfo,
} from "./types";

export {
  DEFAULT_RATE_LIMITER_CONFIG,
  DEFAULT_PRIORITY_CONFIG,
  DEFAULT_DYNAMIC_LIMITS_CONFIG,
  DEFAULT_GRACEFUL_DEGRADATION_CONFIG,
  RATE_WINDOWS,
} from "./types";

// Limiter
export {
  RateLimiter,
  createRateLimiter,
  getRateLimiter,
  type RateLimitEventHandler,
} from "./limiter";

// Backends
export type { RateLimitBackend } from "./backends/interface";
export { MemoryBackend } from "./backends/memory";
export { RedisBackend } from "./backends/redis";
export { SQLiteBackend } from "./backends/sqlite";
export { createBackend } from "./backends";

// Algorithms
export type { RateLimitAlgorithm } from "./algorithms/interface";
export { SlidingWindowAlgorithm } from "./algorithms/sliding-window";
export { TokenBucketAlgorithm } from "./algorithms/token-bucket";
export { createAlgorithm } from "./algorithms";

// Headers
export { generateHeaders } from "./headers";

// Priority
export { PriorityHandler } from "./priority";

// Dynamic Limits
export { DynamicLimitAdjuster } from "./dynamic-limits";
