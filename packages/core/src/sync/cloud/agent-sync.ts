/**
 * Agent State Cloud Sync
 *
 * Data storage: GCP Cloud SQL (agent_presence, agent_tasks, agent_decisions)
 * Notifications: Supabase Realtime (lightweight pub/sub for cross-machine events)
 *
 * The local SQLite AgentRegistry is the write-ahead source of truth.
 * This module syncs state TO GCP Cloud SQL for persistence and cross-machine
 * queries, and uses Supabase Realtime channels for instant event notifications.
 */

import type { ContextTransport, ContextMessage } from "../../context-sharing/transports";
import type { AgentRegistry } from "../../context-sharing/agent-registry";
import type {
  AgentPresence,
  AgentRegistryEvent,
} from "../../context-sharing/agent-types";

// =============================================================================
// Types
// =============================================================================

export interface AgentStateSyncConfig {
  /** Workspace ID */
  workspaceId: string;
  /** User ID (for GCP Cloud SQL scoping) */
  userId: string;
  /** Supabase Realtime transport for event notifications */
  transport: ContextTransport;
  /** Local agent registry (SQLite, source of truth) */
  registry: AgentRegistry;
  /** GCP Cloud SQL pool for persisting agent state */
  cloudSQLPool?: import("pg").Pool;
  /** Sync interval in milliseconds (default: 30000) */
  syncIntervalMs?: number;
}

export interface IndexUpdateNotification {
  type: "index:updated";
  workspaceId: string;
  branch: string;
  trigger: "github-push" | "github-pr" | "github-merge" | "manual";
  changedFiles: string[];
  stats: { filesReindexed: number; chunksUpdated: number };
  timestamp: string;
}

type RemoteEventHandler = (event: AgentRegistryEvent) => void;

// =============================================================================
// Agent State Sync
// =============================================================================

export class AgentStateSync {
  private config: AgentStateSyncConfig;
  private handlers: RemoteEventHandler[] = [];
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private subscribed = false;

  constructor(config: AgentStateSyncConfig) {
    this.config = config;
  }

  /**
   * Start syncing:
   * 1. Subscribe to Supabase Realtime channels for instant event notifications
   * 2. Periodically sync local agent state to GCP Cloud SQL
   */
  async start(): Promise<void> {
    if (this.subscribed) return;

    const { workspaceId, transport } = this.config;

    // Subscribe to Supabase Realtime channels for cross-machine notifications
    transport.subscribe(`agent:presence:${workspaceId}`, this.handleRemoteMessage);
    transport.subscribe(`agent:tasks:${workspaceId}`, this.handleRemoteMessage);
    transport.subscribe(`agent:decisions:${workspaceId}`, this.handleRemoteMessage);
    transport.subscribe(`workspace:${workspaceId}:index-updated`, this.handleRemoteMessage);

    this.subscribed = true;

    // Start periodic sync to GCP Cloud SQL
    const interval = this.config.syncIntervalMs ?? 30_000;
    this.syncInterval = setInterval(() => {
      this.syncToCloudSQL().catch(() => {
        // Non-fatal — will retry on next interval
      });
    }, interval);

    // Initial sync
    await this.syncToCloudSQL();
  }

  /**
   * Stop syncing.
   */
  async stop(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.subscribed) {
      const { workspaceId, transport } = this.config;
      transport.unsubscribe(`agent:presence:${workspaceId}`, this.handleRemoteMessage);
      transport.unsubscribe(`agent:tasks:${workspaceId}`, this.handleRemoteMessage);
      transport.unsubscribe(`agent:decisions:${workspaceId}`, this.handleRemoteMessage);
      transport.unsubscribe(`workspace:${workspaceId}:index-updated`, this.handleRemoteMessage);
      this.subscribed = false;
    }
  }

  /**
   * Subscribe to remote agent events (received via Supabase Realtime).
   */
  onRemoteEvent(handler: RemoteEventHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Broadcast an index update notification via Supabase Realtime.
   * Called after a GitHub-triggered re-index completes.
   */
  async notifyIndexUpdate(notification: IndexUpdateNotification): Promise<void> {
    const { workspaceId, transport } = this.config;
    await transport.publish(`workspace:${workspaceId}:index-updated`, {
      type: "context:set" as const,
      channel: `workspace:${workspaceId}:index-updated`,
      timestamp: notification.timestamp,
    });
  }

  /**
   * Sync local agent state to GCP Cloud SQL.
   * This persists presence/tasks/decisions for cross-machine queries.
   */
  async syncToCloudSQL(): Promise<void> {
    const pool = this.config.cloudSQLPool;
    if (!pool) return;

    const { workspaceId, userId, registry } = this.config;

    try {
      // Sync presence
      const agents = registry.discoverAgents(workspaceId);
      for (const agent of agents) {
        await pool.query(
          `INSERT INTO agent_presence (agent_id, user_id, workspace_id, name, type, branch, current_task, active_files, status, capabilities, last_heartbeat, connected_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (agent_id, workspace_id) DO UPDATE SET
             name = $4, type = $5, branch = $6, current_task = $7, active_files = $8,
             status = $9, capabilities = $10, last_heartbeat = $11`,
          [
            agent.agentId, userId, workspaceId, agent.name, agent.type,
            agent.branch || null, agent.currentTask || null,
            agent.activeFiles, agent.status, agent.capabilities,
            agent.lastHeartbeat, agent.connectedAt,
          ],
        );
      }

      // Notify via Supabase Realtime that presence was updated
      await this.config.transport.publish(`agent:presence:${workspaceId}`, {
        type: "context:set" as const,
        channel: `agent:presence:${workspaceId}`,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Non-fatal — local SQLite is the source of truth
    }
  }

  /**
   * Query agent presence from GCP Cloud SQL (for cross-machine discovery).
   */
  async discoverRemoteAgents(): Promise<AgentPresence[]> {
    const pool = this.config.cloudSQLPool;
    if (!pool) return [];

    try {
      const result = await pool.query(
        `SELECT * FROM agent_presence WHERE workspace_id = $1 AND status != 'disconnected'
         AND last_heartbeat > NOW() - INTERVAL '2 minutes'`,
        [this.config.workspaceId],
      );

      return result.rows.map((row: any) => ({
        agentId: row.agent_id,
        name: row.name,
        type: row.type,
        workspaceId: row.workspace_id,
        branch: row.branch || undefined,
        currentTask: row.current_task || undefined,
        activeFiles: row.active_files || [],
        status: row.status,
        lastHeartbeat: row.last_heartbeat?.toISOString() || "",
        connectedAt: row.connected_at?.toISOString() || "",
        capabilities: row.capabilities || [],
      }));
    } catch {
      return [];
    }
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private handleRemoteMessage = (msg: ContextMessage): void => {
    for (const handler of this.handlers) {
      try {
        handler({
          type: msg.type as any,
        } as any);
      } catch {
        // Non-fatal
      }
    }
  };
}
