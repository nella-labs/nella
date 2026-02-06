/**
 * Rate Limit Backend Interface
 *
 * Abstracts the storage layer for rate limit state.
 * Implementations: MemoryBackend (default), RedisBackend, SQLiteBackend
 */

import type { RateLimitState } from "../types";

export interface RateLimitBackend {
  /** Get state for an entity */
  getState(entityId: string): Promise<RateLimitState | null>;

  /** Set state for an entity */
  setState(entityId: string, state: RateLimitState): Promise<void>;

  /** Delete state for an entity */
  deleteState(entityId: string): Promise<void>;

  /** Atomic increment of a bucket count */
  incrementBucket(
    entityId: string,
    window: string,
    amount: number,
  ): Promise<{ newCount: number; windowStart: number }>;

  /** Atomic increment/decrement of concurrent count */
  adjustConcurrent(entityId: string, delta: number): Promise<number>;

  /** Get all entity IDs (for cleanup) */
  getAllEntityIds(): Promise<string[]>;

  /** Check if backend is available and connected */
  isAvailable(): boolean;

  /** Cleanup stale entries older than maxAge ms. Returns number of entries removed. */
  cleanup(maxAge: number): Promise<number>;

  /** Export all state for persistence/migration */
  exportState(): Promise<Map<string, RateLimitState>>;

  /** Import state for restore */
  importState(states: Map<string, RateLimitState>): Promise<void>;

  /** Destroy/disconnect the backend */
  destroy(): Promise<void>;
}
