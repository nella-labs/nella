/**
 * Context Sharing Module
 *
 * Cross-agent context sharing backed by SQLite.
 */

// Types
export type {
  ContextEntry,
  ContextType,
  ContextVisibility,
  ContextChannel,
  ContextQuery,
  ContextQueryResult,
  ContextEvent,
  ContextStore,
  ContextVersion,
  ContextSchema,
  SchemaValidationResult,
  ContextSearchOptions,
  ContextSnapshot,
  ImportStrategy,
  CodeSnippetContext,
  DecisionContext,
  DependencyContext,
} from "./types";

export {
  DEFAULT_CHANNEL_SETTINGS,
  DEFAULT_CONTEXT_TTL,
  DEFAULT_MAX_VERSIONS,
  DEFAULT_CLEANUP_INTERVAL_MS,
  DEFAULT_EXPIRING_WARNING_MS,
} from "./types";

// Errors
export {
  ContextConflictError,
  ContextValidationError,
} from "./errors";

// Transports
export type {
  ContextTransport,
  ContextMessage,
  ChannelHandler,
} from "./transports";

export {
  LocalTransport,
  SupabaseTransport,
} from "./transports";

// Manager
export {
  ContextManager,
  createContextManager,
  type SetContextOptions,
  type ContextManagerOptions,
  type ContextEventHandler,
} from "./manager";
