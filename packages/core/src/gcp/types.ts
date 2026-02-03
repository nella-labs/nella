/**
 * GCP Module Type Definitions
 *
 * Types for:
 * - Cloud SQL (pgvector for embeddings)
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * GCP Cloud SQL configuration
 */
export interface CloudSQLConfig {
  /** Cloud SQL instance connection name (project:region:instance) */
  connectionName?: string;

  /** Direct connection host (for private IP or Cloud SQL Proxy) */
  host?: string;

  /** Database port (default: 5432) */
  port?: number;

  /** Database name */
  database: string;

  /** Database user */
  user: string;

  /** Database password */
  password: string;

  /** Use SSL (default: true for Cloud SQL) */
  ssl?: boolean;

  /** Connection pool size (default: 10) */
  poolSize?: number;

  /** Connection timeout in ms (default: 30000) */
  connectionTimeout?: number;

  /** Idle timeout in ms (default: 10000) */
  idleTimeout?: number;
}

/**
 * Combined GCP configuration
 */
export interface GCPConfig {
  cloudSQL?: CloudSQLConfig;
}

// ============================================================================
// Cloud SQL Data Types
// ============================================================================

/**
 * Workspace row in Cloud SQL
 */
export interface WorkspaceRow {
  id: string;
  user_id: string;
  name: string;
  root_path: string;
  config: WorkspaceConfig;
  stats: WorkspaceStats;
  created_at: Date;
  updated_at: Date;
  last_indexed_at: Date | null;
}

export interface WorkspaceConfig {
  include_patterns: string[];
  exclude_patterns: string[];
  max_file_size: number;
  index_options: {
    use_ast: boolean;
    use_stemming: boolean;
    use_hnsw: boolean;
    chunk_size: number;
    chunk_overlap: number;
  };
}

export interface WorkspaceStats {
  file_count: number;
  chunk_count: number;
  total_size_bytes: number;
  index_time_ms: number;
}

/**
 * File row in Cloud SQL
 */
export interface FileRow {
  id: string;
  workspace_id: string;
  relative_path: string;
  language: string;
  size_bytes: number;
  hash: string;
  content: string | null;
  metadata: FileMetadata;
  created_at: Date;
  updated_at: Date;
}

export interface FileMetadata {
  lines: number;
  functions?: number;
  classes?: number;
  imports?: string[];
  exports?: string[];
}

/**
 * Chunk row in Cloud SQL (with pgvector embedding)
 */
export interface ChunkRow {
  id: string;
  file_id: string;
  workspace_id: string;
  content: string;
  start_line: number;
  end_line: number;
  chunk_type: ChunkType;
  symbol_name: string | null;
  embedding: number[] | null;
  metadata: ChunkMetadata;
  created_at: Date;
}

export type ChunkType =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "const"
  | "import"
  | "export"
  | "comment"
  | "block"
  | "file";

export interface ChunkMetadata {
  token_count: number;
  parent_symbol?: string;
  scope?: string;
  tags?: string[];
}

/**
 * Search result from Cloud SQL
 */
export interface CloudSQLSearchResult {
  chunk_id: string;
  file_id: string;
  workspace_id: string;
  relative_path: string;
  content: string;
  start_line: number;
  end_line: number;
  chunk_type: ChunkType;
  symbol_name: string | null;
  similarity: number;
  language: string;
}

// ============================================================================
// Cloud SQL Query Types
// ============================================================================

export interface CreateWorkspaceRequest {
  user_id: string;
  name: string;
  root_path: string;
  config?: Partial<WorkspaceConfig>;
}

export interface UpsertFileRequest {
  workspace_id: string;
  relative_path: string;
  language: string;
  size_bytes: number;
  hash: string;
  content?: string;
  metadata?: FileMetadata;
}

export interface UpsertChunkRequest {
  file_id: string;
  workspace_id: string;
  content: string;
  start_line: number;
  end_line: number;
  chunk_type: ChunkType;
  symbol_name?: string;
  embedding?: number[];
  metadata?: ChunkMetadata;
}

export interface VectorSearchRequest {
  workspace_id: string;
  embedding: number[];
  limit?: number;
  threshold?: number;
  chunk_types?: ChunkType[];
  file_patterns?: string[];
}

export interface TextSearchRequest {
  workspace_id: string;
  query: string;
  limit?: number;
  chunk_types?: ChunkType[];
  file_patterns?: string[];
  use_stemming?: boolean;
}

// ============================================================================
// Event Types
// ============================================================================

export type GCPEvent =
  | { type: "cloudsql:connected" }
  | { type: "cloudsql:disconnected" }
  | { type: "cloudsql:error"; error: Error };

export type GCPEventHandler = (event: GCPEvent) => void;
