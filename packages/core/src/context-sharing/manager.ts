/**
 * Context Manager
 *
 * Cross-agent context sharing backed by SQLite (better-sqlite3, WAL mode).
 *
 * Features:
 *   1. SQLite persistence (replaces JSON file store)
 *   2. Context versioning (history + rollback)
 *   3. Optimistic concurrency via etag
 *   4. Pub/sub through pluggable transports
 *   5. Full-text + fuzzy search
 *   6. Hand-written context schemas (no zod)
 *   7. AES-256-GCM encryption (same pattern as key-manager.ts)
 *   8. Cross-workspace queries + configurable expiration
 *   9. Import/export snapshots
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type Database from "better-sqlite3";
import type {
  ContextEntry,
  ContextType,
  ContextVisibility,
  ContextChannel,
  ContextQuery,
  ContextQueryResult,
  ContextEvent,
  ContextVersion,
  ContextSchema,
  ContextSearchOptions,
  ContextSnapshot,
  ImportStrategy,
  CodeSnippetContext,
  DecisionContext,
  DependencyContext,
} from "./types";
import {
  DEFAULT_CHANNEL_SETTINGS,
  DEFAULT_CONTEXT_TTL,
  DEFAULT_MAX_VERSIONS,
  DEFAULT_CLEANUP_INTERVAL_MS,
  DEFAULT_EXPIRING_WARNING_MS,
} from "./types";
import { ContextConflictError, ContextValidationError } from "./errors";
import type { ContextTransport, ChannelHandler, ContextMessage } from "./transports";
import { LocalTransport } from "./transports";

// =============================================================================
// Constants
// =============================================================================

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SCHEMA_VERSION = "2.0.0"; // SQLite schema version
const SNAPSHOT_FORMAT_VERSION = "1.0.0";

// =============================================================================
// Types
// =============================================================================

export interface SetContextOptions {
  key: string;
  value: unknown;
  type?: ContextType;
  sourceAgentId: string;
  workspaceId: string;
  tags?: string[];
  visibility?: ContextVisibility;
  ttl?: number;
  channelId?: string;
  /** Provide the expected etag for optimistic concurrency (optional) */
  expectedEtag?: string;
  /** Encrypt this entry's value (requires encryptionKey in ContextManagerOptions) */
  encrypt?: boolean;
}

export interface ContextManagerOptions {
  /** Directory where context.db will be created */
  storagePath: string;
  /** Maximum version history entries per context key (default 50) */
  maxVersions?: number;
  /** Cleanup interval in ms (default 5 min) */
  cleanupIntervalMs?: number;
  /** Warning window before expiry in ms (default 60 s) */
  expiringWarningMs?: number;
  /** Transport for pub/sub (default: LocalTransport) */
  transport?: ContextTransport;
  /** Base64-encoded 32-byte AES-256 encryption key */
  encryptionKey?: string;
}

export type ContextEventHandler = (event: ContextEvent) => void;

// =============================================================================
// Context Manager Class
// =============================================================================

export class ContextManager {
  private db!: Database.Database;
  private dbPath: string;
  private eventHandlers: ContextEventHandler[] = [];
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private schemas: ContextSchema[] = [];
  private transport: ContextTransport;
  private encryptionKey: Buffer | null = null;
  private maxVersions: number;
  private expiringWarningMs: number;

  // Prepared statements (lazy-initialised in initDatabase)
  private stmts!: {
    upsertEntry: Database.Statement;
    getByKey: Database.Statement;
    getById: Database.Statement;
    deleteById: Database.Statement;
    deleteByKey: Database.Statement;
    clearWorkspace: Database.Statement;
    updateAccess: Database.Statement;
    insertVersion: Database.Statement;
    getVersions: Database.Statement;
    pruneVersions: Database.Statement;
    insertChannel: Database.Statement;
    getChannel: Database.Statement;
    listChannels: Database.Statement;
    deleteChannel: Database.Statement;
    countChannelEntries: Database.Statement;
    getExpired: Database.Statement;
    deleteExpired: Database.Statement;
    getExpiring: Database.Statement;
  };

  constructor(options: ContextManagerOptions) {
    const {
      storagePath,
      maxVersions: mv,
      cleanupIntervalMs,
      expiringWarningMs: ew,
      transport,
      encryptionKey,
    } = options;

    this.maxVersions = mv ?? DEFAULT_MAX_VERSIONS;
    this.expiringWarningMs = ew ?? DEFAULT_EXPIRING_WARNING_MS;
    this.transport = transport ?? new LocalTransport();

    // Encryption key
    if (encryptionKey) {
      this.encryptionKey = Buffer.from(encryptionKey, "base64");
      if (this.encryptionKey.length !== 32) {
        throw new Error(`Encryption key must be 32 bytes. Got ${this.encryptionKey.length} bytes.`);
      }
    }

    // Ensure directory
    this.dbPath = path.join(storagePath, "context.db");
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.initDatabase();

    // Start periodic cleanup
    const interval = cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.cleanupInterval = setInterval(() => this.cleanup(), interval);
  }

