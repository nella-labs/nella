/**
 * Dynamic Limit Adjuster
 *
 * Periodically evaluates system load and adjusts rate limits accordingly.
 * High load -> more restrictive limits, low load -> more permissive limits.
 */

import type {
  RateLimiterConfig,
  DynamicLimitsConfig,
  RateLimitEvent,
} from "./types";
import { DEFAULT_DYNAMIC_LIMITS_CONFIG } from "./types";

export type DynamicLimitEventHandler = (event: RateLimitEvent) => void;

export class DynamicLimitAdjuster {
  private config: DynamicLimitsConfig;
  private currentMultiplier: number = 1.0;
  private evaluationTimer: ReturnType<typeof setInterval> | null = null;
  private eventHandler: DynamicLimitEventHandler | null = null;

  constructor(config?: Partial<DynamicLimitsConfig>) {
    this.config = { ...DEFAULT_DYNAMIC_LIMITS_CONFIG, ...config };
    if (this.config.enabled) {
      this.startEvaluation();
    }
  }

  /** Whether dynamic adjustment is enabled */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Current load multiplier (1.0 = normal) */
  get multiplier(): number {
    return this.currentMultiplier;
  }

  /** Set event handler for dynamic adjustment events */
  onEvent(handler: DynamicLimitEventHandler): void {
    this.eventHandler = handler;
  }

  /**
   * Get adjusted config based on current load.
   * Multiplier < 1 = more restrictive, > 1 = more permissive.
   */
  getAdjustedConfig(baseConfig: RateLimiterConfig): RateLimiterConfig {
    if (!this.config.enabled || this.currentMultiplier === 1.0) {
      return baseConfig;
    }

    return {
      ...baseConfig,
      requestsPerMinute: Math.max(1, Math.floor(baseConfig.requestsPerMinute * this.currentMultiplier)),
      requestsPerHour: Math.max(1, Math.floor(baseConfig.requestsPerHour * this.currentMultiplier)),
      requestsPerDay: Math.max(1, Math.floor(baseConfig.requestsPerDay * this.currentMultiplier)),
    };
  }

  /** Manually set the multiplier (useful for testing) */
  setMultiplier(multiplier: number): void {
    const clamped = Math.max(
      this.config.minMultiplier,
      Math.min(this.config.maxMultiplier, multiplier),
    );
    const old = this.currentMultiplier;
    this.currentMultiplier = clamped;

    if (old !== clamped && this.eventHandler) {
      this.eventHandler({
        type: "rate:dynamic:adjusted",
        entityId: "*",
        oldMultiplier: old,
        newMultiplier: clamped,
      });
    }
  }

  /** Update configuration */
  setConfig(config: Partial<DynamicLimitsConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...config };

    if (this.config.enabled && !wasEnabled) {
      this.startEvaluation();
    } else if (!this.config.enabled && wasEnabled) {
      this.stopEvaluation();
    }
  }

  /** Stop the evaluation interval and clean up */
  destroy(): void {
    this.stopEvaluation();
  }

  private startEvaluation(): void {
    if (this.evaluationTimer) return;

    this.evaluationTimer = setInterval(
      () => this.evaluate(),
      this.config.evaluationInterval,
    );
  }

  private stopEvaluation(): void {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
  }

  private async evaluate(): Promise<void> {
    if (!this.config.loadFunction) return;

    try {
      const load = await this.config.loadFunction();
      // Clamp load to 0-1
      const clampedLoad = Math.max(0, Math.min(1, load));

      // High load -> lower multiplier (more restrictive)
      // Low load -> higher multiplier (more permissive)
      // Linear interpolation: load=0 -> maxMultiplier, load=1 -> minMultiplier
      const newMultiplier =
        this.config.maxMultiplier -
        clampedLoad * (this.config.maxMultiplier - this.config.minMultiplier);

      this.setMultiplier(newMultiplier);
    } catch {
      // If load function fails, keep current multiplier
    }
  }
}
