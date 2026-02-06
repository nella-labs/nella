/**
 * Rate Limit Algorithms
 *
 * Factory and exports for rate limiting algorithms.
 */

export type { RateLimitAlgorithm } from "./interface";
export { SlidingWindowAlgorithm } from "./sliding-window";
export { TokenBucketAlgorithm } from "./token-bucket";

import type { AlgorithmType } from "../types";
import type { RateLimitAlgorithm } from "./interface";
import { SlidingWindowAlgorithm } from "./sliding-window";
import { TokenBucketAlgorithm } from "./token-bucket";

/**
 * Create a rate limit algorithm by type.
 */
export function createAlgorithm(type: AlgorithmType = "sliding-window"): RateLimitAlgorithm {
  switch (type) {
    case "token-bucket":
      return new TokenBucketAlgorithm();
    case "sliding-window":
    default:
      return new SlidingWindowAlgorithm();
  }
}