  // =============================================================================
  // Database Initialisation
  // =============================================================================

  private initDatabase(): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");
    this.db = new BetterSqlite3(this.dbPath);

    // WAL mode for concurrent reads
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS context_entries (
        id            TEXT PRIMARY KEY,
        key           TEXT NOT NULL,
        value         TEXT NOT NULL,
        type          TEXT NOT NULL,
        source_agent  TEXT NOT NULL,
        workspace_id  TEXT NOT NULL,
        tags          TEXT NOT NULL DEFAULT '[]',
        visibility    TEXT NOT NULL DEFAULT 'workspace',
        ttl           INTEGER NOT NULL DEFAULT 0,
        etag          TEXT NOT NULL,
        encrypted     INTEGER NOT NULL DEFAULT 0,
        channel_id    TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        expires_at    TEXT,
        access_count  INTEGER NOT NULL DEFAULT 0,
        last_accessed_by TEXT,
        UNIQUE(key, workspace_id)
      );

      CREATE TABLE IF NOT EXISTS context_versions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id      TEXT NOT NULL,
        value         TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        updated_by    TEXT NOT NULL,
        FOREIGN KEY (entry_id) REFERENCES context_entries(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS context_channels (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        description     TEXT NOT NULL DEFAULT '',
        workspace_id    TEXT NOT NULL,
        allowed_agents  TEXT NOT NULL DEFAULT '[]',
        max_entries     INTEGER NOT NULL DEFAULT 1000,
        default_ttl     INTEGER NOT NULL DEFAULT 3600,
        auto_cleanup    INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT NOT NULL,
        entry_count     INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS context_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_entries_workspace ON context_entries(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_entries_key ON context_entries(key);
      CREATE INDEX IF NOT EXISTS idx_entries_channel ON context_entries(channel_id);
      CREATE INDEX IF NOT EXISTS idx_entries_expires ON context_entries(expires_at);
      CREATE INDEX IF NOT EXISTS idx_entries_type ON context_entries(type);
      CREATE INDEX IF NOT EXISTS idx_versions_entry ON context_versions(entry_id);
      CREATE INDEX IF NOT EXISTS idx_channels_workspace ON context_channels(workspace_id);
    `);

    // Store schema version
    this.db
      .prepare("INSERT OR REPLACE INTO context_meta (key, value) VALUES ('schema_version', ?)")
      .run(SCHEMA_VERSION);

    // Prepare statements
    this.stmts = {
      upsertEntry: this.db.prepare(`
        INSERT INTO context_entries (id, key, value, type, source_agent, workspace_id, tags, visibility, ttl, etag, encrypted, channel_id, created_at, updated_at, expires_at, access_count, last_accessed_by)
        VALUES (@id, @key, @value, @type, @sourceAgent, @workspaceId, @tags, @visibility, @ttl, @etag, @encrypted, @channelId, @createdAt, @updatedAt, @expiresAt, @accessCount, @lastAccessedBy)
        ON CONFLICT(key, workspace_id) DO UPDATE SET
          value = @value,
          type = @type,
          tags = @tags,
          visibility = @visibility,
          ttl = @ttl,
          etag = @etag,
          encrypted = @encrypted,
          channel_id = @channelId,
          updated_at = @updatedAt,
          expires_at = @expiresAt
      `),
      getByKey: this.db.prepare(
        "SELECT * FROM context_entries WHERE key = ? AND workspace_id = ? AND (expires_at IS NULL OR expires_at > ?)"
      ),
      getById: this.db.prepare(
        "SELECT * FROM context_entries WHERE id = ? AND (expires_at IS NULL OR expires_at > ?)"
      ),
      deleteById: this.db.prepare("DELETE FROM context_entries WHERE id = ?"),
      deleteByKey: this.db.prepare(
        "DELETE FROM context_entries WHERE key = ? AND workspace_id = ?"
      ),
      clearWorkspace: this.db.prepare("DELETE FROM context_entries WHERE workspace_id = ?"),
      updateAccess: this.db.prepare(
        "UPDATE context_entries SET access_count = access_count + 1, last_accessed_by = ? WHERE id = ?"
      ),
      insertVersion: this.db.prepare(
        "INSERT INTO context_versions (entry_id, value, updated_at, updated_by) VALUES (?, ?, ?, ?)"
      ),
      getVersions: this.db.prepare(
        "SELECT value, updated_at, updated_by FROM context_versions WHERE entry_id = ? ORDER BY id DESC LIMIT ?"
      ),
      pruneVersions: this.db.prepare(`
        DELETE FROM context_versions WHERE entry_id = ? AND id NOT IN (
          SELECT id FROM context_versions WHERE entry_id = ? ORDER BY id DESC LIMIT ?
        )
      `),
      insertChannel: this.db.prepare(`
        INSERT INTO context_channels (id, name, description, workspace_id, allowed_agents, max_entries, default_ttl, auto_cleanup, created_at, entry_count)
        VALUES (@id, @name, @description, @workspaceId, @allowedAgents, @maxEntries, @defaultTtl, @autoCleanup, @createdAt, @entryCount)
      `),
      getChannel: this.db.prepare("SELECT * FROM context_channels WHERE id = ?"),
      listChannels: this.db.prepare("SELECT * FROM context_channels WHERE workspace_id = ?"),
      deleteChannel: this.db.prepare("DELETE FROM context_channels WHERE id = ?"),
      countChannelEntries: this.db.prepare(
        "SELECT COUNT(*) AS cnt FROM context_entries WHERE channel_id = ?"
      ),
      getExpired: this.db.prepare(
        "SELECT id FROM context_entries WHERE expires_at IS NOT NULL AND expires_at <= ?"
      ),
      deleteExpired: this.db.prepare(
        "DELETE FROM context_entries WHERE expires_at IS NOT NULL AND expires_at <= ?"
      ),
      getExpiring: this.db.prepare(
        "SELECT id, expires_at FROM context_entries WHERE expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?"
      ),
    };
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  onEvent(handler: ContextEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: ContextEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Context event handler error:", error);
      }
    }
  }

  // =============================================================================
  // Context Operations
  // =============================================================================

  /**
   * Set context entry (upsert).
   * Supports optimistic concurrency (expectedEtag), schema validation,
   * encryption, versioning, and pub/sub broadcast.
   */
  set(options: SetContextOptions): ContextEntry {
    const now = new Date().toISOString();
    const ttl = options.ttl ?? DEFAULT_CONTEXT_TTL;
    const serialised = JSON.stringify(options.value);
    const newEtag = crypto.createHash("sha256").update(serialised).digest("hex").slice(0, 16);

    // --- Schema validation ---
    this.validateAgainstSchemas(options.key, options.value);

    // --- Optimistic concurrency ---
    const existing = this.db
      .prepare("SELECT id, etag, created_at, access_count FROM context_entries WHERE key = ? AND workspace_id = ?")
      .get(options.key, options.workspaceId) as
      | { id: string; etag: string; created_at: string; access_count: number }
      | undefined;

    if (options.expectedEtag && existing && existing.etag !== options.expectedEtag) {
      this.emit({
        type: "context:conflict",
        key: options.key,
        storedEtag: existing.etag,
        expectedEtag: options.expectedEtag,
      });
      throw new ContextConflictError(options.key, existing.etag, options.expectedEtag);
    }

    // --- Encryption ---
    let storedValue = serialised;
    const encrypted = !!(options.encrypt && this.encryptionKey);
    if (encrypted) {
      storedValue = this.encrypt(serialised);
    }

    const id = existing ? existing.id : `ctx_${crypto.randomBytes(8).toString("hex")}`;
    const createdAt = existing ? existing.created_at : now;
    const accessCount = existing ? existing.access_count : 0;
    const expiresAt = ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null;

    // --- Version snapshot (before overwrite) ---
    if (existing) {
      const oldRow = this.db
        .prepare("SELECT value, updated_at, source_agent FROM context_entries WHERE id = ?")
        .get(existing.id) as { value: string; updated_at: string; source_agent: string } | undefined;
      if (oldRow) {
        this.stmts.insertVersion.run(existing.id, oldRow.value, oldRow.updated_at, oldRow.source_agent);
        this.stmts.pruneVersions.run(existing.id, existing.id, this.maxVersions);
      }
    }

    // --- Upsert ---
    this.stmts.upsertEntry.run({
      id,
      key: options.key,
      value: storedValue,
      type: options.type || this.inferType(options.value),
      sourceAgent: options.sourceAgentId,
      workspaceId: options.workspaceId,
      tags: JSON.stringify(options.tags || []),
      visibility: options.visibility || "workspace",
      ttl,
      etag: newEtag,
      encrypted: encrypted ? 1 : 0,
      channelId: options.channelId || null,
      createdAt,
      updatedAt: now,
      expiresAt,
      accessCount,
      lastAccessedBy: null,
    });

    const entry = this.rowToEntry(
      this.stmts.getById.get(id, now) as EntryRow
    );

    this.emit({ type: "context:set", entry });

    // --- Pub/sub broadcast ---
    if (entry.channelId) {
      const msg: ContextMessage = {
        type: "context:set",
        channel: entry.channelId,
        entry,
        timestamp: now,
      };
      this.transport.publish(entry.channelId, msg);
      this.emit({ type: "context:channel_message", channel: entry.channelId, entryId: entry.id });
    }

    return entry;
  }

  /**
   * Get context by key
   */
  get(key: string, workspaceId: string, agentId?: string): ContextEntry | null {
    const now = new Date().toISOString();
    const row = this.stmts.getByKey.get(key, workspaceId, now) as EntryRow | undefined;
    if (!row) return null;

    const entry = this.rowToEntry(row);
    if (!this.canAccess(entry, agentId)) return null;

    this.stmts.updateAccess.run(agentId || null, entry.id);
    this.emit({ type: "context:get", entryId: entry.id, agentId: agentId || "unknown" });

    entry.metadata.accessCount++;
    entry.metadata.lastAccessedBy = agentId || null;
    return entry;
  }

  /**
   * Get context by ID
   */
  getById(id: string, agentId?: string): ContextEntry | null {
    const now = new Date().toISOString();
    const row = this.stmts.getById.get(id, now) as EntryRow | undefined;
    if (!row) return null;

    const entry = this.rowToEntry(row);
    if (!this.canAccess(entry, agentId)) return null;

    this.stmts.updateAccess.run(agentId || null, entry.id);
    entry.metadata.accessCount++;
    entry.metadata.lastAccessedBy = agentId || null;
    return entry;
  }

  /**
   * Query context entries
   */
  query(workspaceId: string, query: ContextQuery, agentId?: string): ContextQueryResult {
    const now = new Date().toISOString();
    const clauses: string[] = ["workspace_id = ?"];
    const params: unknown[] = [workspaceId];

    if (!query.includeExpired) {
      clauses.push("(expires_at IS NULL OR expires_at > ?)");
      params.push(now);
    }

    if (query.keyPattern) {
      // Convert wildcard to SQL LIKE pattern
      clauses.push("key LIKE ?");
      params.push(query.keyPattern.replace(/\*/g, "%"));
    }
    if (query.types && query.types.length > 0) {
      clauses.push(`type IN (${query.types.map(() => "?").join(",")})`);
      params.push(...query.types);
    }
    if (query.sourceAgentId) {
      clauses.push("source_agent = ?");
      params.push(query.sourceAgentId);
    }
    if (query.visibility) {
      clauses.push("visibility = ?");
      params.push(query.visibility);
    }
    if (query.channelId) {
      clauses.push("channel_id = ?");
      params.push(query.channelId);
    }

    const orderBy = query.orderBy || "updatedAt";
    const colMap: Record<string, string> = {
      createdAt: "created_at",
      updatedAt: "updated_at",
      accessCount: "access_count",
    };
    const orderCol = colMap[orderBy] || "updated_at";
    const order = query.order || "desc";
    const limit = query.limit || 100;

    const where = clauses.join(" AND ");
    const sql = `SELECT * FROM context_entries WHERE ${where} ORDER BY ${orderCol} ${order} LIMIT ?`;
    params.push(limit + 1); // +1 to detect hasMore

    const rows = this.db.prepare(sql).all(...params) as EntryRow[];

    let entries = rows.map((r) => this.rowToEntry(r));
    // Access-filter
    entries = entries.filter((e) => this.canAccess(e, agentId));
    // Tag filter (in-memory — tags stored as JSON array)
    if (query.tags && query.tags.length > 0) {
      entries = entries.filter((e) => query.tags!.some((t) => e.tags.includes(t)));
    }

    const hasMore = entries.length > limit;
    if (hasMore) entries = entries.slice(0, limit);

    return { entries, total: entries.length, hasMore };
  }

  /**
   * Query across ALL workspaces (visibility >= 'shared' only)
   */
  queryGlobal(query: ContextQuery, agentId?: string): ContextQueryResult {
    const now = new Date().toISOString();
    const clauses: string[] = ["visibility IN ('shared', 'global')"];
    const params: unknown[] = [];

    if (!query.includeExpired) {
      clauses.push("(expires_at IS NULL OR expires_at > ?)");
      params.push(now);
    }
    if (query.keyPattern) {
      clauses.push("key LIKE ?");
      params.push(query.keyPattern.replace(/\*/g, "%"));
    }
    if (query.types && query.types.length > 0) {
      clauses.push(`type IN (${query.types.map(() => "?").join(",")})`);
      params.push(...query.types);
    }

    const limit = query.limit || 100;
    const where = clauses.join(" AND ");
    const sql = `SELECT * FROM context_entries WHERE ${where} ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit + 1);

    const rows = this.db.prepare(sql).all(...params) as EntryRow[];
    let entries = rows.map((r) => this.rowToEntry(r));
    entries = entries.filter((e) => this.canAccess(e, agentId));
    const hasMore = entries.length > limit;
    if (hasMore) entries = entries.slice(0, limit);

    return { entries, total: entries.length, hasMore };
  }

  /**
   * Delete context by ID
   */
  delete(id: string): boolean {
    const changes = this.stmts.deleteById.run(id).changes;
    if (changes === 0) return false;

    this.emit({ type: "context:delete", entryId: id });
    return true;
  }

  /**
   * Delete by key
   */
  deleteByKey(key: string, workspaceId: string): boolean {
    const row = this.stmts.getByKey.get(key, workspaceId, new Date().toISOString()) as
      | EntryRow
      | undefined;
    if (!row) return false;
    return this.delete(row.id);
  }

  /**
   * Clear all context for workspace
   */
  clearWorkspace(workspaceId: string): number {
    return this.stmts.clearWorkspace.run(workspaceId).changes;
  }

  // =============================================================================
  // Versioning
  // =============================================================================

  /**
   * Get version history for an entry
   */
  getHistory(entryId: string, limit?: number): ContextVersion[] {
    const rows = this.stmts.getVersions.all(entryId, limit ?? this.maxVersions) as {
      value: string;
      updated_at: string;
      updated_by: string;
    }[];

    return rows.map((r) => ({
      value: this.safeParse(r.value),
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
    }));
  }

  /**
   * Rollback an entry to a previous version (by zero-based index from getHistory)
   */
  rollback(entryId: string, versionIndex: number, agentId: string): ContextEntry | null {
    const history = this.getHistory(entryId);
    if (versionIndex < 0 || versionIndex >= history.length) return null;

    const row = this.stmts.getById.get(entryId, new Date().toISOString()) as EntryRow | undefined;
    if (!row) return null;

    const target = history[versionIndex];
    return this.set({
      key: row.key,
      value: target.value,
      type: row.type as ContextType,
      sourceAgentId: agentId,
      workspaceId: row.workspace_id,
      tags: this.safeParse(row.tags) as string[],
      visibility: row.visibility as ContextVisibility,
      ttl: row.ttl,
      channelId: row.channel_id || undefined,
    });
  }

  // =============================================================================
  // Search
  // =============================================================================

  /**
   * Search context values (substring, regex, or fuzzy)
   */
  searchValues(pattern: string, options: ContextSearchOptions): ContextEntry[] {
    const queryOpts: ContextQuery = {
      types: options.types,
      tags: options.tags,
      includeExpired: false,
      limit: options.limit || 100,
    };

    const result = this.query(options.workspaceId, queryOpts);
    let entries = result.entries;

    if (options.fuzzy) {
      // Jaro-Winkler distance via `natural` (already a dependency)
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { JaroWinklerDistance } = require("natural") as typeof import("natural");
        const threshold = options.fuzzyThreshold ?? 0.8;
        entries = entries.filter((e) => {
          const text = typeof e.value === "string" ? e.value : JSON.stringify(e.value);
          return (JaroWinklerDistance as (s1: string, s2: string) => number)(pattern, text) >= threshold;
        });
      } catch {
        // natural not available, fall back to substring
        entries = entries.filter((e) => {
          const text = typeof e.value === "string" ? e.value : JSON.stringify(e.value);
          return text.toLowerCase().includes(pattern.toLowerCase());
        });
      }
    } else if (options.regex) {
      const re = new RegExp(pattern, "i");
      entries = entries.filter((e) => {
        const text = typeof e.value === "string" ? e.value : JSON.stringify(e.value);
        return re.test(text);
      });
    } else {
      const lowerPattern = pattern.toLowerCase();
      entries = entries.filter((e) => {
        const text = typeof e.value === "string" ? e.value : JSON.stringify(e.value);
        return text.toLowerCase().includes(lowerPattern);
      });
    }

    return entries;
  }

