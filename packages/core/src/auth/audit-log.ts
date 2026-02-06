/**
 * Audit Log Manager
 *
 * Persistent audit trail for all auth operations.
 * Append-only log with automatic rotation.
 */

import * as fs from "fs/promises";
import { existsSync, statSync } from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type {
  AuditEntry,
  AuditCategory,
  AuditLogConfig,
  ExtendedAuthEvent,
} from "./types";
import { DEFAULT_AUDIT_CONFIG } from "./types";

// =============================================================================
// Types
// =============================================================================

export type AuditEventHandler = (entry: AuditEntry) => void;

export interface AuditLogOptions {
  storagePath: string;
  config?: Partial<AuditLogConfig>;
}

// =============================================================================
// Audit Log Manager
// =============================================================================

export class AuditLogManager {
  private config: AuditLogConfig;
  private logPath: string;
  private storagePath: string;
  private eventHandlers: AuditEventHandler[] = [];
  private writeStream: null = null; // Reserved for future streaming
  private currentFileSize = 0;

  private constructor(options: AuditLogOptions) {
    this.storagePath = options.storagePath;
    this.config = {
      ...DEFAULT_AUDIT_CONFIG,
      ...options.config,
    };
    this.logPath = path.join(this.storagePath, this.config.logPath);
  }

  /**
   * Create and initialize an AuditLogManager instance
   */
  static async create(options: AuditLogOptions): Promise<AuditLogManager> {
    const manager = new AuditLogManager(options);
    await manager.init();
    return manager;
  }

  /**
   * Async initialization — ensures log directory exists and tracks file size
   */
  private async init(): Promise<void> {
    const logDir = path.dirname(this.logPath);
    await fs.mkdir(logDir, { recursive: true });

    // Initialize file size tracking
    try {
      const stat = await fs.stat(this.logPath);
      this.currentFileSize = stat.size;
    } catch {
      this.currentFileSize = 0;
    }
  }

  // =============================================================================
  // Event Handlers
  // =============================================================================

