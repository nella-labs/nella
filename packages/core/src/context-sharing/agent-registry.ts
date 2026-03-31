/**
 * Agent Registry
 *
 * Multi-agent coordination backed by SQLite. Provides agent presence
 * tracking, task management, decision logging, and file conflict
 * detection. Uses the existing ContextTransport for pub/sub notifications.
 */

import * as crypto from "crypto";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import type { ContextTransport } from "./transports";
import type {
  AgentPresence,
  AgentTask,
  AgentDecision,
  AgentRegistryEvent,
  FileConflict,
  AgentStatus,
  TaskStatus,
} from "./agent-types";

// =============================================================================
// Types
// =============================================================================

export interface AgentRegistryOptions {
  /** Path to the SQLite database directory */
  storagePath: string;
  /** Transport for pub/sub notifications */
  transport?: ContextTransport;
  /** Heartbeat timeout in seconds (default: 60) */
  heartbeatTimeoutSec?: number;
  /** Full cleanup timeout in seconds (default: 300) */
  cleanupTimeoutSec?: number;
}

type AgentEventHandler = (event: AgentRegistryEvent) => void;

// =============================================================================
// Agent Registry
// =============================================================================

export class AgentRegistry {
  private db: Database.Database;
  private transport?: ContextTransport;
  private handlers: AgentEventHandler[] = [];
  private heartbeatTimeoutSec: number;
  private cleanupTimeoutSec: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: AgentRegistryOptions) {
    this.heartbeatTimeoutSec = options.heartbeatTimeoutSec ?? 60;
    this.cleanupTimeoutSec = options.cleanupTimeoutSec ?? 300;
    this.transport = options.transport;

    // Initialize database
    const dbDir = options.storagePath;
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(path.join(dbDir, "agents.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");

    this.initSchema();
    this.startCleanupLoop();
  }

  // ===========================================================================
  // Schema
  // ===========================================================================

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_presence (
        agent_id      TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        type          TEXT NOT NULL DEFAULT 'custom',
        workspace_id  TEXT NOT NULL,
        branch        TEXT,
        current_task  TEXT,
        active_files  TEXT NOT NULL DEFAULT '[]',
        status        TEXT NOT NULL DEFAULT 'active',
        capabilities  TEXT NOT NULL DEFAULT '[]',
        last_heartbeat TEXT NOT NULL,
        connected_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_tasks (
        id              TEXT PRIMARY KEY,
        description     TEXT NOT NULL,
        assigned_agent  TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        parent_task_id  TEXT,
        files           TEXT NOT NULL DEFAULT '[]',
        branch          TEXT,
        priority        INTEGER NOT NULL DEFAULT 5,
        dependencies    TEXT NOT NULL DEFAULT '[]',
        workspace_id    TEXT NOT NULL,
        result          TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        completed_at    TEXT,
        FOREIGN KEY (assigned_agent) REFERENCES agent_presence(agent_id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS agent_decisions (
        id              TEXT PRIMARY KEY,
        agent_id        TEXT NOT NULL,
        decision        TEXT NOT NULL,
        rationale       TEXT NOT NULL,
        alternatives    TEXT NOT NULL DEFAULT '[]',
        affected_files  TEXT NOT NULL DEFAULT '[]',
        workspace_id    TEXT NOT NULL,
        branch          TEXT,
        acknowledged    INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_presence_workspace ON agent_presence(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_presence_status ON agent_presence(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON agent_tasks(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON agent_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_agent ON agent_tasks(assigned_agent);
      CREATE INDEX IF NOT EXISTS idx_decisions_workspace ON agent_decisions(workspace_id);
    `);
  }

  // ===========================================================================
  // Presence
  // ===========================================================================

  /**
   * Register an agent as present in a workspace.
   */
  register(agent: Omit<AgentPresence, "lastHeartbeat" | "connectedAt">): AgentPresence {
    const now = new Date().toISOString();
    const full: AgentPresence = { ...agent, lastHeartbeat: now, connectedAt: now };

    this.db.prepare(`
      INSERT OR REPLACE INTO agent_presence
        (agent_id, name, type, workspace_id, branch, current_task, active_files, status, capabilities, last_heartbeat, connected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      full.agentId, full.name, full.type, full.workspaceId,
      full.branch || null, full.currentTask || null,
      JSON.stringify(full.activeFiles), full.status,
      JSON.stringify(full.capabilities), full.lastHeartbeat, full.connectedAt,
    );

    this.emit({ type: "agent:joined", agent: full });
    this.publish(`agent:presence:${full.workspaceId}`, { type: "agent:joined", agent: full });

    return full;
  }

  /**
   * Send a heartbeat and optionally update presence fields.
   */
  heartbeat(agentId: string, update?: Partial<Pick<AgentPresence, "currentTask" | "activeFiles" | "status" | "branch">>): void {
    const now = new Date().toISOString();
    const sets = ["last_heartbeat = ?"];
    const params: unknown[] = [now];

    if (update?.currentTask !== undefined) {
      sets.push("current_task = ?");
      params.push(update.currentTask);
    }
    if (update?.activeFiles !== undefined) {
      sets.push("active_files = ?");
      params.push(JSON.stringify(update.activeFiles));
    }
    if (update?.status !== undefined) {
      sets.push("status = ?");
      params.push(update.status);
    }
    if (update?.branch !== undefined) {
      sets.push("branch = ?");
      params.push(update.branch);
    }

    params.push(agentId);
    this.db.prepare(`UPDATE agent_presence SET ${sets.join(", ")} WHERE agent_id = ?`).run(...params);
  }

  /**
   * Discover all active agents in a workspace.
   */
  discoverAgents(workspaceId: string, options?: { branch?: string }): AgentPresence[] {
    let sql = "SELECT * FROM agent_presence WHERE workspace_id = ? AND status != 'disconnected'";
    const params: unknown[] = [workspaceId];

    if (options?.branch) {
      sql += " AND branch = ?";
      params.push(options.branch);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.rowToPresence);
  }

  /**
   * Deregister an agent.
   */
  deregister(agentId: string): void {
    // Unassign any tasks
    this.db.prepare("UPDATE agent_tasks SET assigned_agent = NULL WHERE assigned_agent = ?").run(agentId);

    this.db.prepare("DELETE FROM agent_presence WHERE agent_id = ?").run(agentId);
    this.emit({ type: "agent:left", agentId });
  }

  // ===========================================================================
  // Tasks
  // ===========================================================================

  /**
   * Create a new task.
   */
  createTask(task: Omit<AgentTask, "id" | "createdAt" | "updatedAt">): AgentTask {
    const id = `task_${crypto.randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();
    const full: AgentTask = { ...task, id, createdAt: now, updatedAt: now };

    this.db.prepare(`
      INSERT INTO agent_tasks
        (id, description, assigned_agent, status, parent_task_id, files, branch, priority, dependencies, workspace_id, result, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      full.id, full.description, full.assignedAgentId, full.status,
      full.parentTaskId || null, JSON.stringify(full.files), full.branch || null,
      full.priority, JSON.stringify(full.dependencies), full.workspaceId,
      full.result ? JSON.stringify(full.result) : null, full.createdAt, full.updatedAt,
      full.completedAt || null,
    );

    this.emit({ type: "task:created", task: full });
    this.publish(`agent:tasks:${full.workspaceId}`, { type: "task:created", task: full });

    return full;
  }

  /**
   * Claim a task for an agent. Returns true if successfully claimed.
   */
  claimTask(taskId: string, agentId: string): boolean {
    const result = this.db.prepare(
      "UPDATE agent_tasks SET assigned_agent = ?, status = 'in_progress', updated_at = ? WHERE id = ? AND (assigned_agent IS NULL OR assigned_agent = ?)",
    ).run(agentId, new Date().toISOString(), taskId, agentId);

    if (result.changes > 0) {
      this.emit({ type: "task:claimed", taskId, agentId });
      return true;
    }
    return false;
  }

  /**
   * Update a task's status and optional fields.
   */
  updateTask(taskId: string, updates: Partial<Pick<AgentTask, "status" | "result" | "assignedAgentId">>): void {
    const sets = ["updated_at = ?"];
    const params: unknown[] = [new Date().toISOString()];

    if (updates.status) {
      sets.push("status = ?");
      params.push(updates.status);
      if (updates.status === "completed" || updates.status === "failed") {
        sets.push("completed_at = ?");
        params.push(new Date().toISOString());
      }
    }
    if (updates.result !== undefined) {
      sets.push("result = ?");
      params.push(JSON.stringify(updates.result));
    }
    if (updates.assignedAgentId !== undefined) {
      sets.push("assigned_agent = ?");
      params.push(updates.assignedAgentId);
    }

    params.push(taskId);
    this.db.prepare(`UPDATE agent_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);

    if (updates.status === "completed") {
      this.emit({ type: "task:completed", taskId, result: updates.result });
    }
  }

  /**
   * List tasks with optional filters.
   */
  listTasks(workspaceId: string, filters?: { status?: TaskStatus; agentId?: string; branch?: string }): AgentTask[] {
    let sql = "SELECT * FROM agent_tasks WHERE workspace_id = ?";
    const params: unknown[] = [workspaceId];

    if (filters?.status) {
      sql += " AND status = ?";
      params.push(filters.status);
    }
    if (filters?.agentId) {
      sql += " AND assigned_agent = ?";
      params.push(filters.agentId);
    }
    if (filters?.branch) {
      sql += " AND branch = ?";
      params.push(filters.branch);
    }

    sql += " ORDER BY priority ASC, created_at ASC";

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.rowToTask);
  }

  // ===========================================================================
  // Decisions
  // ===========================================================================

  /**
   * Record a design/code decision.
   */
  recordDecision(decision: Omit<AgentDecision, "id" | "createdAt" | "acknowledged">): AgentDecision {
    const id = `dec_${crypto.randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();
    const full: AgentDecision = { ...decision, id, createdAt: now, acknowledged: false };

    this.db.prepare(`
      INSERT INTO agent_decisions
        (id, agent_id, decision, rationale, alternatives, affected_files, workspace_id, branch, acknowledged, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      full.id, full.agentId, full.decision, full.rationale,
      JSON.stringify(full.alternatives), JSON.stringify(full.affectedFiles),
      full.workspaceId, full.branch || null, full.acknowledged ? 1 : 0, full.createdAt,
    );

    this.emit({ type: "decision:made", decision: full });
    this.publish(`agent:decisions:${full.workspaceId}`, { type: "decision:made", decision: full });

    return full;
  }

  /**
   * Get recent decisions.
   */
  getDecisions(workspaceId: string, options?: { limit?: number; branch?: string }): AgentDecision[] {
    let sql = "SELECT * FROM agent_decisions WHERE workspace_id = ?";
    const params: unknown[] = [workspaceId];

    if (options?.branch) {
      sql += " AND branch = ?";
      params.push(options.branch);
    }

    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(options?.limit ?? 50);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.rowToDecision);
  }

  // ===========================================================================
  // Conflict Detection
  // ===========================================================================

  /**
   * Check if files being edited overlap with other agents.
   */
  checkFileConflicts(agentId: string, files: string[], workspaceId: string): FileConflict[] {
    const conflicts: FileConflict[] = [];

    const agents = this.discoverAgents(workspaceId);
    for (const agent of agents) {
      if (agent.agentId === agentId) continue;
      if (agent.status === "disconnected") continue;

      for (const file of files) {
        if (agent.activeFiles.includes(file)) {
          conflicts.push({ file, otherAgent: agent });
          this.emit({ type: "conflict:detected", file, agents: [agentId, agent.agentId] });
        }
      }
    }

    return conflicts;
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  onAgentEvent(handler: AgentEventHandler): void {
    this.handlers.push(handler);
  }

  private emit(event: AgentRegistryEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  private publish(channel: string, event: AgentRegistryEvent): void {
    if (!this.transport) return;
    try {
      this.transport.publish(channel, {
        type: event.type as any,
        channel,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Transport publish failures are non-fatal
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  private startCleanupLoop(): void {
    this.cleanupInterval = setInterval(() => this.cleanup(), 30_000);
  }

  private cleanup(): void {
    const now = Date.now();

    // Mark agents with stale heartbeats as disconnected
    const timeoutThreshold = new Date(now - this.heartbeatTimeoutSec * 1000).toISOString();
    this.db.prepare(
      "UPDATE agent_presence SET status = 'disconnected' WHERE status != 'disconnected' AND last_heartbeat < ?",
    ).run(timeoutThreshold);

    // Fully remove agents that have been disconnected beyond cleanup timeout
    const cleanupThreshold = new Date(now - this.cleanupTimeoutSec * 1000).toISOString();
    const removed = this.db.prepare(
      "DELETE FROM agent_presence WHERE status = 'disconnected' AND last_heartbeat < ?",
    ).run(cleanupThreshold);

    if (removed.changes > 0) {
      // Unassign tasks from cleaned-up agents
      this.db.prepare(
        "UPDATE agent_tasks SET assigned_agent = NULL, status = 'pending' WHERE assigned_agent NOT IN (SELECT agent_id FROM agent_presence)",
      ).run();
    }
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private rowToPresence(row: any): AgentPresence {
    return {
      agentId: row.agent_id,
      name: row.name,
      type: row.type,
      workspaceId: row.workspace_id,
      branch: row.branch || undefined,
      currentTask: row.current_task || undefined,
      activeFiles: JSON.parse(row.active_files || "[]"),
      status: row.status,
      lastHeartbeat: row.last_heartbeat,
      connectedAt: row.connected_at,
      capabilities: JSON.parse(row.capabilities || "[]"),
    };
  }

  private rowToTask(row: any): AgentTask {
    return {
      id: row.id,
      description: row.description,
      assignedAgentId: row.assigned_agent || null,
      status: row.status,
      parentTaskId: row.parent_task_id || undefined,
      files: JSON.parse(row.files || "[]"),
      branch: row.branch || undefined,
      priority: row.priority,
      dependencies: JSON.parse(row.dependencies || "[]"),
      workspaceId: row.workspace_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined,
      result: row.result ? JSON.parse(row.result) : undefined,
    };
  }

  private rowToDecision(row: any): AgentDecision {
    return {
      id: row.id,
      agentId: row.agent_id,
      decision: row.decision,
      rationale: row.rationale,
      alternatives: JSON.parse(row.alternatives || "[]"),
      affectedFiles: JSON.parse(row.affected_files || "[]"),
      workspaceId: row.workspace_id,
      branch: row.branch || undefined,
      acknowledged: !!row.acknowledged,
      createdAt: row.created_at,
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Destroy the registry — close DB and stop cleanup loop.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.db.close();
    this.handlers = [];
  }
}