  // =============================================================================
  // Schemas
  // =============================================================================

  /**
   * Register a schema for context validation
   */
  registerSchema(schema: ContextSchema): void {
    this.schemas.push(schema);
  }

  /**
   * Remove a schema by key pattern
   */
  removeSchema(keyPattern: string): boolean {
    const before = this.schemas.length;
    this.schemas = this.schemas.filter((s) => s.keyPattern !== keyPattern);
    return this.schemas.length < before;
  }

  /**
   * List registered schema patterns
   */
  listSchemaPatterns(): string[] {
    return this.schemas.map((s) => s.keyPattern);
  }

  /**
   * Validate a value against matching schemas
   */
  private validateAgainstSchemas(key: string, value: unknown): void {
    for (const schema of this.schemas) {
      if (this.matchesPattern(key, schema.keyPattern)) {
        const result = schema.validate(value);
        if (!result.valid) {
          this.emit({ type: "context:validation_failed", key, issues: result.issues });
          throw new ContextValidationError(key, result.issues);
        }
      }
    }
  }

  private matchesPattern(key: string, pattern: string): boolean {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$", "i");
    return regex.test(key);
  }

  // =============================================================================
  // Encryption
  // =============================================================================

  /**
   * Encrypt plaintext using AES-256-GCM (same pattern as key-manager.ts)
   */
  private encrypt(plaintext: string): string {
    if (!this.encryptionKey) return plaintext;

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    let encrypted = cipher.update(plaintext, "utf8", "base64");
    encrypted += cipher.final("base64");
    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted
    return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
  }

