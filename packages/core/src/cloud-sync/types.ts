/**
 * Cloud Sync Types
 *
 * Types for Google Cloud Storage synchronization.
 */

// =============================================================================
// Sync Types
// =============================================================================

/**
 * Cloud sync configuration
 */
export interface CloudSyncConfig {
  /** Google Cloud project ID */
  projectId: string;
  
  /** GCS bucket name */
  bucketName: string;
  
  /** Storage prefix (folder) */
  prefix: string;
  
  /** Enable encryption */
  encryption: boolean;
  
  /** Encryption key (for client-side encryption) */
  encryptionKey?: string;
  
  /** Service account key path (optional, uses ADC if not provided) */
  keyFilePath?: string;
  
  /** Auto-sync interval in seconds (0 = manual only) */
  autoSyncInterval: number;
  
  /** Conflict resolution strategy */
  conflictStrategy: ConflictStrategy;
  
  /** Files/patterns to sync */
  include: string[];
  
  /** Files/patterns to exclude */
  exclude: string[];
}

/**
 * Conflict resolution strategies
 */
export type ConflictStrategy =
  | "local-wins"    // Local changes always win
  | "remote-wins"   // Remote changes always win
  | "newest-wins"   // Most recent modification wins
  | "manual";       // Require manual resolution

/**
 * Sync state
 */
export interface SyncState {
  /** Workspace ID */
  workspaceId: string;
  
  /** Last sync timestamp */
  lastSync: string | null;
  
  /** Current sync status */
  status: SyncStatus;
  
  /** Files tracked */
  files: SyncFileState[];
  
  /** Pending changes */
  pending: PendingChange[];
  
  /** Sync errors */
  errors: SyncError[];
}

/**
 * Sync status
 */
export type SyncStatus =
  | "idle"
  | "syncing"
  | "error"
  | "conflict";

/**
 * File sync state
 */
export interface SyncFileState {
  /** Relative file path */
  path: string;
  
  /** Local file hash */
  localHash: string | null;
  
  /** Remote file hash */
  remoteHash: string | null;
  
  /** Last modified locally */
  localModified: string | null;
  
  /** Last modified remotely */
  remoteModified: string | null;
  
  /** File sync status */
  status: FileSyncStatus;
}

/**
 * File sync status
 */
export type FileSyncStatus =
  | "synced"
  | "local-only"
  | "remote-only"
  | "modified-local"
  | "modified-remote"
  | "conflict";

/**
 * Pending change
 */
export interface PendingChange {
  /** Change ID */
  id: string;
  
  /** File path */
  path: string;
  
  /** Change type */
  type: "upload" | "download" | "delete";
  
  /** Created at */
  createdAt: string;
}

/**
 * Sync error
 */
export interface SyncError {
  /** Error ID */
  id: string;
  
  /** File path (if applicable) */
  path?: string;
  
  /** Error message */
  message: string;
  
  /** Error code */
  code: string;
  
  /** Occurred at */
  occurredAt: string;
  
  /** Retry count */
  retryCount: number;
}

// =============================================================================
// Sync Events
// =============================================================================

export type SyncEvent =
  | { type: "sync:started"; workspaceId: string }
  | { type: "sync:completed"; workspaceId: string; stats: SyncStats }
  | { type: "sync:error"; workspaceId: string; error: string }
  | { type: "sync:conflict"; workspaceId: string; path: string }
  | { type: "file:uploaded"; path: string }
  | { type: "file:downloaded"; path: string }
  | { type: "file:deleted"; path: string };

/**
 * Sync statistics
 */
export interface SyncStats {
  uploaded: number;
  downloaded: number;
  deleted: number;
  conflicts: number;
  errors: number;
  duration: number;
}

// =============================================================================
// Defaults
// =============================================================================

export const DEFAULT_SYNC_CONFIG: Omit<CloudSyncConfig, "projectId" | "bucketName"> = {
  prefix: "nella",
  encryption: true,
  autoSyncInterval: 0,
  conflictStrategy: "newest-wins",
  include: [
    "index/**",
    "context.json",
    "keys.json",
    "agents.json",
    "workspaces.json",
  ],
  exclude: [
    "*.tmp",
    "*.lock",
  ],
};
