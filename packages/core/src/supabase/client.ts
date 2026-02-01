/**
 * Supabase Client
 *
 * Initializes and manages the Supabase client connection.
 * Provides singleton access with lazy initialization.
 */

import type { SupabaseConfig, SupabaseEventHandler, SupabaseEvent } from "./types";

// =============================================================================
// Types
// =============================================================================

type SupabaseClientType = ReturnType<typeof import("@supabase/supabase-js").createClient>;

// =============================================================================
// Client Manager
// =============================================================================

class SupabaseClientManager {
  private client: SupabaseClientType | null = null;
  private config: SupabaseConfig | null = null;
  private eventHandlers: SupabaseEventHandler[] = [];
  private available: boolean = false;

  constructor() {
    this.checkAvailability();
  }

  private checkAvailability(): void {
    try {
      require("@supabase/supabase-js");
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  /**
   * Check if Supabase SDK is available
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Initialize with configuration
   */
  init(config: SupabaseConfig): void {
    if (!this.available) {
      throw new Error("@supabase/supabase-js is not installed. Run: pnpm add @supabase/supabase-js");
    }

    if (!config.url || !config.anonKey) {
      throw new Error("Supabase URL and anon key are required");
    }

    this.config = config;
    this.client = null; // Reset client on re-init
  }

  /**
   * Get or create the Supabase client
   */
  getClient(): SupabaseClientType {
    if (!this.config) {
      throw new Error("Supabase not initialized. Call init() first with your config.");
    }

    if (!this.client) {
      const { createClient } = require("@supabase/supabase-js");
      
      const client = createClient(this.config.url, this.config.anonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
        realtime: {
          params: {
            eventsPerSecond: 10,
          },
        },
      });
      
      this.client = client;

      // Set up auth state change listener
      client.auth.onAuthStateChange((event: string, session: unknown) => {
        if (event === "SIGNED_IN" && session) {
          const rawUser = (session as { user: Record<string, unknown> }).user;
          this.emit({ 
            type: "auth:signin", 
            user: {
              id: String(rawUser.id),
              email: String(rawUser.email || ""),
              created_at: String(rawUser.created_at || new Date().toISOString()),
              updated_at: String(rawUser.updated_at || new Date().toISOString()),
              app_metadata: (rawUser.app_metadata as Record<string, unknown>) || {},
              user_metadata: (rawUser.user_metadata as Record<string, unknown>) || {},
            }
          });
        } else if (event === "SIGNED_OUT") {
          this.emit({ type: "auth:signout" });
        }
      });
    }

    return this.client!;
  }

  /**
   * Get admin client (uses service role key)
   */
  getAdminClient(): SupabaseClientType {
    if (!this.config?.serviceRoleKey) {
      throw new Error("Service role key not configured");
    }

    const { createClient } = require("@supabase/supabase-js");
    
    return createClient(this.config.url, this.config.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.config !== null;
  }

  /**
   * Get current configuration (without sensitive keys)
   */
  getConfig(): { url: string } | null {
    if (!this.config) return null;
    return { url: this.config.url };
  }

  /**
   * Add event handler
   */
  onEvent(handler: SupabaseEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Remove event handler
   */
  offEvent(handler: SupabaseEventHandler): void {
    this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
  }

  /**
   * Emit event to all handlers
   */
  private emit(event: SupabaseEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("[Supabase] Event handler error:", error);
      }
    }
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.removeAllChannels();
      this.client = null;
    }
  }

  /**
   * Reset the manager
   */
  reset(): void {
    this.disconnect();
    this.config = null;
    this.eventHandlers = [];
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

const manager = new SupabaseClientManager();

// =============================================================================
// Exports
// =============================================================================

/**
 * Initialize Supabase client
 */
export function initSupabase(config: SupabaseConfig): void {
  manager.init(config);
}

/**
 * Get Supabase client (throws if not initialized)
 */
export function getSupabaseClient(): SupabaseClientType {
  return manager.getClient();
}

/**
 * Get admin Supabase client (requires service role key)
 */
export function getSupabaseAdminClient(): SupabaseClientType {
  return manager.getAdminClient();
}

/**
 * Check if Supabase is available
 */
export function isSupabaseAvailable(): boolean {
  return manager.isAvailable();
}

/**
 * Check if Supabase is initialized
 */
export function isSupabaseInitialized(): boolean {
  return manager.isInitialized();
}

/**
 * Add Supabase event handler
 */
export function onSupabaseEvent(handler: SupabaseEventHandler): void {
  manager.onEvent(handler);
}

/**
 * Disconnect Supabase
 */
export async function disconnectSupabase(): Promise<void> {
  await manager.disconnect();
}

/**
 * Reset Supabase manager
 */
export function resetSupabase(): void {
  manager.reset();
}

// Export manager for advanced usage
export { manager as supabaseManager };
