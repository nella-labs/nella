/**
 * Auth Module Types
 *
 * Types for API key management and agent authentication.
 */

import type { RateLimiterConfig as RateLimitConfig } from "../rate-limit/types";
import { DEFAULT_RATE_LIMITER_CONFIG } from "../rate-limit/types";

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
 * Rate limit configuration — canonical type from rate-limit module.
 * Re-exported here for backward compatibility.
 */
export type { RateLimitConfig };

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

/**
 * Default rate limit — re-exported from rate-limit module for backward compatibility.
 */
export const DEFAULT_RATE_LIMIT = DEFAULT_RATE_LIMITER_CONFIG;

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

// =============================================================================
// Audit Log Types
// =============================================================================

/**
 * Audit log entry
 */
export interface AuditEntry {
  /** Unique entry ID */
  id: string;
  
  /** Timestamp ISO string */
  timestamp: string;
  
  /** Audit action category */
  category: AuditCategory;
  
  /** Specific action performed */
  action: string;
  
  /** Actor who performed the action */
  actor: {
    type: "key" | "agent" | "system" | "user";
    id: string;
    name?: string;
    ip?: string;
  };
  
  /** Target of the action */
  target?: {
    type: "key" | "agent" | "workspace" | "context";
    id: string;
    name?: string;
  };
  
  /** Action outcome */
  outcome: "success" | "failure" | "denied";
  
  /** Additional details */
  details?: Record<string, unknown>;
  
  /** Error message if failed */
  error?: string;
}

/**
 * Audit categories
 */
export type AuditCategory =
  | "authentication"
  | "authorization"
  | "key_management"
  | "agent_management"
  | "configuration"
  | "data_access";

/**
 * Audit log configuration
 */
export interface AuditLogConfig {
  /** Enable audit logging */
  enabled: boolean;
  
  /** Log file path (relative to storage) */
  logPath: string;
  
  /** Maximum log file size in bytes before rotation */
  maxFileSize: number;
  
  /** Number of rotated files to keep */
  maxFiles: number;
  
  /** Categories to log (empty = all) */
  categories: AuditCategory[];
  
  /** Minimum severity to log */
  minSeverity: "info" | "warn" | "error";
}

export const DEFAULT_AUDIT_CONFIG: AuditLogConfig = {
  enabled: true,
  logPath: "audit.log",
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
  categories: [],
  minSeverity: "info",
};

// =============================================================================
// JWT Token Types
// =============================================================================

/**
 * JWT payload for session tokens
 */
export interface JWTPayload {
  /** Subject (key ID or agent ID) */
  sub: string;
  
  /** Issuer */
  iss: string;
  
  /** Audience */
  aud: string;
  
  /** Issued at (Unix timestamp) */
  iat: number;
  
  /** Expiration (Unix timestamp) */
  exp: number;
  
  /** Not before (Unix timestamp) */
  nbf?: number;
  
  /** JWT ID */
  jti: string;
  
  /** Custom claims */
  claims: {
    /** Key prefix for identification */
    keyPrefix?: string;
    
    /** Workspace ID */
    workspaceId?: string | null;
    
    /** Agent ID */
    agentId?: string | null;
    
    /** Permissions snapshot */
    permissions: ApiKeyPermissions;
    
    /** Session metadata */
    session?: {
      ip?: string;
      userAgent?: string;
      origin?: string;
    };
  };
}

/**
 * JWT configuration
 */
export interface JWTConfig {
  /** JWT signing secret (from env) */
  secret: string;
  
  /** Issuer name */
  issuer: string;
  
  /** Audience */
  audience: string;
  
  /** Token expiry (e.g., "24h", "7d") */
  expiresIn: string;
  
  /** Algorithm */
  algorithm: "HS256" | "HS384" | "HS512";
}

export const DEFAULT_JWT_CONFIG: Omit<JWTConfig, "secret"> = {
  issuer: "nella",
  audience: "nella-api",
  expiresIn: "24h",
  algorithm: "HS256",
};

