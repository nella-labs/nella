/**
 * Auth Module
 *
 * API key and agent authentication for nella.
 */

// Types
export type {
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
} from "./types";

export {
  DEFAULT_RATE_LIMIT,
  DEFAULT_PERMISSIONS,
  ADMIN_PERMISSIONS,
  DEFAULT_KEY_STORE_SETTINGS,
} from "./types";

// Key Manager
export {
  KeyManager,
  createKeyManager,
  type CreateKeyOptions,
  type AuthEventHandler as KeyEventHandler,
} from "./key-manager";

// Agent Manager
export {
  AgentManager,
  createAgentManager,
  type CreateAgentOptions,
  type AgentEventHandler,
} from "./agent-manager";

// Authenticator
export {
  Authenticator,
  createAuthenticator,
  type AuthenticatorOptions,
} from "./authenticator";
