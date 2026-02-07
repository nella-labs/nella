/**
 * Sync Module Type Definitions
 *
 * Defines the sync adapter interface and types for
 * local, Supabase, and GCP sync backends.
 */

import type { ChunkType, ChunkMetadata } from "../gcp/types";

// ============================================================================
// Sync Tier Types
// ============================================================================

/**
 * Sync tier determines which backend to use
 */
export type SyncTier = "local" | "supabase" | "gcp";

/**
 * Conflict resolution strategy for cloud file sync.
 */
export type ConflictResolution =
  | "local-wins"
  | "remote-wins"
  | "manual"
  | "newest-wins";

/**
 * Cloud sync execution mode.
 */
export type CloudSyncMode = "sync" | "push" | "pull";

/**
 * Cloud file sync options.
 */
export interface CloudSyncOptions {
  /** Path prefix in remote storage */
  prefix?: string;

  /** Auto sync interval in seconds (0 to disable) */
  autoSyncInterval: number;

  /** Conflict resolution strategy */
  conflictResolution: ConflictResolution;

  /** Legacy alias for conflict resolution */
  conflictStrategy?: ConflictResolution;

  /** Encrypt file chunks before upload (AES-256-GCM) */
  encryption?: boolean;

  /** Encryption key */
  encryptionKey?: string;

  /** Compress file chunks before upload (gzip) */
  compression?: boolean;

  /** Gzip compression level (0-9) */
  compressionLevel?: number;

  /** Approximate bandwidth limit in KB/s */
  bandwidthLimitKBps?: number;

  /** Queue operations when transient connectivity errors occur */
  offlineQueueEnabled?: boolean;

  /** Maximum history entries retained */
  maxHistoryEntries?: number;

  /** Include glob patterns */
  include: string[];

  /** Exclude glob patterns */
  exclude: string[];

  /** Fixed delta chunk size in KB */
  deltaChunkSizeKB?: number;

  /** Max bytes eligible for text diff rendering */
  textDiffMaxBytes?: number;

  /** Single-object threshold for file transfer optimization */
  smallFileThresholdBytes?: number;
}

export const DEFAULT_CLOUD_SYNC_OPTIONS: CloudSyncOptions = {
  prefix: "",
  autoSyncInterval: 0,
  conflictResolution: "manual",
  conflictStrategy: "manual",
  compression: false,
  compressionLevel: 6,
  bandwidthLimitKBps: undefined,
  offlineQueueEnabled: true,
  maxHistoryEntries: 100,
  include: ["**/*"],
  exclude: [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/.nella/**",
    "**/.sync-state.json",
  ],
  deltaChunkSizeKB: 256,
  textDiffMaxBytes: 262144,
  smallFileThresholdBytes: 65536,
};

export type CloudSyncRunStatus = "idle" | "syncing" | "conflict" | "error";

export type CloudSyncFileStatus =
  | "synced"
  | "pending-upload"
  | "pending-download"
  | "conflict"
  | "error"
  | "local-only"
  | "remote-only";

export interface CloudSyncFileState {
  /** Relative file path */
  path: string;

  /** Current sync status */
  status: CloudSyncFileStatus;

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

export interface CloudSyncPendingChange {
  /** Queue item ID */
  id: string;

  /** Relative file path */
  path: string;

  /** Operation to retry */
  operation: "upload" | "download" | "delete";

  /** Initial queue timestamp */
  timestamp: string;

  /** Retry attempts */
  attempts: number;

  /** Last error (if any) */
  lastError?: string;

  /** Next retry time */
  nextRetryAt?: string;
}

export interface CloudSyncConflict {
  /** Conflict ID */
  id: string;

  /** Relative path */
  path: string;

  /** Hashes detected at conflict time */
  localHash?: string;
  remoteHash?: string;

  /** Modification timestamps */
  localModified?: string;
  remoteModified?: string;

  /** Optional previews and unified diff payload */
  localPreview?: string;
  remotePreview?: string;
  unifiedDiff?: string;

  /** Creation timestamp */
  createdAt: string;

  /** Resolution metadata */
  resolvedAt?: string;
  resolution?: "local-wins" | "remote-wins";
}

export interface CloudSyncStats {
  /** Files uploaded */
  uploaded: number;

  /** Files downloaded */
  downloaded: number;

  /** Files deleted */
  deleted: number;

  /** Queued actions due to transient failures */
  queued: number;

  /** Conflicts detected */
  conflicts: number;

  /** Errors encountered */
  errors: number;

  /** Approximate transferred bytes */
  bytesUploaded: number;
  bytesDownloaded: number;

  /** Duration in milliseconds */
  duration: number;
}

export interface CloudSyncHistoryEntry {
  /** History entry ID */
  id: string;

  /** Sync mode */
  mode: CloudSyncMode;

  /** Sync started timestamp */
  startedAt: string;

  /** Sync completed timestamp */
  completedAt: string;