// =============================================================================
// Key Rotation Types
// =============================================================================

/**
 * Key rotation policy
 */
export interface RotationPolicy {
  /** Enable automatic rotation */
  enabled: boolean;
  
  /** Rotation interval in days */
  intervalDays: number;
  
  /** Overlap period in hours (old key remains valid) */
  overlapHours: number;
  
  /** Notify before rotation (hours) */
  notifyBeforeHours: number;
  
  /** Auto-revoke old key after overlap */
  autoRevokeOld: boolean;
}

export const DEFAULT_ROTATION_POLICY: RotationPolicy = {
  enabled: false,
  intervalDays: 90,
  overlapHours: 24,
  notifyBeforeHours: 72,
  autoRevokeOld: true,
};

/**
 * Rotation event
 */
export interface RotationEvent {
  /** Old key ID */
  oldKeyId: string;
  
  /** New key ID */
  newKeyId: string;
  
  /** Rotation timestamp */
  rotatedAt: string;
  
  /** When old key will be revoked */
  oldKeyExpiresAt: string;
  
  /** Reason for rotation */
  reason: "scheduled" | "manual" | "compromised";
}

// =============================================================================
// IP Whitelist Types
// =============================================================================

/**
 * IP whitelist configuration
 */
export interface IPWhitelistConfig {
  /** Enable IP whitelisting */
  enabled: boolean;
  
  /** Whitelist mode */
  mode: "allow" | "deny";
  
  /** IP addresses or CIDR ranges */
  addresses: string[];
  
  /** Allow localhost bypass in development */
  allowLocalhost: boolean;
}

export const DEFAULT_IP_WHITELIST: IPWhitelistConfig = {
  enabled: false,
  mode: "allow",
  addresses: [],
  allowLocalhost: true,
};

// =============================================================================
// Request Signing Types
// =============================================================================

/**
 * Request signing configuration
 */
export interface RequestSigningConfig {
  /** Enable request signing */
  enabled: boolean;
  
  /** Signing algorithm */
  algorithm: "hmac-sha256" | "hmac-sha512";
  
  /** Headers to include in signature */
  signedHeaders: string[];
  
  /** Maximum timestamp drift in seconds */
  timestampTolerance: number;
}

export const DEFAULT_REQUEST_SIGNING: RequestSigningConfig = {
  enabled: false,
  algorithm: "hmac-sha256",
  signedHeaders: ["host", "date", "content-type"],
  timestampTolerance: 300, // 5 minutes
};

/**
 * Signed request headers
 */
export interface SignedRequestHeaders {
  /** Key ID used for signing */
  "x-nella-key-id": string;
  
  /** Timestamp of request */
  "x-nella-timestamp": string;
  
  /** Request nonce */
  "x-nella-nonce"?: string;
  
  /** Signature */
  "x-nella-signature": string;
  
  /** Body hash (optional) */
  "x-nella-body-hash"?: string;
}

// =============================================================================
// Extended Auth Events
// =============================================================================

/**
 * Extended auth events (includes new Phase 3 events)
 */
export type ExtendedAuthEvent =
  | AuthEvent
  | { type: "key:rotated"; event: RotationEvent }
  | { type: "key:rotation_scheduled"; keyId: string; scheduledAt: string }
  | { type: "key:encrypted"; keyId: string }
  | { type: "key:decrypted"; keyId: string }
  | { type: "token:issued"; jti: string; keyId: string; expiresAt: string }
  | { type: "token:revoked"; jti: string; reason: string }
  | { type: "token:expired"; jti: string }
  | { type: "ip:blocked"; ip: string; reason: string }
  | { type: "ip:allowed"; ip: string }
  | { type: "signature:valid"; keyId: string }
  | { type: "signature:invalid"; keyId: string; reason: string }
  | { type: "audit:logged"; entryId: string; category: AuditCategory };
