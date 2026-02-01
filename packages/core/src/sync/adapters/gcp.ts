/**
 * GCP Sync Adapter
 *
 * Uses GCP Cloud SQL with pgvector for:
 * - Workspaces, files, chunks at scale
 * - Vector search (embeddings)
 * - Full-text search
 * - Hybrid search
 */

import type {
  SyncAdapter,
  SyncConfig,
  Workspace,
  IndexedFile,
  Chunk,
  SearchResult,
  CreateWorkspaceParams,
  UpsertFileParams,
  UpsertChunkParams,
  VectorSearchParams,
  TextSearchParams,
  HybridSearchParams,
} from "../types";
import {
  initCloudSQL,
  isCloudSQLInitialized,
  disconnectCloudSQL,
  createWorkspace as createGCPWorkspace,
  getWorkspace as getGCPWorkspace,
  getWorkspacesByUser as getGCPWorkspacesByUser,
  deleteWorkspace as deleteGCPWorkspace,
  updateWorkspaceStats,
  upsertFile as upsertGCPFile,
  getFile as getGCPFile,
  getFileByPath as getGCPFileByPath,
  getWorkspaceFiles as getGCPWorkspaceFiles,
  deleteFile as deleteGCPFile,
  deleteFilesByHash,
  upsertChunk as upsertGCPChunk,
  upsertChunksBatch as upsertGCPChunksBatch,
  deleteChunksByFile as deleteGCPChunksByFile,
  deleteChunksByWorkspace as deleteGCPChunksByWorkspace,
  vectorSearch as gcpVectorSearch,
  textSearch as gcpTextSearch,
  hybridSearch as gcpHybridSearch,
  cloudSQLManager,
} from "../../gcp/cloudsql";
import type { CloudSQLConfig } from "../../gcp/types";

// ============================================================================
// GCP Sync Adapter
// ============================================================================

export class GCPSyncAdapter implements SyncAdapter {
  readonly tier = "gcp" as const;
  
  private ready = false;
  
  async init(config: SyncConfig): Promise<void> {
    if (!config.cloudSQLConfig) {
      throw new Error("cloudSQLConfig is required for GCPSyncAdapter");
    }
    
    await initCloudSQL(config.cloudSQLConfig as CloudSQLConfig);
    this.ready = true;
  }
  
  isReady(): boolean {
    return this.ready && isCloudSQLInitialized();
  }
  
  async disconnect(): Promise<void> {
    await disconnectCloudSQL();
    this.ready = false;
  }
  
  // ---------------------------------------------------------------------------
  // Workspace Operations
  // ---------------------------------------------------------------------------
  
  async createWorkspace(params: CreateWorkspaceParams): Promise<Workspace> {
    const row = await createGCPWorkspace({
      user_id: params.userId,
      name: params.name,
      root_path: params.rootPath,
      config: params.config
        ? {
            include_patterns: params.config.includePatterns || ["**/*"],
            exclude_patterns: params.config.excludePatterns || [],
            max_file_size: params.config.maxFileSize || 1024 * 1024,
            index_options: {
              use_ast: params.config.indexOptions?.useAst ?? true,
              use_stemming: params.config.indexOptions?.useStemming ?? true,
              use_hnsw: params.config.indexOptions?.useHnsw ?? true,
              chunk_size: params.config.indexOptions?.chunkSize || 512,
              chunk_overlap: params.config.indexOptions?.chunkOverlap || 64,
            },
          }
        : undefined,
    });
    
    return toWorkspace(row);
  }
  
  async getWorkspace(id: string): Promise<Workspace | null> {
    const row = await getGCPWorkspace(id);
    return row ? toWorkspace(row) : null;
  }
  
  async getWorkspacesByUser(userId: string): Promise<Workspace[]> {
    const rows = await getGCPWorkspacesByUser(userId);
    return rows.map(toWorkspace);
  }
  