  /**
   * Register event handler
   */
  onEntry(handler: AuditEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(entry: AuditEntry): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(entry);
      } catch (error) {
        console.error("Audit event handler error:", error);
      }
    }
  }

  // =============================================================================
  // Logging Methods
  // =============================================================================

  /**
   * Log an audit entry
   */
  async log(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry> {
    if (!this.config.enabled) {
      return this.createEntry(entry);
    }

    // Check category filter
    if (
      this.config.categories.length > 0 &&
      !this.config.categories.includes(entry.category)
    ) {
      return this.createEntry(entry);
    }

    const fullEntry = this.createEntry(entry);

    // Check rotation before write
    await this.checkRotation();

    // Append to log file
    await this.appendEntry(fullEntry);

    // Emit event
    this.emit(fullEntry);

    return fullEntry;
  }

  /**
   * Log authentication attempt
   */
  async logAuth(
    success: boolean,
    actor: AuditEntry["actor"],
    action: string,
    details?: Record<string, unknown>,
    error?: string
  ): Promise<AuditEntry> {
    return this.log({
      category: "authentication",
      action,
      actor,
      outcome: success ? "success" : "failure",
      details,
      error,
    });
  }

  /**
   * Log authorization check
   */
  async logAuthz(
    allowed: boolean,
    actor: AuditEntry["actor"],
    action: string,
    target: AuditEntry["target"],
    details?: Record<string, unknown>
  ): Promise<AuditEntry> {
    return this.log({
      category: "authorization",
      action,
      actor,
      target,
      outcome: allowed ? "success" : "denied",
      details,
    });
  }

  /**
   * Log key management operation
   */
  async logKeyOp(
    action: string,
    actor: AuditEntry["actor"],
    keyId: string,
    keyName?: string,
    details?: Record<string, unknown>,
    error?: string
  ): Promise<AuditEntry> {
    return this.log({
      category: "key_management",
      action,
      actor,
      target: {
        type: "key",
        id: keyId,
        name: keyName,
      },
      outcome: error ? "failure" : "success",
      details,
      error,
    });
  }

  /**
   * Log agent management operation
   */
  async logAgentOp(
    action: string,
    actor: AuditEntry["actor"],
    agentId: string,
    agentName?: string,
    details?: Record<string, unknown>,
    error?: string
  ): Promise<AuditEntry> {
    return this.log({
      category: "agent_management",
      action,
      actor,
      target: {
        type: "agent",
        id: agentId,
        name: agentName,
      },
      outcome: error ? "failure" : "success",
      details,
      error,
    });
  }

  /**
   * Log from an auth event
   */
  async logFromEvent(event: ExtendedAuthEvent, actor?: AuditEntry["actor"]): Promise<AuditEntry> {
    const defaultActor: AuditEntry["actor"] = actor || {
      type: "system",
      id: "system",
    };

    switch (event.type) {
      case "key:created":
        return this.logKeyOp(
          "create",
          defaultActor,
          event.key.id,
          event.key.name,
          { prefix: event.key.prefix }
        );

      case "key:revoked":
        return this.logKeyOp("revoke", defaultActor, event.keyId, undefined, {
          reason: event.reason,
        });

      case "key:used":
        return this.log({
          category: "data_access",
          action: event.action,
          actor: { type: "key", id: event.keyId },
          outcome: "success",
        });

      case "key:rotated":
        return this.logKeyOp("rotate", defaultActor, event.event.oldKeyId, undefined, {
          newKeyId: event.event.newKeyId,
          reason: event.event.reason,
        });

      case "agent:created":
        return this.logAgentOp(
          "create",
          defaultActor,
          event.agent.id,
          event.agent.name
        );

      case "agent:updated":
        return this.logAgentOp(
          "update",
          defaultActor,
          event.agent.id,
          event.agent.name
        );

      case "agent:deactivated":
        return this.logAgentOp("deactivate", defaultActor, event.agentId);

      case "auth:success":
        return this.logAuth(
          true,
          { type: "key", id: event.keyId },
          event.action
        );

      case "auth:failure":
        return this.logAuth(
          false,
          { type: "key", id: event.keyPrefix || "unknown" },
          "authenticate",
          { errorCode: event.error },
          event.error
        );

      case "token:issued":
        return this.log({
          category: "authentication",
          action: "token_issued",
          actor: { type: "key", id: event.keyId },
          outcome: "success",
          details: { jti: event.jti, expiresAt: event.expiresAt },
        });

      case "token:revoked":
        return this.log({
          category: "authentication",
          action: "token_revoked",
          actor: defaultActor,
          outcome: "success",
          details: { jti: event.jti, reason: event.reason },
        });

      case "ip:blocked":
        return this.log({
          category: "authorization",
          action: "ip_blocked",
          actor: { type: "system", id: "ip-filter", ip: event.ip },
          outcome: "denied",
          details: { reason: event.reason },
        });

      case "signature:invalid":
        return this.log({
          category: "authentication",
          action: "signature_verification",
          actor: { type: "key", id: event.keyId },
          outcome: "failure",
          error: event.reason,
        });

      default:
        // Handle other events generically
        return this.log({
          category: "configuration",
          action: (event as { type: string }).type,
          actor: defaultActor,
          outcome: "success",
          details: event as unknown as Record<string, unknown>,
        });
    }
  }

  // =============================================================================
  // Query Methods
  // =============================================================================

  /**
   * Read recent audit entries
   */
  async getRecent(limit: number = 100): Promise<AuditEntry[]> {
    try {
      const content = await fs.readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const entries: AuditEntry[] = [];

    // Read from end for most recent
    const startIndex = Math.max(0, lines.length - limit);
    for (let i = startIndex; i < lines.length; i++) {
      try {
        entries.push(JSON.parse(lines[i]));
      } catch {
        // Skip corrupted lines
      }
    }

    return entries;
    } catch {
      return [];
    }
  }

  /**
   * Search audit log
   */
  async search(options: {
    category?: AuditCategory;
    actorId?: string;
    targetId?: string;
    outcome?: AuditEntry["outcome"];
    since?: Date;
    until?: Date;
    limit?: number;
  }): Promise<AuditEntry[]> {
    const entries = await this.getRecent(options.limit || 1000);
    
    return entries.filter((entry) => {
      if (options.category && entry.category !== options.category) {
        return false;
      }
      if (options.actorId && entry.actor.id !== options.actorId) {
        return false;
      }
      if (options.targetId && entry.target?.id !== options.targetId) {
        return false;
      }
      if (options.outcome && entry.outcome !== options.outcome) {
        return false;
      }
      if (options.since) {
        const entryTime = new Date(entry.timestamp);
        if (entryTime < options.since) {
          return false;
        }
      }
      if (options.until) {
        const entryTime = new Date(entry.timestamp);
        if (entryTime > options.until) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Get entries for a specific key
   */
  async getKeyHistory(keyId: string, limit: number = 100): Promise<AuditEntry[]> {
    return (await this.search({
      limit,
    })).filter(
      (e) =>
        e.actor.id === keyId ||
        (e.target?.type === "key" && e.target.id === keyId)
    );
  }

  /**
   * Get entries for a specific agent
   */
  async getAgentHistory(agentId: string, limit: number = 100): Promise<AuditEntry[]> {
    return (await this.search({
      limit,
    })).filter(
      (e) =>
        e.actor.id === agentId ||
        (e.target?.type === "agent" && e.target.id === agentId)
    );
  }

  /**
   * Get failed authentication attempts
   */
  async getFailedAuths(since?: Date, limit: number = 100): Promise<AuditEntry[]> {
    return this.search({
      category: "authentication",
      outcome: "failure",
      since,
      limit,
    });
  }

  // =============================================================================
  // Maintenance
  // =============================================================================

  /**
   * Get audit log statistics
   */
  async getStats(): Promise<{
    totalEntries: number;
    fileSize: number;
    oldestEntry: string | null;
    newestEntry: string | null;
    rotatedFiles: number;
  }> {
    let totalEntries = 0;
    let oldestEntry: string | null = null;
    let newestEntry: string | null = null;

    try {
      const content = await fs.readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      totalEntries = lines.length;

      if (lines.length > 0) {
        try {
          const first = JSON.parse(lines[0]) as AuditEntry;
          const last = JSON.parse(lines[lines.length - 1]) as AuditEntry;
          oldestEntry = first.timestamp;
          newestEntry = last.timestamp;
        } catch {
          // Ignore parse errors
        }
      }
    } catch {
      // File doesn't exist
    }

    // Count rotated files
    const dir = path.dirname(this.logPath);
    const baseName = path.basename(this.logPath);
    let rotatedFiles = 0;
    
    try {
      const files = await fs.readdir(dir);
      rotatedFiles = files.filter(
        (f) => f.startsWith(baseName) && f !== baseName
      ).length;
    } catch {
      // Directory doesn't exist
    }

    return {
      totalEntries,
      fileSize: this.currentFileSize,
      oldestEntry,
      newestEntry,
      rotatedFiles,
    };
  }

  /**
   * Force log rotation
   */
  async rotate(): Promise<void> {
    try {
      await fs.access(this.logPath);
    } catch {
      return;
    }

    // Rotate existing files
    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const oldPath = `${this.logPath}.${i}`;
      const newPath = `${this.logPath}.${i + 1}`;
      
      try {
        await fs.access(oldPath);
        if (i === this.config.maxFiles - 1) {
          await fs.unlink(oldPath); // Delete oldest
        } else {
          await fs.rename(oldPath, newPath);
        }
      } catch {
        // File doesn't exist, skip
      }
    }

    // Rotate current file
    await fs.rename(this.logPath, `${this.logPath}.1`);
    this.currentFileSize = 0;
  }

  /**
   * Clear all audit logs (use with caution)
   */
  async clear(): Promise<void> {
    // Delete main log
    try {
      await fs.unlink(this.logPath);
    } catch {
      // File doesn't exist
    }

    // Delete rotated logs
    const dir = path.dirname(this.logPath);
    const baseName = path.basename(this.logPath);
    
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.startsWith(baseName) && file !== baseName) {
          await fs.unlink(path.join(dir, file));
        }
      }
    } catch {
      // Directory doesn't exist
    }

    this.currentFileSize = 0;
  }

  /**
   * Export audit log to JSON
   */
  async export(): Promise<string> {
    const entries = await this.getRecent(Number.MAX_SAFE_INTEGER);
    return JSON.stringify(entries, null, 2);
  }

  /**
   * Close resources
   */
  close(): void {
    // No-op — reserved for future resource cleanup
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private createEntry(partial: Omit<AuditEntry, "id" | "timestamp">): AuditEntry {
    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...partial,
    };
  }

  private async appendEntry(entry: AuditEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n";
    const lineBytes = Buffer.byteLength(line, "utf-8");

    await fs.appendFile(this.logPath, line);
    this.currentFileSize += lineBytes;
  }

  private async checkRotation(): Promise<void> {
    if (this.currentFileSize >= this.config.maxFileSize) {
      await this.rotate();
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

let defaultAuditLog: AuditLogManager | null = null;

export async function getAuditLog(options?: AuditLogOptions): Promise<AuditLogManager> {
  if (!defaultAuditLog && options) {
    defaultAuditLog = await AuditLogManager.create(options);
  }
  if (!defaultAuditLog) {
    throw new Error("AuditLogManager not initialized. Call with options first.");
  }
  return defaultAuditLog;
}

export async function createAuditLog(options: AuditLogOptions): Promise<AuditLogManager> {
  return AuditLogManager.create(options);
}

export function resetAuditLog(): void {
  if (defaultAuditLog) {
    defaultAuditLog.close();
    defaultAuditLog = null;
  }
}
