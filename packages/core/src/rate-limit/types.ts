/**
 * Rate Limiter Types
 *
 * Types for rate limiting per agent/key.
 */

// =============================================================================
// Rate Limit Types
// =============================================================================

/**
 * Rate limit window configuration
 */
export interface RateLimitWindow {
  /** Window name */
  name: string;

  /** Window duration in milliseconds */
  duration: number;

  /** Max requests in window */
  maxRequests: number;
}

/**
 * Rate limit bucket (tracks usage in a window)
 */
export interface RateLimitBucket {
  /** Window start timestamp */
  windowStart: number;

  /** Requests in current window */
  count: number;

  /** Tokens used in current window */
  tokens: number;
}

/**
 * Rate limit state for an entity (key or agent)
 */
export interface RateLimitState {
  /** Entity ID (key or agent) */
  entityId: string;

  /** Entity type */
  entityType: "key" | "agent";

  /** Buckets by window name */
  buckets: Record<string, RateLimitBucket>;

  /** Current concurrent requests */
  concurrent: number;

  /** Last updated */
  updatedAt: number;

  /** Token bucket specific state */
  tokenBucketState?: {
    availableTokens: number;
    lastRefill: number;
  };
}

/**
 * Standard rate limit HTTP headers
 */
export interface RateLimitHeaders {
  /** Total requests allowed in the window */
  "X-RateLimit-Limit": string;
  /** Remaining requests in the current window */
  "X-RateLimit-Remaining": string;
  /** Unix timestamp when the window resets */
  "X-RateLimit-Reset": string;
  /** Rate limit policy description */
  "X-RateLimit-Policy"?: string;
  /** Seconds to wait before retrying (when blocked) */
  "Retry-After"?: string;
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  /** Whether request is allowed */
  allowed: boolean;

  /** Reason if not allowed */
  reason?: string;

  /** Which limit was hit */
  limitHit?: "minute" | "hour" | "day" | "tokens" | "concurrent";

  /** Remaining requests in each window */
  remaining: {
    minute: number;
    hour: number;
    day: number;
    tokens: number;
    concurrent: number;
  };

  /** When the limit resets (ms until reset) */
  resetIn?: number;

  /** Retry after (seconds) */
  retryAfter?: number;

  /** Whether this result is a soft limit warning (request allowed but approaching limit) */
  warning?: boolean;

  /** Warning message if in degradation zone */
  warningMessage?: string;

  /** Priority that was applied to this request */
  appliedPriority?: RequestPriority;

  /** Standard rate limit HTTP headers */
  headers?: RateLimitHeaders;
}

// =============================================================================
// Backend Types
// =============================================================================

/** Available backend storage types */
export type BackendType = "memory" | "redis" | "sqlite" | "auto";

/** Redis connection options */
export interface RedisOptions {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  cluster?: boolean;
  sentinels?: Array<{ host: string; port: number }>;
}

// =============================================================================
// Algorithm Types
// =============================================================================

/** Available rate limiting algorithms */
export type AlgorithmType = "sliding-window" | "token-bucket";

/** Token bucket algorithm configuration */
export interface TokenBucketConfig {
  /** Tokens added per second */
  refillRate: number;
  /** Maximum bucket capacity */
  bucketSize: number;
}

// =============================================================================
// Priority Types
// =============================================================================

/** Request priority levels */
export type RequestPriority = "critical" | "high" | "normal" | "low";

/** Priority queuing configuration */
export interface PriorityConfig {
  /** Whether priority queuing is enabled */
  enabled: boolean;
  /** Effective limit multiplier per priority level */
  multipliers: Record<RequestPriority, number>;
  /** Whether critical priority bypasses rate limits entirely */
  criticalBypass: boolean;
}

/** Default priority configuration */
export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  enabled: false,
  multipliers: {
    critical: Infinity,
    high: 2.0,
    normal: 1.0,
    low: 0.5,
  },
  criticalBypass: true,
};

// =============================================================================
// Dynamic Limits Types
// =============================================================================

