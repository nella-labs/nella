/**
 * Supabase Realtime
 *
 * Realtime subscriptions for context sync across devices.
 * Uses Supabase Realtime to broadcast changes.
 */

import { getSupabaseClient, isSupabaseInitialized, onSupabaseEvent } from "./client";
import type { 
  ContextRow, 
  RealtimeEvent, 
  RealtimeHandler, 
  RealtimeSubscription,
  SupabaseEvent,
} from "./types";

// =============================================================================
// Types
// =============================================================================

type RealtimeChannel = ReturnType<ReturnType<typeof getSupabaseClient>["channel"]>;

interface ChannelState {
  channel: RealtimeChannel;
  handlers: Set<RealtimeHandler>;
}

// =============================================================================
// Realtime Manager
// =============================================================================

class RealtimeManager {
  private channels: Map<string, ChannelState> = new Map();
  private globalHandlers: Set<RealtimeHandler> = new Set();

  constructor() {
    // Listen for Supabase events
    onSupabaseEvent((event: SupabaseEvent) => {
      if (event.type === "auth:signout") {
        this.unsubscribeAll();
      }
    });
  }

  /**
   * Subscribe to context changes for a workspace
   */
  subscribeToContext(
    workspaceId: string,
    userId: string,
    handler: RealtimeHandler
  ): RealtimeSubscription {
    if (!isSupabaseInitialized()) {
      console.warn("[Realtime] Supabase not initialized");
      return { unsubscribe: () => {} };
    }

    const channelName = `context:${userId}:${workspaceId}`;
    let state = this.channels.get(channelName);

    if (!state) {
      const client = getSupabaseClient();
      const channel = client
        .channel(channelName)
        .on(
          "postgres_changes" as "system",
          {
            event: "INSERT",
            schema: "public",
            table: "context",
            filter: `workspace_id=eq.${workspaceId}`,
          } as unknown as { event: "system" },
          (payload: unknown) => {
            const p = payload as { new: ContextRow };
            this.broadcast(channelName, {
              type: "context:insert",
              payload: p.new,
            });
          }
        )
        .on(
          "postgres_changes" as "system",
          {
            event: "UPDATE",
            schema: "public",
            table: "context",
            filter: `workspace_id=eq.${workspaceId}`,
          } as unknown as { event: "system" },
          (payload: unknown) => {
            const p = payload as { new: ContextRow };
            this.broadcast(channelName, {
              type: "context:update",
              payload: p.new,
            });
          }
        )
        .on(
          "postgres_changes" as "system",
          {
            event: "DELETE",
            schema: "public",
            table: "context",
            filter: `workspace_id=eq.${workspaceId}`,
          } as unknown as { event: "system" },
          (payload: unknown) => {
            const p = payload as { old: { id: string; key: string } };
            this.broadcast(channelName, {
              type: "context:delete",
              payload: { id: p.old.id, key: p.old.key },
            });
          }
        )
        .subscribe((status: string) => {
          if (status === "SUBSCRIBED") {
            this.broadcastGlobal({
              type: "sync:status",
              payload: { status: "synced" },
            });
          } else if (status === "CHANNEL_ERROR") {
            this.broadcastGlobal({
              type: "sync:status",
              payload: { status: "error" },
            });
          }
        });

      state = { channel, handlers: new Set() };
      this.channels.set(channelName, state);
    }

    state.handlers.add(handler);

    return {
      unsubscribe: () => {
        state!.handlers.delete(handler);
        if (state!.handlers.size === 0) {
          this.unsubscribeChannel(channelName);
        }
      },
    };
  }

