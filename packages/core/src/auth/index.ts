/**
 * Auth Module
 *
 * API key and agent authentication for nella.
 * 
 * Features:
 * - API key management with encryption and rotation
 * - Agent registration and authentication
 * - JWT session tokens
 * - Audit logging
 * - IP whitelisting
 * - Request signing
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Core types
  ApiKey,
  ApiKeyPermissions,
  RateLimitConfig,
  Agent,
  AgentType,
  AgentConfig,
  AuthRequest,
  AuthAction,
  AuthResult,
  AuthErrorCode,
  KeyStore,
  KeyStoreSettings,
  AuthEvent,
  // JWT types
  JWTPayload,
  JWTConfig,
  // Audit types
  AuditEntry,
  AuditCategory,
  AuditLogConfig,
  // Rotation types
  RotationPolicy,
  RotationEvent,
  // Middleware types
  IPWhitelistConfig,
  RequestSigningConfig,
  SignedRequestHeaders,
  // Extended event type
  ExtendedAuthEvent,
} from "./types";

export {
  DEFAULT_RATE_LIMIT,
  DEFAULT_PERMISSIONS,
  ADMIN_PERMISSIONS,
  DEFAULT_KEY_STORE_SETTINGS,
  DEFAULT_JWT_CONFIG,
  DEFAULT_AUDIT_CONFIG,
  DEFAULT_ROTATION_POLICY,
  DEFAULT_IP_WHITELIST,
  DEFAULT_REQUEST_SIGNING,
} from "./types";

// =============================================================================
// Key Manager
// =============================================================================

export {
  KeyManager,
  createKeyManager,
  createKeyManagerFromEnv,
  type CreateKeyOptions,
  type AuthEventHandler as KeyEventHandler,
  type KeyManagerOptions,
} from "./key-manager";

// =============================================================================
// Agent Manager
// =============================================================================

export {
  AgentManager,
  createAgentManager,
  type CreateAgentOptions,
  type AgentEventHandler,
} from "./agent-manager";

// =============================================================================
// Authenticator
// =============================================================================

export {
  Authenticator,
  createAuthenticator,
  type AuthenticatorOptions,
} from "./authenticator";

// =============================================================================
// Token Manager (JWT)
// =============================================================================

export {
  TokenManager,
  getTokenManager,
  createTokenManager,
  resetTokenManager,
  type TokenManagerOptions,
  type TokenResult,
  type TokenValidationResult,
  type TokenEventHandler,
} from "./token-manager";

// =============================================================================
// Audit Log
// =============================================================================

export {
  AuditLogManager,
  getAuditLog,
  createAuditLog,
  resetAuditLog,
  type AuditLogOptions,
  type AuditEventHandler,
} from "./audit-log";

// =============================================================================
// Middleware (IP Filter & Request Signing)
// =============================================================================

export {
  IPFilter,
  RequestSigner,
  getIPFilter,
  getRequestSigner,
  createIPFilterMiddleware,
  createSigningMiddleware,
  resetMiddleware,
  type IPValidationResult,
  type SignatureValidationResult,
  type MiddlewareEventHandler,
} from "./middleware";
