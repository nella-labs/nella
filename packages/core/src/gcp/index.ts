/**
 * GCP Module
 *
 * Provides GCP integration for nella:
 * - Cloud SQL (pgvector for embeddings at scale)
 */

// Types
export type {
  // Config
  CloudSQLConfig,
  GCPConfig,
  // Cloud SQL Data
  WorkspaceRow,
  WorkspaceConfig,
  WorkspaceStats,
  FileRow,
  FileMetadata,
  ChunkRow,
  ChunkType,
  ChunkMetadata,
  CloudSQLSearchResult,
  // Cloud SQL Requests
  CreateWorkspaceRequest,
  UpsertFileRequest,
  UpsertChunkRequest,
  VectorSearchRequest,
  TextSearchRequest,
  // Events
  GCPEvent,
  GCPEventHandler,
} from "./types";

// Cloud SQL
export {
  // Manager
  cloudSQLManager,
  // Init
  initCloudSQL,
  isCloudSQLInitialized,
  disconnectCloudSQL,
  onCloudSQLEvent,
  // Workspace ops
  createWorkspace,
  getWorkspace,
  getWorkspacesByUser,
  updateWorkspaceStats,
  deleteWorkspace,
  // File ops
  upsertFile,
  getFile,
  getFileByPath,
  getWorkspaceFiles,
  deleteFile,
  deleteFilesByHash,
  // Chunk ops
  upsertChunk,
  upsertChunksBatch,
  deleteChunksByFile,
  deleteChunksByWorkspace,
  // Search
  vectorSearch,
  textSearch,
  hybridSearch,
} from "./cloudsql";
