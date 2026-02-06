/**
 * Rate Limit Headers
 *
 * Generate standard HTTP rate limit headers per IETF draft-ietf-httpapi-ratelimit-headers.
 */

import type { RateLimitResult, RateLimiterConfig, RateLimitHeaders } from "./types";
import { RATE_WINDOWS } from "./types";

/**
 * Generate standard rate limit HTTP headers from a result.
 *
 * @param result - The rate limit check/consume result
 * @param config - The rate limiter config (for limit values)
 * @param primaryWindow - Which window to use for header values (default: "minute")
 */
export function generateHeaders(
  result: RateLimitResult,
  config: RateLimiterConfig,
  primaryWindow: "minute" | "hour" | "day" = "minute",
): RateLimitHeaders {
  const limitMap = {
    minute: config.requestsPerMinute,
    hour: config.requestsPerHour,
    day: config.requestsPerDay,
  };

  const limit = limitMap[primaryWindow];
  const remaining = Math.max(0, result.remaining[primaryWindow]);
  const resetMs = result.resetIn || RATE_WINDOWS[primaryWindow];
  const resetTimestamp = Math.ceil((Date.now() + resetMs) / 1000);

  const headers: RateLimitHeaders = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(resetTimestamp),
    "X-RateLimit-Policy": `${limit};w=${Math.ceil(RATE_WINDOWS[primaryWindow] / 1000)}`,
  };

  if (!result.allowed && result.retryAfter !== undefined) {
    headers["Retry-After"] = String(result.retryAfter);
  }

  return headers;
}
