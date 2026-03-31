/**
 * Agent State Cloud Sync
 *
 * Syncs agent presence, tasks, and decisions across machines via
 * Supabase Realtime. Local SQLite remains the source of truth;
 * Supabase provides cross-machine relay and discovery.
 */

import type { ContextTransport, ContextMessage } from "../../context-sharing/transports";
import type { AgentRegistry } from "../../context-sharing/agent-registry";
import type {
  AgentPresence,
  AgentTask,
  AgentDecision,
  AgentRegistryEvent,
} from "../../context-sharing/agent-types";

// =============================================================================
// Types
// =============================================================================

export interface AgentStateSyncConfig {
  /** Workspace ID */
  workspaceId: string;
  /** Transport for cross-machine pub/sub (typically SupabaseTransport) */
  transport: ContextTransport;
  /** Local agent registry */
  registry: AgentRegistry;
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
   * Start syncing agent state to Supabase Realtime.
   * Subscribes to remote events and starts periodic presence broadcasts.
   */
  async startPresenceSync(): Promise<void> {
    if (this.subscribed) return;

    const { workspaceId, transport } = this.config;

    // Subscribe to presence changes
    transport.subscribe(`agent:presence:${workspaceId}`, (msg: ContextMessage) => {
      this.handleRemoteMessage(msg);
    });

    // Subscribe to task changes
    transport.subscribe(`agent:tasks:${workspaceId}`, (msg: ContextMessage) => {
      this.handleRemoteMessage(msg);
    });

    // Subscribe to decision changes
    transport.subscribe(`agent:decisions:${workspaceId}`, (msg: ContextMessage) => {
      this.handleRemoteMessage(msg);
    });

    // Subscribe to index update notifications
    transport.subscribe(`workspace:${workspaceId}:index-updated`, (msg: ContextMessage) => {
      this.handleRemoteMessage(msg);
    });

    this.subscribed = true;

    // Start periodic presence sync
    const interval = this.config.syncIntervalMs ?? 30_000;
    this.syncInterval = setInterval(() => {
      this.broadcastPresence().catch(() => {
        // Non-fatal — presence will be re-synced on next interval
      });
    }, interval);
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
   * Subscribe to remote agent events.
   */
  onRemoteEvent(handler: RemoteEventHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Broadcast an index update notification to all connected agents.
   */
  async notifyIndexUpdate(notification: IndexUpdateNotification): Promise<void> {
    const { workspaceId, transport } = this.config;
    await transport.publish(`workspace:${workspaceId}:index-updated`, {
      type: "context:set" as const,
      channel: `workspace:${workspaceId}:index-updated`,
      timestamp: new Date().toISOString(),
    });
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private handleRemoteMessage = (msg: ContextMessage): void => {
    // Forward to registered handlers
    // The message contains the event type and data
    for (const handler of this.handlers) {
      try {
        // Parse the event from the message
        handler({
          type: msg.type as any,
          ...(msg.entry ? { agent: msg.entry } : {}),
        } as any);
      } catch {
        // Non-fatal
      }
    }
  };

  private async broadcastPresence(): Promise<void> {
    const { workspaceId, transport, registry } = this.config;

    // Discover local agents and broadcast their presence
    const agents = registry.discoverAgents(workspaceId);
    for (const agent of agents) {
      await transport.publish(`agent:presence:${workspaceId}`, {
        type: "context:set",
        channel: `agent:presence:${workspaceId}`,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
