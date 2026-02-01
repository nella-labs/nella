/**
 * Workspace Module
 *
 * Multi-workspace management for nella.
 * Provides isolated indexing, sessions, and context per project.
 */

// Types
export type {
  WorkspaceEntry,
  WorkspaceConfig,
  WorkspaceRegistry as IWorkspaceRegistry,
  RegistrySettings,
  WorkspaceEvent,
} from "./types";

export {
  DEFAULT_WORKSPACE_CONFIG,
  DEFAULT_REGISTRY_SETTINGS,
} from "./types";

// Registry
export {
  WorkspaceRegistry,
  getWorkspaceRegistry,
  createWorkspaceRegistry,
  type WorkspaceEventHandler as RegistryEventHandler,
} from "./registry";

// Workspace
export {
  Workspace,
  type WorkspaceOptions,
  type SharedContext,
  type WorkspaceEventHandler,
} from "./workspace";

// Switcher
export {
  WorkspaceSwitcher,
  getWorkspaceSwitcher,
  createWorkspaceSwitcher,
  type SwitcherOptions,
  type SwitcherEventHandler,
} from "./switcher";
