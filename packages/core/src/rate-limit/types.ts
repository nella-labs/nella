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
}

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
}

// =============================================================================
// Rate Limit Events
// =============================================================================

export type RateLimitEvent =
  | { type: "rate:check"; entityId: string; allowed: boolean }
  | { type: "rate:limited"; entityId: string; limitHit: string; retryAfter: number }
  | { type: "rate:reset"; entityId: string; window: string }
  | { type: "rate:warning"; entityId: string; window: string; percentUsed: number };

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
