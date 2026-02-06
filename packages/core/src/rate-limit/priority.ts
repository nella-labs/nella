/**
 * Priority Handler
 *
 * Manages request priority levels and adjusts effective rate limits
 * based on priority. Critical requests can bypass limits entirely.
 */

import type {
  RateLimiterConfig,
  PriorityConfig,
  RequestPriority,
} from "./types";
import { DEFAULT_PRIORITY_CONFIG } from "./types";

export class PriorityHandler {
  private config: PriorityConfig;

  constructor(config?: Partial<PriorityConfig>) {
    this.config = { ...DEFAULT_PRIORITY_CONFIG, ...config };
  }

  /** Whether priority handling is enabled */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if a priority level should bypass rate limits entirely.
   */
  shouldBypass(priority: RequestPriority): boolean {
    if (!this.config.enabled) return false;
    return priority === "critical" && this.config.criticalBypass;
  }

  /**
   * Get effective rate limit config adjusted for the given priority level.
   * Higher priority -> higher limits (via multiplier).
   */
  getEffectiveConfig(
    baseConfig: RateLimiterConfig,
    priority: RequestPriority = "normal",
  ): RateLimiterConfig {
    if (!this.config.enabled) return baseConfig;

    const multiplier = this.config.multipliers[priority];

    if (!isFinite(multiplier)) {
      // Infinite multiplier (critical) - set very high limits
      return {
        ...baseConfig,
        requestsPerMinute: Number.MAX_SAFE_INTEGER,
        requestsPerHour: Number.MAX_SAFE_INTEGER,
        requestsPerDay: Number.MAX_SAFE_INTEGER,
      };
    }

    return {
      ...baseConfig,
      requestsPerMinute: Math.floor(baseConfig.requestsPerMinute * multiplier),
      requestsPerHour: Math.floor(baseConfig.requestsPerHour * multiplier),
      requestsPerDay: Math.floor(baseConfig.requestsPerDay * multiplier),
    };
  }

  /** Update priority configuration */
  setConfig(config: Partial<PriorityConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