  /** Completion status */
  status: "success" | "conflict" | "error";

  /** Sync statistics */
  stats: CloudSyncStats;

  /** Optional error summary */
  error?: string;
}

export interface CloudSyncState {
  /** Workspace ID */
  workspaceId: string;

  /** Workspace path */
  workspacePath: string;

  /** Current cloud sync status */
  status: CloudSyncRunStatus;

  /** Last successful sync timestamp */
  lastSync: string | null;

  /** File states by path */
  files: CloudSyncFileState[];

  /** Pending queued operations */
  pending: CloudSyncPendingChange[];

  /** Unresolved and resolved conflicts */
  conflicts: CloudSyncConflict[];

  /** Recent sync runs */
  history: CloudSyncHistoryEntry[];

  /** Recent errors */
  errors: Array<{ path: string; message: string; timestamp: string }>;
}

/**
 * Sync configuration
 */
export interface SyncConfig {
  tier: SyncTier;

  /** Local storage path (for tier: local) */
  localPath?: string;

  /** Supabase URL (for tier: supabase) */
  supabaseUrl?: string;

  /** Supabase anon key (for tier: supabase) */
  supabaseAnonKey?: string;

  /** GCP Cloud SQL config (for tier: gcp) */
  cloudSQLConfig?: {
    connectionName?: string;
    host?: string;
    port?: number;
    database: string;
    user: string;
    password: string;
  };

  /** GCP Cloud Storage config (for tier: gcp) */
  cloudStorageConfig?: {
    bucket: string;
    projectId?: string;
    keyFilename?: string;
    credentials?: Record<string, unknown>;
    basePath?: string;
  };

  /** Cloud file sync settings */
  cloudSync?: Partial<CloudSyncOptions>;
}

// ============================================================================
// Data Types (Backend-agnostic)
// ============================================================================

/**
 * Workspace (backend-agnostic)
 */
export interface Workspace {
  id: string;
  userId: string;
  name: string;
  rootPath: string;
  config: WorkspaceConfig;
  stats: WorkspaceStats;
  createdAt: Date;
  updatedAt: Date;
  lastIndexedAt: Date | null;
}

export interface WorkspaceConfig {
  includePatterns: string[];
  excludePatterns: string[];
  maxFileSize: number;
  indexOptions: {
    useAst: boolean;
    useStemming: boolean;
    useHnsw: boolean;
    chunkSize: number;
    chunkOverlap: number;
  };
}

export interface WorkspaceStats {
  fileCount: number;
  chunkCount: number;
  totalSizeBytes: number;
  indexTimeMs: number;
}

/**
 * File (backend-agnostic)
 */
export interface IndexedFile {
  id: string;
  workspaceId: string;
  relativePath: string;
  language: string;
  sizeBytes: number;
  hash: string;
  content?: string;
  metadata: FileMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface FileMetadata {
  lines: number;
  functions?: number;
  classes?: number;
  imports?: string[];
  exports?: string[];
}

/**
 * Chunk (backend-agnostic)
 */
export interface Chunk {
  id: string;
  fileId: string;
  workspaceId: string;
  content: string;
  startLine: number;
  endLine: number;
  chunkType: ChunkType;
  symbolName?: string;
  embedding?: number[];
  metadata: ChunkMetadata;
  createdAt: Date;
}

/**
 * Search result (backend-agnostic)
 */
export interface SearchResult {
  chunkId: string;
  fileId: string;
  workspaceId: string;
  relativePath: string;
  content: string;
  startLine: number;
  endLine: number;
  chunkType: ChunkType;
  symbolName?: string;
  similarity: number;
  language: string;
}

// ============================================================================
// Sync Adapter Interface
// ============================================================================

/**
 * Sync adapter interface - implemented by each backend
 */
export interface SyncAdapter {
  /** Adapter tier */
  readonly tier: SyncTier;

  /** Initialize the adapter */
  init(config: SyncConfig): Promise<void>;

  /** Check if adapter is ready */
  isReady(): boolean;

  /** Disconnect/cleanup */
  disconnect(): Promise<void>;

  // -------------------------------------------------------------------------
  // Workspace Operations
  // -------------------------------------------------------------------------

  createWorkspace(params: CreateWorkspaceParams): Promise<Workspace>;
  getWorkspace(id: string): Promise<Workspace | null>;
  getWorkspacesByUser(userId: string): Promise<Workspace[]>;
  updateWorkspace(id: string, updates: Partial<Workspace>): Promise<Workspace>;
  deleteWorkspace(id: string): Promise<void>;

  // -------------------------------------------------------------------------
  // File Operations
  // -------------------------------------------------------------------------

