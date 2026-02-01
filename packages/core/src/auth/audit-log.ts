/**
 * Audit Log Manager
 *
 * Persistent audit trail for all auth operations.
 * Append-only log with automatic rotation.
 */

import * as fs from "fs";
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
  private writeStream: fs.WriteStream | null = null;
  private currentFileSize = 0;

  constructor(options: AuditLogOptions) {
    this.storagePath = options.storagePath;
    this.config = {
      ...DEFAULT_AUDIT_CONFIG,
      ...options.config,
    };
    this.logPath = path.join(this.storagePath, this.config.logPath);

    // Ensure directory exists
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Initialize file size tracking
    if (fs.existsSync(this.logPath)) {
      this.currentFileSize = fs.statSync(this.logPath).size;
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
  log(entry: Omit<AuditEntry, "id" | "timestamp">): AuditEntry {
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
    this.checkRotation();

    // Append to log file
    this.appendEntry(fullEntry);

    // Emit event
    this.emit(fullEntry);

    return fullEntry;
  }

  /**
   * Log authentication attempt
   */
  logAuth(
    success: boolean,
    actor: AuditEntry["actor"],
    action: string,
    details?: Record<string, unknown>,
    error?: string
  ): AuditEntry {
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
  logAuthz(
    allowed: boolean,
    actor: AuditEntry["actor"],
    action: string,
    target: AuditEntry["target"],
    details?: Record<string, unknown>
  ): AuditEntry {
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
  logKeyOp(
    action: string,
    actor: AuditEntry["actor"],
    keyId: string,
    keyName?: string,
    details?: Record<string, unknown>,
    error?: string
  ): AuditEntry {
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
  logAgentOp(
    action: string,
    actor: AuditEntry["actor"],
    agentId: string,
    agentName?: string,
    details?: Record<string, unknown>,
    error?: string
  ): AuditEntry {
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
  logFromEvent(event: ExtendedAuthEvent, actor?: AuditEntry["actor"]): AuditEntry {
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
  getRecent(limit: number = 100): AuditEntry[] {
    if (!fs.existsSync(this.logPath)) {
      return [];
    }

    const content = fs.readFileSync(this.logPath, "utf-8");
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
  }

  /**
   * Search audit log
   */
  search(options: {
    category?: AuditCategory;
    actorId?: string;
    targetId?: string;
    outcome?: AuditEntry["outcome"];
    since?: Date;
    until?: Date;
    limit?: number;
  }): AuditEntry[] {
    const entries = this.getRecent(options.limit || 1000);
    
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
  getKeyHistory(keyId: string, limit: number = 100): AuditEntry[] {
    return this.search({
      limit,
    }).filter(
      (e) =>
        e.actor.id === keyId ||
        (e.target?.type === "key" && e.target.id === keyId)
    );
  }

  /**
   * Get entries for a specific agent
   */
  getAgentHistory(agentId: string, limit: number = 100): AuditEntry[] {
    return this.search({
      limit,
    }).filter(
      (e) =>
        e.actor.id === agentId ||
        (e.target?.type === "agent" && e.target.id === agentId)
    );
  }

  /**
   * Get failed authentication attempts
   */
  getFailedAuths(since?: Date, limit: number = 100): AuditEntry[] {
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
  getStats(): {
    totalEntries: number;
    fileSize: number;
    oldestEntry: string | null;
    newestEntry: string | null;
    rotatedFiles: number;
  } {
    let totalEntries = 0;
    let oldestEntry: string | null = null;
    let newestEntry: string | null = null;

    if (fs.existsSync(this.logPath)) {
      const content = fs.readFileSync(this.logPath, "utf-8");
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
    }

    // Count rotated files
    const dir = path.dirname(this.logPath);
    const baseName = path.basename(this.logPath);
    let rotatedFiles = 0;
    
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      rotatedFiles = files.filter(
        (f) => f.startsWith(baseName) && f !== baseName
      ).length;
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
  rotate(): void {
    if (!fs.existsSync(this.logPath)) {
      return;
    }

    // Close current stream
    this.closeStream();

    // Rotate existing files
    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const oldPath = `${this.logPath}.${i}`;
      const newPath = `${this.logPath}.${i + 1}`;
      
      if (fs.existsSync(oldPath)) {
        if (i === this.config.maxFiles - 1) {
          fs.unlinkSync(oldPath); // Delete oldest
        } else {
          fs.renameSync(oldPath, newPath);
        }
      }
    }

    // Rotate current file
    fs.renameSync(this.logPath, `${this.logPath}.1`);
    this.currentFileSize = 0;
  }

  /**
   * Clear all audit logs (use with caution)
   */
  clear(): void {
    this.closeStream();

    // Delete main log
    if (fs.existsSync(this.logPath)) {
      fs.unlinkSync(this.logPath);
    }

    // Delete rotated logs
    const dir = path.dirname(this.logPath);
    const baseName = path.basename(this.logPath);
    
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.startsWith(baseName) && file !== baseName) {
          fs.unlinkSync(path.join(dir, file));
        }
      }
    }

    this.currentFileSize = 0;
  }

  /**
   * Export audit log to JSON
   */
  export(): string {
    const entries = this.getRecent(Number.MAX_SAFE_INTEGER);
    return JSON.stringify(entries, null, 2);
  }

  /**
   * Close resources
   */
  close(): void {
    this.closeStream();
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

  private appendEntry(entry: AuditEntry): void {
    const line = JSON.stringify(entry) + "\n";
    const lineBytes = Buffer.byteLength(line, "utf-8");

    // Use synchronous append for reliability
    fs.appendFileSync(this.logPath, line);
    this.currentFileSize += lineBytes;
  }

  private checkRotation(): void {
    if (this.currentFileSize >= this.config.maxFileSize) {
      this.rotate();
    }
  }

  private closeStream(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

let defaultAuditLog: AuditLogManager | null = null;

export function getAuditLog(options?: AuditLogOptions): AuditLogManager {
  if (!defaultAuditLog && options) {
    defaultAuditLog = new AuditLogManager(options);
  }
  if (!defaultAuditLog) {
    throw new Error("AuditLogManager not initialized. Call with options first.");
  }
  return defaultAuditLog;
}

export function createAuditLog(options: AuditLogOptions): AuditLogManager {
  return new AuditLogManager(options);
}

export function resetAuditLog(): void {
  if (defaultAuditLog) {
    defaultAuditLog.close();
    defaultAuditLog = null;
  }
}
