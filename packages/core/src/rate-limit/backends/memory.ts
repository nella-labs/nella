/**
 * In-Memory Rate Limit Backend
 *
 * Default backend that stores rate limit state in memory.
 * Supports optional file-based persistence for save/restore across restarts.
 */

import * as fs from "fs";
import * as path from "path";
import type { RateLimitState, RateLimitBucket } from "../types";
import type { RateLimitBackend } from "./interface";

export class MemoryBackend implements RateLimitBackend {
  private states: Map<string, RateLimitState> = new Map();
  private persistPath: string | null = null;

  async getState(entityId: string): Promise<RateLimitState | null> {
    return this.states.get(entityId) || null;
  }

  async setState(entityId: string, state: RateLimitState): Promise<void> {
    this.states.set(entityId, state);
  }

  async deleteState(entityId: string): Promise<void> {
    this.states.delete(entityId);
  }

  async incrementBucket(
    entityId: string,
    window: string,
    amount: number,
  ): Promise<{ newCount: number; windowStart: number }> {
    const state = this.states.get(entityId);
    if (!state || !state.buckets[window]) {
      return { newCount: amount, windowStart: Date.now() };
    }

    const bucket = state.buckets[window];
    bucket.count += amount;
    state.updatedAt = Date.now();

    return { newCount: bucket.count, windowStart: bucket.windowStart };
  }

  async adjustConcurrent(entityId: string, delta: number): Promise<number> {
    const state = this.states.get(entityId);
    if (!state) return 0;

    state.concurrent = Math.max(0, state.concurrent + delta);
    state.updatedAt = Date.now();
    return state.concurrent;
  }

  async getAllEntityIds(): Promise<string[]> {
    return Array.from(this.states.keys());
  }

  isAvailable(): boolean {
    return true;
  }

  async cleanup(maxAge: number): Promise<number> {
    const cutoff = Date.now() - maxAge;
    let removed = 0;

    for (const [id, state] of this.states.entries()) {
      if (state.updatedAt < cutoff && state.concurrent === 0) {
        this.states.delete(id);
        removed++;
      }
    }

    return removed;
  }

  async exportState(): Promise<Map<string, RateLimitState>> {
    return new Map(this.states);
  }

  async importState(states: Map<string, RateLimitState>): Promise<void> {
    for (const [id, state] of states) {
      this.states.set(id, state);
    }
  }

  async destroy(): Promise<void> {
    if (this.persistPath) {
      await this.save();
    }
    this.states.clear();
  }

  /**
   * Initialize file-based persistence.
   * State will be loaded from disk and saved on destroy().
   */
  initPersistence(filePath: string): void {
    this.persistPath = filePath;
    this.loadFromDisk();
  }

  /** Save current state to disk */
  async save(): Promise<void> {
    if (!this.persistPath) return;

    const dir = path.dirname(this.persistPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data: Record<string, RateLimitState> = {};
    for (const [id, state] of this.states) {
      data[id] = state;
    }

    fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2), "utf-8");
  }

  /** Load state from disk */
  private loadFromDisk(): void {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;

    try {
      const raw = fs.readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as Record<string, RateLimitState>;

      for (const [id, state] of Object.entries(data)) {
        this.states.set(id, state);
      }
    } catch {
      // Ignore corrupted files
    }
  }
}