  upsertFile(params: UpsertFileParams): Promise<IndexedFile>;
  upsertFilesBatch(params: UpsertFileParams[]): Promise<number>;
  getFile(id: string): Promise<IndexedFile | null>;
  getFileByPath(workspaceId: string, relativePath: string): Promise<IndexedFile | null>;
  getWorkspaceFiles(workspaceId: string): Promise<IndexedFile[]>;
  deleteFile(id: string): Promise<void>;
  deleteStaleFiles(workspaceId: string, validHashes: string[]): Promise<number>;

  // -------------------------------------------------------------------------
  // Chunk Operations
  // -------------------------------------------------------------------------

  upsertChunk(params: UpsertChunkParams): Promise<Chunk>;
  upsertChunksBatch(params: UpsertChunkParams[]): Promise<number>;
  getChunk(id: string): Promise<Chunk | null>;
  getFileChunks(fileId: string): Promise<Chunk[]>;
  deleteChunksByFile(fileId: string): Promise<void>;
  deleteChunksByWorkspace(workspaceId: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Search Operations
  // -------------------------------------------------------------------------

  vectorSearch(params: VectorSearchParams): Promise<SearchResult[]>;
  textSearch(params: TextSearchParams): Promise<SearchResult[]>;
  hybridSearch(params: HybridSearchParams): Promise<SearchResult[]>;

  // -------------------------------------------------------------------------
  // Sync Operations (for realtime sync between devices)
  // -------------------------------------------------------------------------

  /** Subscribe to workspace changes (Supabase realtime) */
  subscribeToWorkspace?(
    workspaceId: string,
    handler: (event: SyncEvent) => void
  ): () => void;

  /** Push local changes to remote */
  pushChanges?(changes: SyncChange[]): Promise<void>;

  /** Pull remote changes */
  pullChanges?(workspaceId: string, since: Date): Promise<SyncChange[]>;
}

// ============================================================================
// Operation Parameter Types
// ============================================================================

export interface CreateWorkspaceParams {
  userId: string;
  name: string;
  rootPath: string;
  config?: Partial<WorkspaceConfig>;
}

export interface UpsertFileParams {
  workspaceId: string;
  relativePath: string;
  language: string;
  sizeBytes: number;
  hash: string;
  content?: string;
  metadata?: FileMetadata;
}

export interface UpsertChunkParams {
  fileId: string;
  workspaceId: string;
  content: string;
  startLine: number;
  endLine: number;
  chunkType: ChunkType;
  symbolName?: string;
  embedding?: number[];
  metadata?: ChunkMetadata;
}

export interface VectorSearchParams {
  workspaceId: string;
  embedding: number[];
  limit?: number;
  threshold?: number;
  chunkTypes?: ChunkType[];
  filePatterns?: string[];
}

export interface TextSearchParams {
  workspaceId: string;
  query: string;
  limit?: number;
  chunkTypes?: ChunkType[];
  filePatterns?: string[];
  useStemming?: boolean;
}

export interface HybridSearchParams {
  workspaceId: string;
  query: string;
  embedding: number[];
  limit?: number;
  vectorWeight?: number;
  textWeight?: number;
  threshold?: number;
  chunkTypes?: ChunkType[];
}

// ============================================================================
// Sync Event Types
// ============================================================================

export type SyncEvent =
  | { type: "file:created"; file: IndexedFile }
  | { type: "file:updated"; file: IndexedFile }
  | { type: "file:deleted"; fileId: string }
  | { type: "chunk:created"; chunk: Chunk }
  | { type: "chunk:updated"; chunk: Chunk }
  | { type: "chunk:deleted"; chunkId: string }
  | { type: "workspace:updated"; workspace: Workspace };

export interface SyncChange {
  type: "upsert" | "delete";
  table: "files" | "chunks" | "workspaces";
  id: string;
  data?: unknown;
  timestamp: Date;
}

// ============================================================================
// Sync Manager Types
// ============================================================================

export interface SyncStatus {
  tier: SyncTier;
  isConnected: boolean;
  lastSyncAt: Date | null;
  pendingChanges: number;
  error?: string;
}

export type SyncManagerEvent =
  | { type: "connected"; tier: SyncTier }
  | { type: "disconnected"; tier: SyncTier }
  | { type: "sync:start" }
  | { type: "sync:complete"; changesCount: number }
  | { type: "sync:error"; error: Error }
  | { type: "change:local"; change: SyncChange }
  | { type: "change:remote"; change: SyncChange }
  | { type: "cloud-sync:started"; workspaceId: string; mode: CloudSyncMode }
  | { type: "cloud-sync:completed"; workspaceId: string; mode: CloudSyncMode; stats: CloudSyncStats }
  | { type: "cloud-sync:error"; workspaceId: string; mode: CloudSyncMode; error: string }
  | { type: "cloud-sync:queued"; workspaceId: string; pending: number }
  | { type: "cloud-sync:history"; workspaceId: string; entry: CloudSyncHistoryEntry }
  | { type: "cloud-sync:conflict"; workspaceId: string; conflict: CloudSyncConflict };

export type SyncManagerEventHandler = (event: SyncManagerEvent) => void;