  /**
   * Subscribe to presence (who's online in a workspace)
   */
  subscribeToPresence(
    workspaceId: string,
    userId: string,
    handler: (presences: { user_id: string; agent_id?: string; online_at: string }[]) => void
  ): RealtimeSubscription {
    if (!isSupabaseInitialized()) {
      return { unsubscribe: () => {} };
    }

    const channelName = `presence:${workspaceId}`;
    const client = getSupabaseClient();

    const channel = client.channel(channelName, {
      config: {
        presence: {
          key: userId,
        },
      },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const presences = Object.entries(state).map(([key, value]) => ({
          user_id: key,
          ...((value as unknown as { agent_id?: string; online_at: string }[])[0] || { online_at: new Date().toISOString() }),
        }));
        handler(presences);
      })
      .subscribe(async (status: string) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            online_at: new Date().toISOString(),
          });
        }
      });

    return {
      unsubscribe: () => {
        channel.unsubscribe();
      },
    };
  }

  /**
   * Broadcast a message to a workspace channel
   */
  async broadcast(
    workspaceId: string,
    event: { type: string; payload: unknown }
  ): Promise<void> {
    if (!isSupabaseInitialized()) return;

    const channelName = `broadcast:${workspaceId}`;
    const client = getSupabaseClient();

    await client.channel(channelName).send({
      type: "broadcast",
      event: event.type,
      payload: event.payload,
    });
  }

  /**
   * Subscribe to broadcasts on a workspace
   */
  subscribeToBroadcasts(
    workspaceId: string,
    handler: (event: { type: string; payload: unknown }) => void
  ): RealtimeSubscription {
    if (!isSupabaseInitialized()) {
      return { unsubscribe: () => {} };
    }

    const channelName = `broadcast:${workspaceId}`;
    const client = getSupabaseClient();

    const channel = client
      .channel(channelName)
      .on("broadcast", { event: "*" }, (payload: { event: string; payload: unknown }) => {
        handler({ type: payload.event, payload: payload.payload });
      })
      .subscribe();

    return {
      unsubscribe: () => {
        channel.unsubscribe();
      },
    };
  }

  /**
   * Add global event handler
   */
  onEvent(handler: RealtimeHandler): void {
    this.globalHandlers.add(handler);
  }

  /**
   * Remove global event handler
   */
  offEvent(handler: RealtimeHandler): void {
    this.globalHandlers.delete(handler);
  }

  /**
   * Unsubscribe from a specific channel
   */
  private unsubscribeChannel(channelName: string): void {
    const state = this.channels.get(channelName);
    if (state) {
      state.channel.unsubscribe();
      this.channels.delete(channelName);
    }
  }

  /**
   * Unsubscribe from all channels
   */
  unsubscribeAll(): void {
    for (const [name, state] of this.channels) {
      state.channel.unsubscribe();
    }
    this.channels.clear();
  }

  /**
   * Broadcast event to channel handlers
   */
  private broadcastToChannel(channelName: string, event: RealtimeEvent): void {
    const state = this.channels.get(channelName);
    if (state) {
      for (const handler of state.handlers) {
        try {
          handler(event);
        } catch (error) {
          console.error("[Realtime] Handler error:", error);
        }
      }
    }
  }

  /**
   * Broadcast event to global handlers
   */
  private broadcastGlobal(event: RealtimeEvent): void {
    for (const handler of this.globalHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("[Realtime] Global handler error:", error);
      }
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

const realtimeManager = new RealtimeManager();

// =============================================================================
// Exports
// =============================================================================

export {
  realtimeManager,
  RealtimeManager,
};

/**
 * Subscribe to context changes for a workspace
 */
export function subscribeToContext(
  workspaceId: string,
  userId: string,
  handler: RealtimeHandler
): RealtimeSubscription {
  return realtimeManager.subscribeToContext(workspaceId, userId, handler);
}

/**
 * Subscribe to presence in a workspace
 */
export function subscribeToPresence(
  workspaceId: string,
  userId: string,
  handler: (presences: { user_id: string; agent_id?: string; online_at: string }[]) => void
): RealtimeSubscription {
  return realtimeManager.subscribeToPresence(workspaceId, userId, handler);
}

/**
 * Broadcast a message to workspace
 */
export async function broadcastToWorkspace(
  workspaceId: string,
  event: { type: string; payload: unknown }
): Promise<void> {
  return realtimeManager.broadcast(workspaceId, event);
}

/**
 * Subscribe to broadcasts on a workspace
 */
export function subscribeToBroadcasts(
  workspaceId: string,
  handler: (event: { type: string; payload: unknown }) => void
): RealtimeSubscription {
  return realtimeManager.subscribeToBroadcasts(workspaceId, handler);
}

/**
 * Add global realtime event handler
 */
export function onRealtimeEvent(handler: RealtimeHandler): void {
  realtimeManager.onEvent(handler);
}

/**
 * Unsubscribe from all realtime channels
 */
export function unsubscribeAllRealtime(): void {
  realtimeManager.unsubscribeAll();
}
