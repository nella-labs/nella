/**
 * Sync Module
 *
 * Provides unified sync across different backends:
 * - Local (JSON files, no cloud)
 * - Supabase (auth, API keys, context sync)
 * - GCP (Cloud SQL with pgvector for embeddings)
 */

// Types
export type {
  SyncTier,
  SyncConfig,
  ConflictResolution,
  CloudSyncMode,
  CloudSyncOptions,
  CloudSyncRunStatus,
  CloudSyncFileStatus,
  CloudSyncFileState,
  CloudSyncPendingChange,
  CloudSyncConflict,
  CloudSyncStats,
  CloudSyncHistoryEntry,
  CloudSyncState,
  Workspace,
  WorkspaceConfig,
  WorkspaceStats,
  IndexedFile,
  FileMetadata,
  Chunk,
  SearchResult,
  SyncAdapter,
  CreateWorkspaceParams,
  UpsertFileParams,
  UpsertChunkParams,
  VectorSearchParams,
  TextSearchParams,
  HybridSearchParams,
  SyncEvent,
  SyncChange,
  SyncStatus,
  SyncManagerEvent,
  SyncManagerEventHandler,
} from "./types";

export { DEFAULT_CLOUD_SYNC_OPTIONS } from "./types";

// Adapters
export {
  LocalSyncAdapter,
  createLocalAdapter,
  SupabaseSyncAdapter,
  createSupabaseAdapter,
  GCPSyncAdapter,
  createGCPAdapter,
} from "./adapters";

// Manager
export {
  SyncManager,
  syncManager,
  initSync,
  getSyncStatus,
  disconnectSync,
} from "./manager";

// Cloud Sync Engine
export {
  WorkspaceCloudSyncManager,
  createWorkspaceCloudSyncManager,
  CloudSyncStateStore,
  computeLocalManifest,
  rebuildFromChunks,
  splitBuffer,
  sha256,
  encodePathForObject,
  collectWorkspaceFiles,
  shouldSyncPath,
  loadIgnorePatterns,
  toPosixPath,
  BandwidthThrottle,
  buildConflict,
} from "./cloud";

export type {
  CloudObjectStorage,
  FileManifest,
  DeltaChunk,
  LocalManifestWithChunks,
} from "./cloud";