  async updateWorkspace(
    id: string,
    updates: Partial<Workspace>
  ): Promise<Workspace> {
    // GCP module doesn't have a generic update, use stats update
    if (updates.stats) {
      await updateWorkspaceStats(id, {
        file_count: updates.stats.fileCount,
        chunk_count: updates.stats.chunkCount,
        total_size_bytes: updates.stats.totalSizeBytes,
        index_time_ms: updates.stats.indexTimeMs,
      });
    }
    
    const workspace = await this.getWorkspace(id);
    if (!workspace) {
      throw new Error(`Workspace ${id} not found`);
    }
    
    return workspace;
  }
  
  async deleteWorkspace(id: string): Promise<void> {
    await deleteGCPWorkspace(id);
  }
  
  // ---------------------------------------------------------------------------
  // File Operations
  // ---------------------------------------------------------------------------
  
  async upsertFile(params: UpsertFileParams): Promise<IndexedFile> {
    const row = await upsertGCPFile({
      workspace_id: params.workspaceId,
      relative_path: params.relativePath,
      language: params.language,
      size_bytes: params.sizeBytes,
      hash: params.hash,
      content: params.content,
      metadata: params.metadata
        ? {
            lines: params.metadata.lines,
            functions: params.metadata.functions,
            classes: params.metadata.classes,
            imports: params.metadata.imports,
            exports: params.metadata.exports,
          }
        : undefined,
    });
    
    return toFile(row);
  }
  
  async upsertFilesBatch(params: UpsertFileParams[]): Promise<number> {
    // Process in sequence (GCP module handles batching internally)
    for (const p of params) {
      await this.upsertFile(p);
    }
    return params.length;
  }
  
  async getFile(id: string): Promise<IndexedFile | null> {
    const row = await getGCPFile(id);
    return row ? toFile(row) : null;
  }
  
  async getFileByPath(
    workspaceId: string,
    relativePath: string
  ): Promise<IndexedFile | null> {
    const row = await getGCPFileByPath(workspaceId, relativePath);
    return row ? toFile(row) : null;
  }
  
  async getWorkspaceFiles(workspaceId: string): Promise<IndexedFile[]> {
    const rows = await getGCPWorkspaceFiles(workspaceId);
    return rows.map(toFile);
  }
  
  async deleteFile(id: string): Promise<void> {
    await deleteGCPFile(id);
  }
  
  async deleteStaleFiles(
    workspaceId: string,
    validHashes: string[]
  ): Promise<number> {
    return await deleteFilesByHash(workspaceId, validHashes);
  }
  
  // ---------------------------------------------------------------------------
  // Chunk Operations
  // ---------------------------------------------------------------------------
  
  async upsertChunk(params: UpsertChunkParams): Promise<Chunk> {
    const row = await upsertGCPChunk({
      file_id: params.fileId,
      workspace_id: params.workspaceId,
      content: params.content,
      start_line: params.startLine,
      end_line: params.endLine,
      chunk_type: params.chunkType,
      symbol_name: params.symbolName,
      embedding: params.embedding,
      metadata: params.metadata,
    });
    
    return toChunk(row);
  }
  
  async upsertChunksBatch(params: UpsertChunkParams[]): Promise<number> {
    return await upsertGCPChunksBatch(
      params.map((p) => ({
        file_id: p.fileId,
        workspace_id: p.workspaceId,
        content: p.content,
        start_line: p.startLine,
        end_line: p.endLine,
        chunk_type: p.chunkType,
        symbol_name: p.symbolName,
        embedding: p.embedding,
        metadata: p.metadata,
      }))
    );
  }
  