  /**
   * Decrypt ciphertext
   */
  private decrypt(ciphertext: string): string {
    if (!this.encryptionKey) return ciphertext;
    if (!ciphertext.includes(":")) return ciphertext;

    const [ivBase64, authTagBase64, encrypted] = ciphertext.split(":");
    if (!ivBase64 || !authTagBase64 || !encrypted) return ciphertext;

    const iv = Buffer.from(ivBase64, "base64");
    const authTag = Buffer.from(authTagBase64, "base64");

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  /**
   * Check if encryption is enabled
   */
  isEncryptionEnabled(): boolean {
    return this.encryptionKey !== null;
  }

  // =============================================================================
  // Pub/Sub
  // =============================================================================

  /**
   * Subscribe to a channel's context updates
   */
  subscribeChannel(channelId: string, handler: ChannelHandler): void {
    this.transport.subscribe(channelId, handler);
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribeChannel(channelId: string, handler: ChannelHandler): void {
    this.transport.unsubscribe(channelId, handler);
  }

  // =============================================================================
  // Convenience Methods
  // =============================================================================

  /**
   * Set code snippet
   */
  setSnippet(
    agentId: string,
    workspaceId: string,
    key: string,
    snippet: CodeSnippetContext,
    tags?: string[]
  ): ContextEntry {
    return this.set({
      key,
      value: snippet,
      type: "snippet",
      sourceAgentId: agentId,
      workspaceId,
      tags: tags || ["code", snippet.language],
      visibility: "workspace",
    });
  }

  /**
   * Set decision
   */
  setDecision(
    agentId: string,
    workspaceId: string,
    key: string,
    decision: DecisionContext,
    tags?: string[]
  ): ContextEntry {
    return this.set({
      key,
      value: decision,
      type: "decision",
      sourceAgentId: agentId,
      workspaceId,
      tags: tags || ["decision"],
      visibility: "workspace",
    });
  }

  /**
   * Set dependency
   */
  setDependency(
    agentId: string,
    workspaceId: string,
    dep: DependencyContext,
    tags?: string[]
  ): ContextEntry {
    return this.set({
      key: `dep:${dep.name}`,
      value: dep,
      type: "dependency",
      sourceAgentId: agentId,
      workspaceId,
      tags: tags || ["dependency", dep.type],
      visibility: "workspace",
    });
  }

  /**
   * Set preference
   */
  setPreference(
    agentId: string,
    workspaceId: string,
    key: string,
    value: unknown
  ): ContextEntry {
    return this.set({
      key: `pref:${key}`,
      value,
      type: "preference",
      sourceAgentId: agentId,
      workspaceId,
      tags: ["preference"],
      visibility: "workspace",
      ttl: 0,
    });
  }

  /**
   * Get all snippets
   */
  getSnippets(workspaceId: string, agentId?: string, language?: string): ContextEntry[] {
    const q: ContextQuery = {
      types: ["snippet"],
      tags: language ? [language] : undefined,
    };
    return this.query(workspaceId, q, agentId).entries;
  }

  /**
   * Get all decisions
   */
  getDecisions(workspaceId: string, agentId?: string): ContextEntry[] {
    const q: ContextQuery = {
      types: ["decision"],
      orderBy: "createdAt",
      order: "desc",
    };
    return this.query(workspaceId, q, agentId).entries;
  }

  /**
   * Get all dependencies
   */
  getDependencies(workspaceId: string, agentId?: string): ContextEntry[] {
    return this.query(workspaceId, { types: ["dependency"] }, agentId).entries;
  }

  // =============================================================================
  // Channel Operations
  // =============================================================================

  /**
   * Create channel
   */
  createChannel(
    name: string,
    workspaceId: string,
    description?: string,
    allowedAgents?: string[]
  ): ContextChannel {
    const channel: ContextChannel = {
      id: `ch_${crypto.randomBytes(8).toString("hex")}`,
      name,
      description: description || "",
      workspaceId,
      allowedAgents: allowedAgents || [],
      settings: { ...DEFAULT_CHANNEL_SETTINGS },
      metadata: {
        createdAt: new Date().toISOString(),
        entryCount: 0,
      },
    };

    this.stmts.insertChannel.run({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      workspaceId: channel.workspaceId,
      allowedAgents: JSON.stringify(channel.allowedAgents),
      maxEntries: channel.settings.maxEntries,
      defaultTtl: channel.settings.defaultTtl,
      autoCleanup: channel.settings.autoCleanup ? 1 : 0,
      createdAt: channel.metadata.createdAt,
      entryCount: 0,
    });

    this.emit({ type: "channel:created", channel });
    return channel;
  }

  /**
   * Get channel
   */
  getChannel(channelId: string): ContextChannel | null {
    const row = this.stmts.getChannel.get(channelId) as ChannelRow | undefined;
    return row ? this.rowToChannel(row) : null;
  }

  /**
   * List channels
   */
  listChannels(workspaceId: string): ContextChannel[] {
    const rows = this.stmts.listChannels.all(workspaceId) as ChannelRow[];
    return rows.map((r) => this.rowToChannel(r));
  }

  /**
   * Delete channel
   */
  deleteChannel(channelId: string): boolean {
    const changes = this.stmts.deleteChannel.run(channelId).changes;
    if (changes === 0) return false;

    this.emit({ type: "channel:deleted", channelId });
    return true;
  }

  // =============================================================================
  // Import / Export
  // =============================================================================

  /**
   * Export context to a serialisable snapshot
   */
  exportContext(workspaceId?: string): ContextSnapshot {
    const now = new Date().toISOString();
    let entrySql = "SELECT * FROM context_entries";
    const params: unknown[] = [];

    if (workspaceId) {
      entrySql += " WHERE workspace_id = ?";
      params.push(workspaceId);
    }

    const rows = this.db.prepare(entrySql).all(...params) as EntryRow[];
    const entries = rows.map((r) => this.rowToEntry(r));

    // Collect versions for each entry
    const versions: Record<string, ContextVersion[]> = {};
    for (const entry of entries) {
      const history = this.getHistory(entry.id);
      if (history.length > 0) {
        versions[entry.id] = history;
      }
    }

    // Collect channels
    let channelSql = "SELECT * FROM context_channels";
    const channelParams: unknown[] = [];
    if (workspaceId) {
      channelSql += " WHERE workspace_id = ?";
      channelParams.push(workspaceId);
    }
    const channelRows = this.db.prepare(channelSql).all(...channelParams) as ChannelRow[];
    const channels = channelRows.map((r) => this.rowToChannel(r));

    const snapshot: ContextSnapshot = {
      version: SNAPSHOT_FORMAT_VERSION,
      exportedAt: now,
      workspaceId,
      entries,
      versions,
      channels,
      schemaPatterns: this.listSchemaPatterns(),
    };

    this.emit({ type: "context:exported", count: entries.length });
    return snapshot;
  }

  /**
   * Import context from a snapshot
   */
  importContext(snapshot: ContextSnapshot, strategy: ImportStrategy = "merge"): number {
    let imported = 0;

    const importTransaction = this.db.transaction(() => {
      if (strategy === "replace" && snapshot.workspaceId) {
        this.clearWorkspace(snapshot.workspaceId);
      }

      for (const entry of snapshot.entries) {
        const existing = this.db
          .prepare("SELECT id FROM context_entries WHERE key = ? AND workspace_id = ?")
          .get(entry.key, entry.workspaceId) as { id: string } | undefined;

        if (existing && strategy === "skip-existing") continue;

        this.stmts.upsertEntry.run({
          id: existing ? existing.id : entry.id,
          key: entry.key,
          value: JSON.stringify(entry.value),
          type: entry.type,
          sourceAgent: entry.sourceAgentId,
          workspaceId: entry.workspaceId,
          tags: JSON.stringify(entry.tags),
          visibility: entry.visibility,
          ttl: entry.ttl,
          etag: entry.etag,
          encrypted: entry.encrypted ? 1 : 0,
          channelId: entry.channelId || null,
          createdAt: entry.metadata.createdAt,
          updatedAt: entry.metadata.updatedAt,
          expiresAt: entry.metadata.expiresAt,
          accessCount: entry.metadata.accessCount,
          lastAccessedBy: entry.metadata.lastAccessedBy,
        });
        imported++;
      }

      // Import channels
      for (const channel of snapshot.channels) {
        const existingCh = this.stmts.getChannel.get(channel.id) as ChannelRow | undefined;
        if (!existingCh) {
          this.stmts.insertChannel.run({
            id: channel.id,
            name: channel.name,
            description: channel.description,
            workspaceId: channel.workspaceId,
            allowedAgents: JSON.stringify(channel.allowedAgents),
            maxEntries: channel.settings.maxEntries,
            defaultTtl: channel.settings.defaultTtl,
            autoCleanup: channel.settings.autoCleanup ? 1 : 0,
            createdAt: channel.metadata.createdAt,
            entryCount: channel.metadata.entryCount,
          });
        }
      }
    });

    importTransaction();

    this.emit({ type: "context:imported", count: imported, strategy });
    return imported;
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  private inferType(value: unknown): ContextType {
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (Array.isArray(value)) return "array";
    if (typeof value === "object") return "object";
    return "string";
  }

  private canAccess(entry: ContextEntry, agentId?: string): boolean {
    if (entry.visibility === "global") return true;
    if (entry.visibility === "shared") return true;
    if (entry.visibility === "workspace") return true;
    if (entry.visibility === "private") {
      return entry.sourceAgentId === agentId;
    }
    return false;
  }

  private safeParse(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  private rowToEntry(row: EntryRow): ContextEntry {
    let value = this.safeParse(row.value);

    // Decrypt if encrypted
    if (row.encrypted && this.encryptionKey) {
      const decrypted = this.decrypt(row.value);
      value = this.safeParse(decrypted);
    }

    return {
      id: row.id,
      key: row.key,
      value,
      type: row.type as ContextType,
      sourceAgentId: row.source_agent,
      workspaceId: row.workspace_id,
      tags: (this.safeParse(row.tags) as string[]) || [],
      visibility: row.visibility as ContextVisibility,
      ttl: row.ttl,
      etag: row.etag,
      encrypted: !!row.encrypted,
      channelId: row.channel_id || null,
      metadata: {
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at || null,
        accessCount: row.access_count,
        lastAccessedBy: row.last_accessed_by || null,
      },
    };
  }

  private rowToChannel(row: ChannelRow): ContextChannel {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      workspaceId: row.workspace_id,
      allowedAgents: (this.safeParse(row.allowed_agents) as string[]) || [],
      settings: {
        maxEntries: row.max_entries,
        defaultTtl: row.default_ttl,
        autoCleanup: !!row.auto_cleanup,
      },
      metadata: {
        createdAt: row.created_at,
        entryCount: row.entry_count,
      },
    };
  }

  private cleanup(): void {
    const now = new Date().toISOString();

    // Emit expiring warnings
    const warningThreshold = new Date(Date.now() + this.expiringWarningMs).toISOString();
    const expiring = this.stmts.getExpiring.all(now, warningThreshold) as {
      id: string;
      expires_at: string;
    }[];
    for (const row of expiring) {
      this.emit({ type: "context:expiring", entryId: row.id, expiresAt: row.expires_at });
    }

    // Delete expired
    const expired = this.stmts.getExpired.all(now) as { id: string }[];
    for (const row of expired) {
      this.emit({ type: "context:expired", entryId: row.id });
    }
    this.stmts.deleteExpired.run(now);
  }

  /**
   * Stop cleanup interval and close database
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.transport.disconnect();
    if (this.db) {
      this.db.close();
    }
  }
}

// =============================================================================
// Internal Row Types
// =============================================================================

interface EntryRow {
  id: string;
  key: string;
  value: string;
  type: string;
  source_agent: string;
  workspace_id: string;
  tags: string;
  visibility: string;
  ttl: number;
  etag: string;
  encrypted: number;
  channel_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  access_count: number;
  last_accessed_by: string | null;
}

interface ChannelRow {
  id: string;
  name: string;
  description: string;
  workspace_id: string;
  allowed_agents: string;
  max_entries: number;
  default_ttl: number;
  auto_cleanup: number;
  created_at: string;
  entry_count: number;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a ContextManager with sensible defaults.
 * Accepts either the old-style `storagePath` string or the new options object.
 */
export function createContextManager(optionsOrPath: string | ContextManagerOptions): ContextManager {
  if (typeof optionsOrPath === "string") {
    return new ContextManager({ storagePath: optionsOrPath });
  }
  return new ContextManager(optionsOrPath);
}
