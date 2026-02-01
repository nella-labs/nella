/**
 * Auth Module Types
 *
 * Types for API key management and agent authentication.
 */

// =============================================================================
// API Key Types
// =============================================================================

/**
 * API Key entry
 */
export interface ApiKey {
  /** Unique key ID (public identifier) */
  id: string;
  
  /** Key name for display */
  name: string;
  
  /** Hashed key value (never store raw key) */
  keyHash: string;
  
  /** Key prefix for identification (first 8 chars) */
  prefix: string;
  
  /** Workspace this key belongs to (null = global) */
  workspaceId: string | null;
  
  /** Agent ID this key is scoped to (null = all agents) */
  agentId: string | null;
  
  /** Permissions granted */
  permissions: ApiKeyPermissions;
  
  /** Rate limit override (null = use defaults) */
  rateLimit: RateLimitConfig | null;
  
  /** Key metadata */
  metadata: {
    createdAt: string;
    createdBy: string;
    lastUsed: string | null;
    expiresAt: string | null;
    usageCount: number;
  };
  
  /** Whether key is active */
  active: boolean;
  
  /** Revocation info */
  revocation?: {
    revokedAt: string;
    revokedBy: string;
    reason: string;
  };
}

/**
 * API Key permissions
 */
export interface ApiKeyPermissions {
  /** Can search the index */
  search: boolean;
  
  /** Can verify code */
  verify: boolean;
  
  /** Can index files */
  index: boolean;
  
  /** Can read shared context */
  readContext: boolean;
  
  /** Can write shared context */
  writeContext: boolean;
  
  /** Can manage sessions */
  manageSessions: boolean;
  
  /** Admin access (all permissions + key management) */
  admin: boolean;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Requests per minute */
  requestsPerMinute: number;
  
  /** Requests per hour */
  requestsPerHour: number;
  
  /** Requests per day */
  requestsPerDay: number;
  
  /** Max tokens per request */
  maxTokensPerRequest: number;
  
  /** Max concurrent requests */
  maxConcurrent: number;
}

// =============================================================================
// Agent Types
// =============================================================================

/**
 * Agent registration
 */
export interface Agent {
  /** Unique agent ID */
  id: string;
  
  /** Agent name */
  name: string;
  
  /** Agent type/provider */
  type: AgentType;
  
  /** Workspace this agent belongs to */
  workspaceId: string;
  
  /** Agent-specific configuration */
  config: AgentConfig;
  
  /** Agent metadata */
  metadata: {
    createdAt: string;
    lastActive: string | null;
    totalRequests: number;
    totalTokens: number;
  };
  
  /** Whether agent is active */
  active: boolean;
}

/**
 * Agent types
 */
export type AgentType = 
  | "copilot"
  | "cursor"
  | "cline"
  | "aider"
  | "continue"
  | "custom";

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Default permissions for this agent */
  defaultPermissions: ApiKeyPermissions;
  
  /** Rate limit for this agent */
  rateLimit: RateLimitConfig;
  
  /** Allowed file patterns */
  allowedPatterns: string[];
  
  /** Blocked file patterns */
  blockedPatterns: string[];
  
  /** Custom settings */
  settings: Record<string, unknown>;
}

// =============================================================================
// Authentication Types
// =============================================================================

/**
 * Auth request
 */
export interface AuthRequest {
  /** API key (raw value) */
  apiKey: string;
  
  /** Request origin (for logging) */
  origin?: string;
  
  /** Request action */
  action: AuthAction;
}

/**
 * Auth actions
 */
export type AuthAction = 
  | "search"
  | "verify"
  | "index"
  | "read_context"
  | "write_context"
  | "manage_sessions"
  | "admin";

/**
 * Auth result
 */
export interface AuthResult {
  /** Whether auth succeeded */
  success: boolean;
  
  /** Resolved key (if success) */
  key?: ApiKey;
  
  /** Resolved agent (if applicable) */
  agent?: Agent;
  
  /** Error message (if failed) */
  error?: string;
  
  /** Error code */
  errorCode?: AuthErrorCode;
}

/**
 * Auth error codes
 */
export type AuthErrorCode =
  | "INVALID_KEY"
  | "EXPIRED_KEY"
  | "REVOKED_KEY"
  | "INSUFFICIENT_PERMISSIONS"
  | "RATE_LIMITED"
  | "WORKSPACE_MISMATCH"
  | "AGENT_INACTIVE";

// =============================================================================
// Key Store Types
// =============================================================================

/**
 * Key store data
 */
export interface KeyStore {
  keys: ApiKey[];
  agents: Agent[];
  settings: KeyStoreSettings;
  version: string;
  updatedAt: string;
}

/**
 * Key store settings
 */
export interface KeyStoreSettings {
  /** Default rate limits */
  defaultRateLimit: RateLimitConfig;
  
  /** Default permissions for new keys */
  defaultPermissions: ApiKeyPermissions;
  
  /** Key expiry in days (0 = never) */
  keyExpiryDays: number;
  
  /** Whether to log all auth requests */
  logAuthRequests: boolean;
  
  /** Encryption key for sensitive data */
  encryptionEnabled: boolean;
}

// =============================================================================
// Auth Events
// =============================================================================

/**
 * Auth event types
 */
export type AuthEvent =
  | { type: "key:created"; key: ApiKey; rawKey: string }
  | { type: "key:revoked"; keyId: string; reason: string }
  | { type: "key:used"; keyId: string; action: AuthAction }
  | { type: "agent:created"; agent: Agent }
  | { type: "agent:updated"; agent: Agent }
  | { type: "agent:deactivated"; agentId: string }
  | { type: "auth:success"; keyId: string; action: AuthAction }
  | { type: "auth:failure"; error: AuthErrorCode; keyPrefix?: string };

// =============================================================================
// Defaults
// =============================================================================

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
  maxTokensPerRequest: 100000,
  maxConcurrent: 5,
};

export const DEFAULT_PERMISSIONS: ApiKeyPermissions = {
  search: true,
  verify: true,
  index: false,
  readContext: true,
  writeContext: false,
  manageSessions: false,
  admin: false,
};

export const ADMIN_PERMISSIONS: ApiKeyPermissions = {
  search: true,
  verify: true,
  index: true,
  readContext: true,
  writeContext: true,
  manageSessions: true,
  admin: true,
};

export const DEFAULT_KEY_STORE_SETTINGS: KeyStoreSettings = {
  defaultRateLimit: DEFAULT_RATE_LIMIT,
  defaultPermissions: DEFAULT_PERMISSIONS,
  keyExpiryDays: 90,
  logAuthRequests: true,
  encryptionEnabled: false,
};
