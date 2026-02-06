/**
 * Rate Limit Algorithm Interface
 *
 * Abstracts the rate limiting algorithm.
 * Implementations: SlidingWindowAlgorithm (default), TokenBucketAlgorithm (new)
 */

import type {
  RateLimitState,
  RateLimiterConfig,
  RateLimitResult,
  RequestInfo,
} from "../types";

export interface RateLimitAlgorithm {
  /** Algorithm name */
  readonly name: string;

  /** Check if a request would be allowed (read-only) */
  check(
    state: RateLimitState,
    config: RateLimiterConfig,
    request: RequestInfo,
  ): RateLimitResult;

  /** Record a consumed request (mutates state) */
  consume(
    state: RateLimitState,
    config: RateLimiterConfig,
    request: RequestInfo,
  ): RateLimitResult;

  /** Update/expire windows (called periodically and before checks) */
  updateWindows(state: RateLimitState, now: number): void;
}
