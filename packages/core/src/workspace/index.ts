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
  GitBranchTracking,
  BranchIndexInfo,
  IndexMode,
  CloudIndexPolicy,
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
  resetDefaultRegistry,
  type WorkspaceEventHandler as RegistryEventHandler,
  type RegistryOptions,
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
  resetDefaultSwitcher,
  type SwitcherOptions,
  type SwitcherEventHandler,
  type SwitcherState,
} from "./switcher";

// Utilities
export {
  FileLock,
  withFileLock,
  createFileLock,
  type LockOptions,
  type LockInfo,
} from "./file-lock";

export {
  RegistryBackupManager,
  createBackupManager,
  type BackupOptions,
  type BackupInfo,
} from "./backup";

export {
  RegistryMigrationManager,
  createMigrationManager,
  CURRENT_REGISTRY_VERSION,
  type Migration,
  type MigrationResult,
} from "./migration";

export {
  WorkspaceValidator,
  createValidator,
  ValidationCodes,
  type ValidationResult,
  type BatchValidationResult,
  type ValidationIssue,
  type ValidationWarning,
} from "./validator";

export {
  FileWatcher,
  createFileWatcher,
  type WatcherOptions,
  type FileChangeEvent,
  type BatchChangeEvent,
  type ChangeHandler,
} from "./file-watcher";

export {
  LRUCache,
  createLRUCache,
  type LRUCacheOptions,
} from "./lru-cache";
