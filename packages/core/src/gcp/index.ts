/**
 * GCP Module
 *
 * Provides GCP integration for nella:
 * - Cloud SQL (pgvector for embeddings at scale)
 * - Cloud Storage (ONNX models, backups)
 */

// Types
export type {
  // Config
  CloudSQLConfig,
  CloudStorageConfig,
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
  // Cloud Storage
  StorageObjectMeta,
  UploadOptions,
  DownloadOptions,
  ListOptions,
  ListResult,
  ModelInfo,
  BackupInfo,
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
  // Benchmark
  uploadBenchmarkResults,
  getLatestBenchmarkResult,
  getBenchmarkVersions,
  getBenchmarkHistory,
} from "./cloudsql";

export type { BenchmarkResultRow } from "./cloudsql";

// Cloud Storage
export {
  // Manager
  cloudStorageManager,
  // Init
  initCloudStorage,
  isCloudStorageInitialized,
  disconnectCloudStorage,
  onCloudStorageEvent,
  // Core ops
  uploadFile,
  downloadFile,
  downloadStream,
  fileExists,
  getFileMetadata,
  deleteFile as deleteStorageFile,
  copyFile,
  moveFile,
  listFiles,
  // Model ops
  uploadModel,
  downloadModel,
  listModels,
  deleteModel,
  // Backup ops
  createBackup,
  downloadBackup,
  listBackups,
  deleteBackup,
  cleanupBackups,
} from "./storage";
