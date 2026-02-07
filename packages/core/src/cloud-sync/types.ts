/**
 * Cloud Sync Compatibility Types
 *
 * @deprecated Use types from `sync/types.ts` instead.
 */

import type {
  ConflictResolution as SyncConflictResolution,
  CloudSyncOptions,
  CloudSyncRunStatus,
  CloudSyncFileStatus,
  CloudSyncFileState,
  CloudSyncPendingChange,
  CloudSyncHistoryEntry,
  CloudSyncState,
  CloudSyncStats,
} from "../sync/types";
import { DEFAULT_CLOUD_SYNC_OPTIONS } from "../sync/types";

export type ConflictResolution = SyncConflictResolution;

export interface GCSProviderConfig {
  /** GCS bucket name */
  bucketName: string;
  /** Optional GCP project ID */
  projectId?: string;
  /** Optional service account key file path */
  keyFilename?: string;
  /** Optional inline service account credentials */
  credentials?: Record<string, unknown>;
  /** Optional bucket base path prefix */
  basePath?: string;
}

/**
 * Legacy cloud sync configuration shape.
 */
export interface CloudSyncConfig extends Omit<CloudSyncOptions, "prefix"> {
  /** GCS provider configuration */
  gcs?: GCSProviderConfig;
  /** Legacy top-level project ID */
  projectId?: string;
  /** Legacy top-level bucket name */
  bucketName?: string;
  /** Legacy top-level key filename */
  keyFilename?: string;
  /** Path prefix in remote storage */
  prefix?: string;
}

export const DEFAULT_SYNC_CONFIG: Omit<CloudSyncConfig, "gcs"> = {
  ...DEFAULT_CLOUD_SYNC_OPTIONS,
};

export type SyncStatus = CloudSyncRunStatus;
export type FileSyncStatus = CloudSyncFileStatus;
export type SyncFileState = CloudSyncFileState;
export type PendingChange = CloudSyncPendingChange;
export type SyncHistoryEntry = CloudSyncHistoryEntry;
export type SyncState = CloudSyncState;
export type SyncStats = CloudSyncStats;

export type SyncEvent =
  | { type: "sync:started"; workspaceId: string }
  | { type: "sync:completed"; workspaceId: string; stats: SyncStats }
  | { type: "sync:error"; workspaceId: string; error: string }
  | { type: "sync:queued"; workspaceId: string; pending: number }
  | { type: "sync:history"; workspaceId: string; entry: SyncHistoryEntry }
  | { type: "sync:conflict"; workspaceId: string; path: string }
  | { type: "file:uploaded"; path: string }
  | { type: "file:downloaded"; path: string }
  | { type: "file:deleted"; path: string };

export interface SyncError {
  /** File path */
  path: string;
  /** Error message */
  message: string;
  /** Timestamp */
  timestamp: string;
}
