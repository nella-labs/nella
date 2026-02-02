/**
 * Cloud Sync Types
 *
 * Type definitions for Google Cloud Storage synchronization.
 */

// =============================================================================
// Configuration
// =============================================================================

export interface CloudSyncConfig {
  /** GCP project ID */
  projectId: string;

  /** GCS bucket name */
  bucketName: string;

  /** Path prefix in bucket */
  prefix?: string;

  /** Auto sync interval in seconds (0 to disable) */
  autoSyncInterval: number;

  /** Conflict resolution strategy */
  conflictResolution: "local-wins" | "remote-wins" | "manual" | "newest-wins";

  /** Conflict strategy (alias for conflictResolution) */
  conflictStrategy?: "local-wins" | "remote-wins" | "manual" | "newest-wins";

  /** Enable encryption */
  encryption?: boolean;

  /** Encryption key */
  encryptionKey?: string;

  /** File patterns to include */
  include: string[];

  /** File patterns to exclude */
  exclude: string[];
}

export const DEFAULT_SYNC_CONFIG: Omit<CloudSyncConfig, "projectId" | "bucketName"> = {
  prefix: "",
  autoSyncInterval: 0,
  conflictResolution: "manual",
  conflictStrategy: "manual",
  encryption: false,
  include: ["**/*"],
  exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
};

// =============================================================================
// State
// =============================================================================

export type SyncStatus = "idle" | "syncing" | "conflict" | "error";

export type FileSyncStatus = "synced" | "pending-upload" | "pending-download" | "conflict" | "error" | "local-only" | "remote-only";

export interface SyncFileState {
  /** Relative file path */
  path: string;

  /** Current sync status */
  status: FileSyncStatus;

  /** Local file hash */
  localHash?: string;

  /** Remote file hash */
  remoteHash?: string;

  /** Last modified locally */
  localModified?: string;

  /** Last modified remotely */
  remoteModified?: string;

  /** Last synced time */
  lastSynced?: string;
}

export interface PendingChange {
  /** File path */
  path: string;

  /** Change type */
  type: "upload" | "download" | "delete" | "conflict";

  /** Timestamp */
  timestamp: string;
}

export interface SyncState {
  /** Workspace ID */
  workspaceId: string;

  /** Current sync status */
  status: SyncStatus;

  /** Last successful sync time */
  lastSync: string | null;

  /** File states */
  files: SyncFileState[];

  /** Pending changes */
  pending: PendingChange[];

  /** Errors */
  errors: SyncError[];
}

// =============================================================================
// Stats
// =============================================================================

export interface SyncStats {
  /** Files uploaded */
  uploaded: number;

  /** Files downloaded */
  downloaded: number;

  /** Files deleted */
  deleted: number;

  /** Conflicts detected */
  conflicts: number;

  /** Errors encountered */
  errors: number;

  /** Duration in milliseconds */
  duration: number;
}

// =============================================================================
// Events
// =============================================================================

export type SyncEvent =
  | { type: "sync:started"; workspaceId: string }
  | { type: "sync:completed"; workspaceId: string; stats: SyncStats }
  | { type: "sync:error"; workspaceId: string; error: string }
  | { type: "sync:conflict"; workspaceId: string; path: string }
  | { type: "file:uploaded"; path: string }
  | { type: "file:downloaded"; path: string }
  | { type: "file:deleted"; path: string };

// =============================================================================
// Errors
// =============================================================================

export interface SyncError {
  /** File path */
  path: string;

  /** Error message */
  message: string;

  /** Timestamp */
  timestamp: string;
}