/** Dynamic limit adjustment configuration */
export interface DynamicLimitsConfig {
  /** Whether dynamic adjustment is enabled */
  enabled: boolean;
  /** Minimum limit multiplier (e.g., 0.5 = can reduce to 50%) */
  minMultiplier: number;
  /** Maximum limit multiplier (e.g., 2.0 = can increase to 200%) */
  maxMultiplier: number;
  /** How often to re-evaluate load (ms) */
  evaluationInterval: number;
  /** Load function returning 0-1 (0=idle, 1=fully loaded) */
  loadFunction?: () => number | Promise<number>;
}

/** Default dynamic limits configuration */
export const DEFAULT_DYNAMIC_LIMITS_CONFIG: DynamicLimitsConfig = {
  enabled: false,
  minMultiplier: 0.5,
  maxMultiplier: 2.0,
  evaluationInterval: 30000,
};

// =============================================================================
// Graceful Degradation Types
// =============================================================================

/** Graceful degradation configuration */
export interface GracefulDegradationConfig {
  /** Whether graceful degradation is enabled */
  enabled: boolean;
  /** Soft limit threshold (0-1). Warnings emitted above this. Default: 0.8 */
  softLimitThreshold: number;
  /** Warning message when in soft limit zone */
  warningMessage?: string;
}

/** Default graceful degradation configuration */
export const DEFAULT_GRACEFUL_DEGRADATION_CONFIG: GracefulDegradationConfig = {
  enabled: false,
  softLimitThreshold: 0.8,
  warningMessage: "Approaching rate limit",
};

// =============================================================================
// Request Info
// =============================================================================

/** Information about a rate limit request */
export interface RequestInfo {
  /** Entity ID (key or agent) */
  entityId: string;
  /** Entity type */
  entityType: "key" | "agent";
  /** Number of tokens for this request */
  tokens?: number;
  /** Request priority level */
  priority?: RequestPriority;
}

// =============================================================================
// Rate Limit Configuration
// =============================================================================

/**
 * Rate limit configuration
 */
export interface RateLimiterConfig {
  /** Per-minute limit */
  requestsPerMinute: number;

  /** Per-hour limit */
  requestsPerHour: number;

  /** Per-day limit */
  requestsPerDay: number;

  /** Max tokens per request */
  maxTokensPerRequest: number;

  /** Max concurrent requests */
  maxConcurrent: number;

  /** Enable burst mode (allow short bursts above limit) */
  burstEnabled?: boolean;

  /** Burst multiplier (e.g., 1.5 = 50% burst) */
  burstMultiplier?: number;

  /** Backend storage type */
  backend?: BackendType;

  /** Redis connection options (when backend is "redis") */
  redisOptions?: RedisOptions;

  /** SQLite database path (when backend is "sqlite") */
  sqlitePath?: string;

  /** Rate limiting algorithm */
  algorithm?: AlgorithmType;

  /** Token bucket configuration (when algorithm is "token-bucket") */
  tokenBucket?: TokenBucketConfig;

  /** Priority queuing configuration */
  priority?: PriorityConfig;

  /** Dynamic limit adjustment configuration */
  dynamicLimits?: DynamicLimitsConfig;

  /** Graceful degradation configuration */
  gracefulDegradation?: GracefulDegradationConfig;
}

// =============================================================================
// Rate Limit Events
// =============================================================================

export type RateLimitEvent =
  | { type: "rate:check"; entityId: string; allowed: boolean }
  | { type: "rate:limited"; entityId: string; limitHit: string; retryAfter: number }
  | { type: "rate:reset"; entityId: string; window: string }
  | { type: "rate:warning"; entityId: string; window: string; percentUsed: number }
  | { type: "rate:backend:connected"; backend: BackendType }
  | { type: "rate:backend:fallback"; from: BackendType; to: BackendType; reason: string }
  | { type: "rate:dynamic:adjusted"; entityId: string; oldMultiplier: number; newMultiplier: number }
  | { type: "rate:priority:bypass"; entityId: string; priority: RequestPriority }
  | { type: "rate:soft-limit"; entityId: string; window: string; percentUsed: number }
  | { type: "rate:state:saved"; entityCount: number }
  | { type: "rate:state:restored"; entityCount: number };

// =============================================================================
// Defaults
// =============================================================================

export const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
  maxTokensPerRequest: 100000,
  maxConcurrent: 5,
  burstEnabled: false,
  burstMultiplier: 1.5,
};

// Window durations
export const RATE_WINDOWS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
} as const;
