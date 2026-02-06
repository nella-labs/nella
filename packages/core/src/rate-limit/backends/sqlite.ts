/**
 * SQLite Rate Limit Backend
 *
 * Persistent rate limiting using SQLite.
 * State survives process restarts.
 * Requires optional dependency: better-sqlite3
 */

import type { RateLimitState } from "../types";
import type { RateLimitBackend } from "./interface";

export class SQLiteBackend implements RateLimitBackend {
  private db: any = null;
  private available: boolean = false;
  private stmts: {
    getState?: any;
    setState?: any;
    deleteState?: any;
    getAllIds?: any;
    cleanup?: any;
    getAll?: any;
  } = {};

  constructor(dbPath: string) {
    this.init(dbPath);
  }

  private init(dbPath: string): void {
    try {
      const Database = require("better-sqlite3");
      this.db = new Database(dbPath);
      this.db.pragma("journal_mode = WAL");
      this.createTables();
      this.prepareStatements();
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limit_state (
        entity_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        state_json TEXT NOT NULL,
        concurrent INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rate_limit_updated
        ON rate_limit_state(updated_at);
    `);
  }

  private prepareStatements(): void {
    this.stmts.getState = this.db.prepare(
      "SELECT state_json FROM rate_limit_state WHERE entity_id = ?",
    );
    this.stmts.setState = this.db.prepare(`
      INSERT OR REPLACE INTO rate_limit_state (entity_id, entity_type, state_json, concurrent, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.stmts.deleteState = this.db.prepare(
      "DELETE FROM rate_limit_state WHERE entity_id = ?",
    );
    this.stmts.getAllIds = this.db.prepare(
      "SELECT entity_id FROM rate_limit_state",
    );
    this.stmts.cleanup = this.db.prepare(
      "DELETE FROM rate_limit_state WHERE updated_at < ? AND concurrent = 0",
    );
    this.stmts.getAll = this.db.prepare(
      "SELECT entity_id, state_json FROM rate_limit_state",
    );
  }

  async getState(entityId: string): Promise<RateLimitState | null> {
    if (!this.available) return null;

    try {
      const row = this.stmts.getState.get(entityId);
      if (!row) return null;
      return JSON.parse(row.state_json) as RateLimitState;
    } catch {
      return null;
    }
  }

  async setState(entityId: string, state: RateLimitState): Promise<void> {
    if (!this.available) return;

    try {
      this.stmts.setState.run(
        entityId,
        state.entityType,
        JSON.stringify(state),
        state.concurrent,
        state.updatedAt,
      );
    } catch {
      // Silently fail
    }
  }

  async deleteState(entityId: string): Promise<void> {
    if (!this.available) return;

    try {
      this.stmts.deleteState.run(entityId);
    } catch {
      // Silently fail
    }
  }

  async incrementBucket(
    entityId: string,
    window: string,
    amount: number,
  ): Promise<{ newCount: number; windowStart: number }> {
    if (!this.available) {
      return { newCount: amount, windowStart: Date.now() };
    }

    try {
      const state = await this.getState(entityId);
      if (!state || !state.buckets[window]) {
        return { newCount: amount, windowStart: Date.now() };
      }

      const bucket = state.buckets[window];
      bucket.count += amount;
      state.updatedAt = Date.now();
      await this.setState(entityId, state);

      return { newCount: bucket.count, windowStart: bucket.windowStart };
    } catch {
      return { newCount: amount, windowStart: Date.now() };
    }
  }

  async adjustConcurrent(entityId: string, delta: number): Promise<number> {
    if (!this.available) return 0;

    try {
      const state = await this.getState(entityId);
      if (!state) return 0;

      state.concurrent = Math.max(0, state.concurrent + delta);
      state.updatedAt = Date.now();
      await this.setState(entityId, state);

      return state.concurrent;
    } catch {
      return 0;
    }
  }

  async getAllEntityIds(): Promise<string[]> {
    if (!this.available) return [];

    try {
      const rows = this.stmts.getAllIds.all();
      return rows.map((r: any) => r.entity_id);
    } catch {
      return [];
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  async cleanup(maxAge: number): Promise<number> {
    if (!this.available) return 0;

    try {
      const cutoff = Date.now() - maxAge;
      const result = this.stmts.cleanup.run(cutoff);
      return result.changes;
    } catch {
      return 0;
    }
  }

  async exportState(): Promise<Map<string, RateLimitState>> {
    const result = new Map<string, RateLimitState>();
    if (!this.available) return result;

    try {
      const rows = this.stmts.getAll.all();
      for (const row of rows) {
        result.set(row.entity_id, JSON.parse(row.state_json));
      }
    } catch {
      // Return what we have
    }

    return result;
  }

  async importState(states: Map<string, RateLimitState>): Promise<void> {
    if (!this.available) return;

    const insertMany = this.db.transaction(
      (entries: [string, RateLimitState][]) => {
        for (const [entityId, state] of entries) {
          this.stmts.setState.run(
            entityId,
            state.entityType,
            JSON.stringify(state),
            state.concurrent,
            state.updatedAt,
          );
        }
      },
    );

    insertMany(Array.from(states.entries()));
  }

  async destroy(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Already closed
      }
      this.db = null;
      this.available = false;
    }
  }
}
