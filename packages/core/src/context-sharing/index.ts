/**
 * Context Sharing Module
 *
 * Cross-agent context sharing.
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
  CodeSnippetContext,
  DecisionContext,
  DependencyContext,
} from "./types";

export {
  DEFAULT_CHANNEL_SETTINGS,
  DEFAULT_CONTEXT_TTL,
} from "./types";

// Manager
export {
  ContextManager,
  createContextManager,
  type SetContextOptions,
  type ContextEventHandler,
} from "./manager";
