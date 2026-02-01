/**
 * Supabase Types
 *
 * Type definitions for Supabase integration.
 * Handles auth, API keys, agents, and realtime context sync.
 */

// =============================================================================
// Configuration
// =============================================================================

export interface SupabaseConfig {
  /** Supabase project URL */
  url: string;
  
  /** Supabase anon/public key */
  anonKey: string;
  
  /** Optional service role key (for admin operations) */
  serviceRoleKey?: string;
}

// =============================================================================
// Auth Types
// =============================================================================

export interface SupabaseUser {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
}

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: SupabaseUser;
}

export interface AuthResult {
  success: boolean;
  user?: SupabaseUser;
  session?: SupabaseSession;
  error?: string;
}

// =============================================================================
// API Key Types (stored in Supabase)
// =============================================================================

export interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  permissions: ApiKeyPermission[];
  rate_limits: ApiKeyRateLimits;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface ApiKeyPermission {
  action: "search" | "verify" | "index" | "read_context" | "write_context" | "admin";
  resource?: string;
}

export interface ApiKeyRateLimits {
  requests_per_minute: number;
  requests_per_hour: number;
  requests_per_day: number;
}

export interface CreateApiKeyRequest {
  name: string;
  permissions?: ApiKeyPermission[];
  rate_limits?: Partial<ApiKeyRateLimits>;
  expires_in_days?: number;
}

export interface CreateApiKeyResponse {
  id: string;
  key: string;  // Full key (only shown once)
  name: string;
  created_at: string;
}

// =============================================================================
// Agent Types (stored in Supabase)
// =============================================================================

export interface AgentRow {
  id: string;
  user_id: string;
  name: string;
  type: AgentType;
  api_key_id: string | null;
  config: AgentConfig;
  stats: AgentStats;
  created_at: string;
  last_active_at: string | null;
}

export type AgentType = 
  | "claude"
  | "gpt"
  | "gemini"
  | "codex"
  | "cursor"
  | "copilot"
  | "custom";

export interface AgentConfig {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  system_prompt?: string;
  allowed_tools?: string[];
  blocked_patterns?: string[];
}

export interface AgentStats {
  total_calls: number;
  total_tokens: number;
  total_cost: number;
  success_rate: number;
  avg_latency_ms: number;
}

export interface CreateAgentRequest {
  name: string;
  type: AgentType;
  api_key_id?: string;
  config?: Partial<AgentConfig>;
}

// =============================================================================
// Context Types (stored in Supabase with Realtime)
// =============================================================================

export interface ContextRow {
  id: string;
  user_id: string;
  workspace_id: string;
  key: string;
  value: unknown;
  type: ContextType;
  tags: string[];
  ttl_seconds: number | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export type ContextType = 
  | "variable"
  | "snippet"
  | "assumption"
  | "dependency"
  | "preference"
  | "custom";

export interface SetContextRequest {
  workspace_id: string;
  key: string;
  value: unknown;
  type?: ContextType;
  tags?: string[];
  ttl_seconds?: number;
}

export interface GetContextRequest {
  workspace_id: string;
  key?: string;
  type?: ContextType;
  tags?: string[];
}

// =============================================================================
// Realtime Types
// =============================================================================

export type RealtimeEvent = 
  | { type: "context:insert"; payload: ContextRow }
  | { type: "context:update"; payload: ContextRow }
  | { type: "context:delete"; payload: { id: string; key: string } }
  | { type: "agent:active"; payload: { agent_id: string; workspace_id: string } }
  | { type: "sync:status"; payload: { status: "syncing" | "synced" | "error" } };

export type RealtimeHandler = (event: RealtimeEvent) => void;

export interface RealtimeSubscription {
  unsubscribe: () => void;
}

// =============================================================================
// Database Schema Types (for type safety)
// =============================================================================

export interface SupabaseDatabase {
  public: {
    Tables: {
      api_keys: {
        Row: ApiKeyRow;
        Insert: Omit<ApiKeyRow, "id" | "created_at">;
        Update: Partial<Omit<ApiKeyRow, "id" | "user_id" | "created_at">>;
      };
      agents: {
        Row: AgentRow;
        Insert: Omit<AgentRow, "id" | "created_at" | "stats">;
        Update: Partial<Omit<AgentRow, "id" | "user_id" | "created_at">>;
      };
      context: {
        Row: ContextRow;
        Insert: Omit<ContextRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<ContextRow, "id" | "user_id" | "created_at">>;
      };
    };
  };
}

// =============================================================================
// Event Types
// =============================================================================

export type SupabaseEvent =
  | { type: "auth:signin"; user: SupabaseUser }
  | { type: "auth:signout" }
  | { type: "auth:error"; error: string }
  | { type: "realtime:connected"; channel: string }
  | { type: "realtime:disconnected"; channel: string }
  | { type: "realtime:error"; error: string };

export type SupabaseEventHandler = (event: SupabaseEvent) => void;
