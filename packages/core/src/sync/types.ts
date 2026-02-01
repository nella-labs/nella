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
  };
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
  | { type: "change:remote"; change: SyncChange };

export type SyncManagerEventHandler = (event: SyncManagerEvent) => void;
