/**
 * Context Transports
 *
 * Pub/sub transport adapters for real-time context updates.
 * - LocalTransport: in-process (default, dev)
 * - SupabaseTransport: Supabase Realtime (production)
 */

import type { ContextEntry } from "./types";

// =============================================================================
// Transport Interface
// =============================================================================

/**
 * Message published through a transport
 */
export interface ContextMessage {
  type: "context:set" | "context:delete" | "context:expired";
  channel: string;
  entry?: ContextEntry;
  entryId?: string;
  timestamp: string;
}

/**
 * Handler for channel messages
 */
export type ChannelHandler = (message: ContextMessage) => void;

/**
 * Transport interface for context pub/sub.
 * Implementations handle how messages are delivered between subscribers.
 */
export interface ContextTransport {
  /** Publish a message to a channel */
  publish(channel: string, message: ContextMessage): void | Promise<void>;

  /** Subscribe to a channel */
  subscribe(channel: string, handler: ChannelHandler): void;

  /** Unsubscribe from a channel */
  unsubscribe(channel: string, handler: ChannelHandler): void;

  /** Disconnect and clean up resources */
  disconnect(): void | Promise<void>;
}

// =============================================================================
// Local Transport (In-Process)
// =============================================================================

/**
 * In-process pub/sub using Map<channel, Set<handler>>.
 * Default transport — zero external deps, suitable for single-process / dev.
 */
export class LocalTransport implements ContextTransport {
  private channels = new Map<string, Set<ChannelHandler>>();

  publish(channel: string, message: ContextMessage): void {
    const handlers = this.channels.get(channel);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler(message);
      } catch (error) {
        console.error(`[LocalTransport] handler error on channel "${channel}":`, error);
      }
    }
  }

  subscribe(channel: string, handler: ChannelHandler): void {
    let handlers = this.channels.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.channels.set(channel, handlers);
    }
    handlers.add(handler);
  }

  unsubscribe(channel: string, handler: ChannelHandler): void {
    const handlers = this.channels.get(channel);
    if (!handlers) return;

    handlers.delete(handler);
    if (handlers.size === 0) {
      this.channels.delete(channel);
    }
  }

  disconnect(): void {
    this.channels.clear();
  }
}

// =============================================================================
// Supabase Transport (Realtime)
// =============================================================================

/**
 * Supabase Realtime transport via broadcast channels.
 * Uses `supabase.channel().on('broadcast', ...)` for cross-client pub/sub.
 * Suitable for production — leverages existing Supabase infra.
 */
export class SupabaseTransport implements ContextTransport {
  private supabase: SupabaseClient;
  private realtimeChannels = new Map<string, RealtimeChannelHandle>();
  private handlers = new Map<string, Set<ChannelHandler>>();

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  async publish(channel: string, message: ContextMessage): Promise<void> {
    const ch = this.ensureChannel(channel);
    await ch.send({
      type: "broadcast",
      event: "context_message",
      payload: message,
    });
  }

  subscribe(channel: string, handler: ChannelHandler): void {
    // Track handler
    let handlers = this.handlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(channel, handlers);
    }
    handlers.add(handler);

    // Ensure realtime channel is subscribed
    this.ensureChannel(channel);
  }

  unsubscribe(channel: string, handler: ChannelHandler): void {
    const handlers = this.handlers.get(channel);
    if (!handlers) return;

    handlers.delete(handler);
    if (handlers.size === 0) {
      this.handlers.delete(channel);
      // Unsubscribe from Supabase channel
      const ch = this.realtimeChannels.get(channel);
      if (ch) {
        this.supabase.removeChannel(ch.channel);
        this.realtimeChannels.delete(channel);
      }
    }
  }

  async disconnect(): Promise<void> {
    for (const [, handle] of this.realtimeChannels) {
      this.supabase.removeChannel(handle.channel);
    }
    this.realtimeChannels.clear();
    this.handlers.clear();
  }

  private ensureChannel(channel: string): RealtimeChannelHandle {
    let handle = this.realtimeChannels.get(channel);
    if (handle) return handle;

    const realtimeChannel = this.supabase.channel(`context:${channel}`);

    realtimeChannel.on("broadcast", { event: "context_message" }, (payload) => {
      const message = (payload as Record<string, unknown>).payload as ContextMessage;
      const handlers = this.handlers.get(channel);
      if (!handlers) return;

      for (const handler of handlers) {
        try {
          handler(message);
        } catch (error) {
          console.error(`[SupabaseTransport] handler error on "${channel}":`, error);
        }
      }
    });

    realtimeChannel.subscribe();

    handle = { channel: realtimeChannel, send: (msg) => realtimeChannel.send(msg) };
    this.realtimeChannels.set(channel, handle);
    return handle;
  }
}

// =============================================================================
// Internal Types (loose typing to avoid hard dep on Supabase types)
// =============================================================================

/** Minimal Supabase client interface — avoids hard coupling to @supabase/supabase-js */
interface SupabaseClient {
  channel(name: string): RealtimeChannel;
  removeChannel(channel: RealtimeChannel): void;
}

interface RealtimeChannel {
  on(type: string, filter: Record<string, unknown>, callback: (payload: unknown) => void): RealtimeChannel;
  send(message: Record<string, unknown>): Promise<unknown>;
  subscribe(): RealtimeChannel;
}

interface RealtimeChannelHandle {
  channel: RealtimeChannel;
  send: (message: Record<string, unknown>) => Promise<unknown>;
}
