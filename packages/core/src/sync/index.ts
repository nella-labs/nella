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
