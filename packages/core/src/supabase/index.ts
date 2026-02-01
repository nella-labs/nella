/**
 * Supabase Module
 *
 * Provides Supabase integration for nella:
 * - Auth (user authentication)
 * - API Keys & Agents (stored with RLS)
 * - Context (realtime sync across devices)
 */

// Types
export type {
  SupabaseConfig,
  SupabaseUser,
  SupabaseSession,
  AuthResult,
  ApiKeyRow,
  ApiKeyPermission,
  ApiKeyRateLimits,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  AgentRow,
  AgentType,
  AgentConfig,
  AgentStats,
  CreateAgentRequest,
  ContextRow,
  ContextType,
  SetContextRequest,
  GetContextRequest,
  RealtimeEvent,
  RealtimeHandler,
  RealtimeSubscription,
  SupabaseEvent,
  SupabaseEventHandler,
} from "./types";

// Client
export {
  initSupabase,
  getSupabaseClient,
  getSupabaseAdminClient,
  isSupabaseAvailable,
  isSupabaseInitialized,
  onSupabaseEvent,
  disconnectSupabase,
  resetSupabase,
  supabaseManager,
} from "./client";

// Auth
export {
  signInWithEmail,
  signUpWithEmail,
  signInWithMagicLink,
  signInWithOAuth,
  signOut,
  getSession,
  getUser,
  refreshSession,
  updateUser,
  resetPassword,
  verifyOtp,
} from "./auth";

// Realtime
export {
  subscribeToContext,
  subscribeToPresence,
  broadcastToWorkspace,
  subscribeToBroadcasts,
  onRealtimeEvent,
  unsubscribeAllRealtime,
  realtimeManager,
} from "./realtime";
