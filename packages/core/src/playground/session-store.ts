/**
 * Playground Session Store
 *
 * SQLite-backed session persistence using better-sqlite3.
 * Stores sessions in `.nella/sessions.db` with automatic
 * schema creation and TTL-based cleanup.
 */

import * as path from "path";
import * as fs from "fs";
import type { PlaygroundSession, SessionState } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface SessionStore {
  /** Save or update a session */
  save(session: PlaygroundSession): void;
  /** Load a session by ID */
  load(sessionId: string): PlaygroundSession | null;
  /** Load all sessions for a workspace */
  loadByWorkspace(workspaceId: string): PlaygroundSession[];
  /** Delete a session */
  delete(sessionId: string): void;
  /** Delete expired sessions */
  cleanup(maxAge: number): number;
  /** Close the database */
  close(): void;
}

// =============================================================================
// SQLite Session Store
// =============================================================================

class SqliteSessionStore implements SessionStore {
  private db: any; // better-sqlite3 Database
  private stmts: {
    upsert: any;
    load: any;
    loadByWorkspace: any;
    delete: any;
    cleanup: any;
  };

  constructor(storagePath: string) {
    // Ensure directory exists
    fs.mkdirSync(storagePath, { recursive: true });

    const dbPath = path.join(storagePath, "sessions.db");

    // Dynamic import of better-sqlite3
    let Database: any;
    try {
      Database = require("better-sqlite3");
    } catch {
      throw new Error(
        "Session persistence requires 'better-sqlite3'. " +
        "Install it with: npm install better-sqlite3"
      );
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    this.createSchema();
    this.stmts = this.prepareStatements();
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        state TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_activity TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_workspace
        ON sessions(workspace_id);

      CREATE INDEX IF NOT EXISTS idx_sessions_activity
        ON sessions(last_activity);
    `);
  }

  private prepareStatements(): SqliteSessionStore["stmts"] {
    return {
      upsert: this.db.prepare(`
        INSERT OR REPLACE INTO sessions (id, workspace_id, state, metadata, created_at, last_activity)
        VALUES (@id, @workspaceId, @state, @metadata, @createdAt, @lastActivity)
      `),
      load: this.db.prepare(`
        SELECT * FROM sessions WHERE id = ?
      `),
      loadByWorkspace: this.db.prepare(`
        SELECT * FROM sessions WHERE workspace_id = ? ORDER BY last_activity DESC
      `),
      delete: this.db.prepare(`
        DELETE FROM sessions WHERE id = ?
      `),
      cleanup: this.db.prepare(`
        DELETE FROM sessions WHERE last_activity < ?
      `),
    };
  }

  save(session: PlaygroundSession): void {
    this.stmts.upsert.run({
      id: session.id,
      workspaceId: session.workspaceId,
      state: JSON.stringify(session.state),
      metadata: JSON.stringify(session.metadata),
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
    });
  }

  load(sessionId: string): PlaygroundSession | null {
    const row = this.stmts.load.get(sessionId);
    return row ? this.rowToSession(row) : null;
  }

  loadByWorkspace(workspaceId: string): PlaygroundSession[] {
    const rows = this.stmts.loadByWorkspace.all(workspaceId);
    return rows.map((r: any) => this.rowToSession(r));
  }

  delete(sessionId: string): void {
    this.stmts.delete.run(sessionId);
  }

  cleanup(maxAgeMs: number): number {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const result = this.stmts.cleanup.run(cutoff);
    return result.changes;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Already closed
    }
  }

  private rowToSession(row: any): PlaygroundSession {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      clients: [], // Clients are transient, not persisted
      state: JSON.parse(row.state) as SessionState,
      createdAt: row.created_at,
      lastActivity: row.last_activity,
      metadata: JSON.parse(row.metadata),
    };
  }
}

// =============================================================================
// In-Memory Fallback
// =============================================================================

class InMemorySessionStore implements SessionStore {
  private sessions: Map<string, PlaygroundSession> = new Map();

  save(session: PlaygroundSession): void {
    this.sessions.set(session.id, { ...session });
  }

  load(sessionId: string): PlaygroundSession | null {
    const s = this.sessions.get(sessionId);
    return s ? { ...s } : null;
  }

  loadByWorkspace(workspaceId: string): PlaygroundSession[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.workspaceId === workspaceId)
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  cleanup(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (new Date(session.lastActivity).getTime() < cutoff) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  close(): void {
    this.sessions.clear();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a session store.
 * Attempts SQLite, falls back to in-memory if better-sqlite3 is unavailable.
 */
export function createSessionStore(storagePath: string, logger?: { warn: (msg: string, meta?: any) => void }): SessionStore {
  try {
    return new SqliteSessionStore(storagePath);
  } catch (error) {
    logger?.warn("Session store: falling back to in-memory", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new InMemorySessionStore();
  }
}