  async getChunk(id: string): Promise<Chunk | null> {
    // GCP module doesn't have getChunk, use query directly
    const result = await cloudSQLManager.query<import("../../gcp/types").ChunkRow>(
      `SELECT * FROM chunks WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? toChunk(result.rows[0]) : null;
  }
  
  async getFileChunks(fileId: string): Promise<Chunk[]> {
    const result = await cloudSQLManager.query<import("../../gcp/types").ChunkRow>(
      `SELECT * FROM chunks WHERE file_id = $1 ORDER BY start_line`,
      [fileId]
    );
    return result.rows.map(toChunk);
  }
  
  async deleteChunksByFile(fileId: string): Promise<void> {
    await deleteGCPChunksByFile(fileId);
  }
  
  async deleteChunksByWorkspace(workspaceId: string): Promise<void> {
    await deleteGCPChunksByWorkspace(workspaceId);
  }
  
  // ---------------------------------------------------------------------------
  // Search Operations
  // ---------------------------------------------------------------------------
  
  async vectorSearch(params: VectorSearchParams): Promise<SearchResult[]> {
    const results = await gcpVectorSearch({
      workspace_id: params.workspaceId,
      embedding: params.embedding,
      limit: params.limit,
      threshold: params.threshold,
      chunk_types: params.chunkTypes,
      file_patterns: params.filePatterns,
    });
    
    return results.map(toSearchResult);
  }
  
  async textSearch(params: TextSearchParams): Promise<SearchResult[]> {
    const results = await gcpTextSearch({
      workspace_id: params.workspaceId,
      query: params.query,
      limit: params.limit,
      chunk_types: params.chunkTypes,
      file_patterns: params.filePatterns,
      use_stemming: params.useStemming,
    });
    
    return results.map(toSearchResult);
  }
  
  async hybridSearch(params: HybridSearchParams): Promise<SearchResult[]> {
    const results = await gcpHybridSearch(
      params.workspaceId,
      params.query,
      params.embedding,
      {
        limit: params.limit,
        vectorWeight: params.vectorWeight,
        textWeight: params.textWeight,
        threshold: params.threshold,
        chunkTypes: params.chunkTypes,
      }
    );
    
    return results.map(toSearchResult);
  }
}

// ============================================================================
// Type Converters
// ============================================================================

function toWorkspace(row: import("../../gcp/types").WorkspaceRow): Workspace {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    rootPath: row.root_path,
    config: {
      includePatterns: row.config.include_patterns,
      excludePatterns: row.config.exclude_patterns,
      maxFileSize: row.config.max_file_size,
      indexOptions: {
        useAst: row.config.index_options.use_ast,
        useStemming: row.config.index_options.use_stemming,
        useHnsw: row.config.index_options.use_hnsw,
        chunkSize: row.config.index_options.chunk_size,
        chunkOverlap: row.config.index_options.chunk_overlap,
      },
    },
    stats: {
      fileCount: row.stats.file_count,
      chunkCount: row.stats.chunk_count,
      totalSizeBytes: row.stats.total_size_bytes,
      indexTimeMs: row.stats.index_time_ms,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastIndexedAt: row.last_indexed_at,
  };
}

function toFile(row: import("../../gcp/types").FileRow): IndexedFile {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    relativePath: row.relative_path,
    language: row.language,
    sizeBytes: row.size_bytes,
    hash: row.hash,
    content: row.content || undefined,
    metadata: {
      lines: row.metadata.lines,
      functions: row.metadata.functions,
      classes: row.metadata.classes,
      imports: row.metadata.imports,
      exports: row.metadata.exports,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toChunk(row: import("../../gcp/types").ChunkRow): Chunk {
  return {
    id: row.id,
    fileId: row.file_id,
    workspaceId: row.workspace_id,
    content: row.content,
    startLine: row.start_line,
    endLine: row.end_line,
    chunkType: row.chunk_type,
    symbolName: row.symbol_name || undefined,
    embedding: row.embedding || undefined,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

function toSearchResult(
  row: import("../../gcp/types").CloudSQLSearchResult
): SearchResult {
  return {
    chunkId: row.chunk_id,
    fileId: row.file_id,
    workspaceId: row.workspace_id,
    relativePath: row.relative_path,
    content: row.content,
    startLine: row.start_line,
    endLine: row.end_line,
    chunkType: row.chunk_type,
    symbolName: row.symbol_name || undefined,
    similarity: row.similarity,
    language: row.language,
  };
}

// ============================================================================
// Export
// ============================================================================

export function createGCPAdapter(): SyncAdapter {
  return new GCPSyncAdapter();
}
