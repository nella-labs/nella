/**
 * GCP Cloud SQL Module
 *
 * PostgreSQL with pgvector for embeddings at scale.
 * Uses Cloud SQL for production workloads.
 */

import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import type {
  CloudSQLConfig,
  WorkspaceRow,
  FileRow,
  ChunkRow,
  CloudSQLSearchResult,
  CreateWorkspaceRequest,
  UpsertFileRequest,
  UpsertChunkRequest,
  VectorSearchRequest,
  TextSearchRequest,
  GCPEvent,
  GCPEventHandler,
} from "./types";

// ============================================================================
// Cloud SQL Manager
// ============================================================================

class CloudSQLManager {
  private pool: Pool | null = null;
  private config: CloudSQLConfig | null = null;
  private handlers: Set<GCPEventHandler> = new Set();

  /**
   * Initialize Cloud SQL connection pool
   */
  async init(config: CloudSQLConfig): Promise<void> {
    if (this.pool) {
      await this.disconnect();
    }

    // Dynamic import pg to avoid bundling issues
    const { Pool } = await import("pg");

    this.config = config;
    this.pool = new Pool({
      host: config.host || `/cloudsql/${config.connectionName}`,
      port: config.port || 5432,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl !== false ? { rejectUnauthorized: false } : undefined,
      max: config.poolSize || 10,
      connectionTimeoutMillis: config.connectionTimeout || 30000,
      idleTimeoutMillis: config.idleTimeout || 10000,
    });

    // Test connection
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1");

      // Ensure pgvector extension is enabled
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");

      this.emit({ type: "cloudsql:connected" });
    } finally {
      client.release();
    }
  }

  /**
   * Get connection pool
   */
  getPool(): Pool {
    if (!this.pool) {
      throw new Error(
        "CloudSQL not initialized. Call init() first with configuration."
      );
    }
    return this.pool;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.pool !== null;
  }

  /**
   * Disconnect from Cloud SQL
   */
  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.config = null;
      this.emit({ type: "cloudsql:disconnected" });
    }
  }

  /**
   * Subscribe to events
   */
  onEvent(handler: GCPEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(event: GCPEvent): void {
    this.handlers.forEach((h) => h(event));
  }

  /**
   * Execute query with automatic client management
   */
  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    const pool = this.getPool();
    try {
      return await pool.query<T>(sql, params);
    } catch (error) {
      this.emit({ type: "cloudsql:error", error: error as Error });
      throw error;
    }
  }

  /**
   * Execute transaction
   */
  async transaction<T>(
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      this.emit({ type: "cloudsql:error", error: error as Error });
      throw error;
    } finally {
      client.release();
    }
  }
}

// Singleton instance
export const cloudSQLManager = new CloudSQLManager();

// ============================================================================
// Initialization Functions
// ============================================================================

export async function initCloudSQL(config: CloudSQLConfig): Promise<void> {
  await cloudSQLManager.init(config);
}

export function isCloudSQLInitialized(): boolean {
  return cloudSQLManager.isInitialized();
}

export async function disconnectCloudSQL(): Promise<void> {
  await cloudSQLManager.disconnect();
}

export function onCloudSQLEvent(handler: GCPEventHandler): () => void {
  return cloudSQLManager.onEvent(handler);
}

// ============================================================================
// Workspace Operations
// ============================================================================

export async function createWorkspace(
  request: CreateWorkspaceRequest
): Promise<WorkspaceRow> {
  const { user_id, name, root_path, config } = request;

  const defaultConfig = {
    include_patterns: ["**/*"],
    exclude_patterns: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
    max_file_size: 1024 * 1024, // 1MB
    index_options: {
      use_ast: true,
      use_stemming: true,
      use_hnsw: true,
      chunk_size: 512,
      chunk_overlap: 64,
    },
  };

  const mergedConfig = { ...defaultConfig, ...config };
  const id = crypto.randomUUID();

  const result = await cloudSQLManager.query<WorkspaceRow>(
    `INSERT INTO workspaces (id, user_id, name, root_path, config, stats)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      id,
      user_id,
      name,
      root_path,
      JSON.stringify(mergedConfig),
      JSON.stringify({ file_count: 0, chunk_count: 0, total_size_bytes: 0, index_time_ms: 0 }),
    ]
  );

  return result.rows[0];
}

export async function getWorkspace(
  workspaceId: string
): Promise<WorkspaceRow | null> {
  const result = await cloudSQLManager.query<WorkspaceRow>(
    `SELECT * FROM workspaces WHERE id = $1`,
    [workspaceId]
  );
  return result.rows[0] || null;
}

export async function getWorkspacesByUser(
  userId: string
): Promise<WorkspaceRow[]> {
  const result = await cloudSQLManager.query<WorkspaceRow>(
    `SELECT * FROM workspaces WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function updateWorkspaceStats(
  workspaceId: string,
  stats: Partial<WorkspaceRow["stats"]>
): Promise<void> {
  await cloudSQLManager.query(
    `UPDATE workspaces
     SET stats = stats || $2::jsonb,
         updated_at = NOW(),
         last_indexed_at = NOW()
     WHERE id = $1`,
    [workspaceId, JSON.stringify(stats)]
  );
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await cloudSQLManager.transaction(async (client) => {
    // Delete chunks first (foreign key)
    await client.query(`DELETE FROM chunks WHERE workspace_id = $1`, [
      workspaceId,
    ]);
    // Delete files
    await client.query(`DELETE FROM files WHERE workspace_id = $1`, [
      workspaceId,
    ]);
    // Delete workspace
    await client.query(`DELETE FROM workspaces WHERE id = $1`, [workspaceId]);
  });
}

// ============================================================================
// File Operations
// ============================================================================

export async function upsertFile(request: UpsertFileRequest): Promise<FileRow> {
  const {
    workspace_id,
    relative_path,
    language,
    size_bytes,
    hash,
    content,
    metadata,
  } = request;

  const id = crypto.randomUUID();

  const result = await cloudSQLManager.query<FileRow>(
    `INSERT INTO files (id, workspace_id, relative_path, language, size_bytes, hash, content, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (workspace_id, relative_path)
     DO UPDATE SET
       language = EXCLUDED.language,
       size_bytes = EXCLUDED.size_bytes,
       hash = EXCLUDED.hash,
       content = EXCLUDED.content,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING *`,
    [
      id,
      workspace_id,
      relative_path,
      language,
      size_bytes,
      hash,
      content || null,
      JSON.stringify(metadata || {}),
    ]
  );

  return result.rows[0];
}

export async function getFile(fileId: string): Promise<FileRow | null> {
  const result = await cloudSQLManager.query<FileRow>(
    `SELECT * FROM files WHERE id = $1`,
    [fileId]
  );
  return result.rows[0] || null;
}

export async function getFileByPath(
  workspaceId: string,
  relativePath: string
): Promise<FileRow | null> {
  const result = await cloudSQLManager.query<FileRow>(
    `SELECT * FROM files WHERE workspace_id = $1 AND relative_path = $2`,
    [workspaceId, relativePath]
  );
  return result.rows[0] || null;
}

export async function getWorkspaceFiles(
  workspaceId: string
): Promise<FileRow[]> {
  const result = await cloudSQLManager.query<FileRow>(
    `SELECT * FROM files WHERE workspace_id = $1 ORDER BY relative_path`,
    [workspaceId]
  );
  return result.rows;
}

export async function deleteFile(fileId: string): Promise<void> {
  await cloudSQLManager.transaction(async (client) => {
    await client.query(`DELETE FROM chunks WHERE file_id = $1`, [fileId]);
    await client.query(`DELETE FROM files WHERE id = $1`, [fileId]);
  });
}

export async function deleteFilesByHash(
  workspaceId: string,
  excludeHashes: string[]
): Promise<number> {
  const result = await cloudSQLManager.query<{ id: string }>(
    `DELETE FROM files
     WHERE workspace_id = $1 AND hash != ALL($2::text[])
     RETURNING id`,
    [workspaceId, excludeHashes]
  );
  return result.rowCount || 0;
}

// ============================================================================
// Chunk Operations
// ============================================================================

export async function upsertChunk(request: UpsertChunkRequest): Promise<ChunkRow> {
  const {
    file_id,
    workspace_id,
    content,
    start_line,
    end_line,
    chunk_type,
    symbol_name,
    embedding,
    metadata,
  } = request;

  const id = crypto.randomUUID();

  // Format embedding for pgvector
  const embeddingStr = embedding ? `[${embedding.join(",")}]` : null;

  const result = await cloudSQLManager.query<ChunkRow>(
    `INSERT INTO chunks (id, file_id, workspace_id, content, start_line, end_line, chunk_type, symbol_name, embedding, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10)
     RETURNING *`,
    [
      id,
      file_id,
      workspace_id,
      content,
      start_line,
      end_line,
      chunk_type,
      symbol_name || null,
      embeddingStr,
      JSON.stringify(metadata || {}),
    ]
  );

  return result.rows[0];
}

export async function upsertChunksBatch(
  requests: UpsertChunkRequest[]
): Promise<number> {
  if (requests.length === 0) return 0;

  return await cloudSQLManager.transaction(async (client) => {
    let count = 0;

    // Process in batches of 100
    for (let i = 0; i < requests.length; i += 100) {
      const batch = requests.slice(i, i + 100);

      const values: unknown[] = [];
      const placeholders: string[] = [];

      batch.forEach((req, idx) => {
        const offset = idx * 10;
        const id = crypto.randomUUID();
        const embeddingStr = req.embedding
          ? `[${req.embedding.join(",")}]`
          : null;

        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}::vector, $${offset + 10})`
        );

        values.push(
          id,
          req.file_id,
          req.workspace_id,
          req.content,
          req.start_line,
          req.end_line,
          req.chunk_type,
          req.symbol_name || null,
          embeddingStr,
          JSON.stringify(req.metadata || {})
        );
      });

      const result = await client.query(
        `INSERT INTO chunks (id, file_id, workspace_id, content, start_line, end_line, chunk_type, symbol_name, embedding, metadata)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (file_id, start_line, end_line)
         DO UPDATE SET
           content = EXCLUDED.content,
           chunk_type = EXCLUDED.chunk_type,
           symbol_name = EXCLUDED.symbol_name,
           embedding = EXCLUDED.embedding,
           metadata = EXCLUDED.metadata`,
        values
      );

      count += result.rowCount || 0;
    }

    return count;
  });
}

export async function deleteChunksByFile(fileId: string): Promise<void> {
  await cloudSQLManager.query(`DELETE FROM chunks WHERE file_id = $1`, [fileId]);
}

export async function deleteChunksByWorkspace(workspaceId: string): Promise<void> {
  await cloudSQLManager.query(`DELETE FROM chunks WHERE workspace_id = $1`, [
    workspaceId,
  ]);
}

// ============================================================================
// Vector Search
// ============================================================================

export async function vectorSearch(
  request: VectorSearchRequest
): Promise<CloudSQLSearchResult[]> {
  const {
    workspace_id,
    embedding,
    limit = 10,
    threshold = 0.7,
    chunk_types,
    file_patterns,
  } = request;

  const embeddingStr = `[${embedding.join(",")}]`;

  let whereClause = "c.workspace_id = $1";
  const params: unknown[] = [workspace_id, embeddingStr, limit];
  let paramIdx = 4;

  if (chunk_types && chunk_types.length > 0) {
    whereClause += ` AND c.chunk_type = ANY($${paramIdx}::text[])`;
    params.push(chunk_types);
    paramIdx++;
  }

  if (file_patterns && file_patterns.length > 0) {
    const patterns = file_patterns.map((p) => p.replace(/\*/g, "%"));
    whereClause += ` AND (${patterns.map((_, i) => `f.relative_path LIKE $${paramIdx + i}`).join(" OR ")})`;
    patterns.forEach((p) => params.push(p));
  }

  const result = await cloudSQLManager.query<CloudSQLSearchResult>(
    `SELECT
       c.id as chunk_id,
       c.file_id,
       c.workspace_id,
       f.relative_path,
       c.content,
       c.start_line,
       c.end_line,
       c.chunk_type,
       c.symbol_name,
       1 - (c.embedding <=> $2::vector) as similarity,
       f.language
     FROM chunks c
     JOIN files f ON c.file_id = f.id
     WHERE ${whereClause}
       AND c.embedding IS NOT NULL
       AND 1 - (c.embedding <=> $2::vector) >= ${threshold}
     ORDER BY c.embedding <=> $2::vector
     LIMIT $3`,
    params
  );

  return result.rows;
}

// ============================================================================
// Full-Text Search
// ============================================================================

export async function textSearch(
  request: TextSearchRequest
): Promise<CloudSQLSearchResult[]> {
  const {
    workspace_id,
    query,
    limit = 10,
    chunk_types,
    file_patterns,
    use_stemming = true,
  } = request;

  let whereClause = "c.workspace_id = $1";
  const params: unknown[] = [workspace_id];
  let paramIdx = 2;

  // Text search condition
  if (use_stemming) {
    whereClause += ` AND c.content_tsv @@ plainto_tsquery('english', $${paramIdx})`;
  } else {
    whereClause += ` AND c.content ILIKE $${paramIdx}`;
    params.push(`%${query}%`);
    paramIdx++;
  }

  if (use_stemming) {
    params.push(query);
    paramIdx++;
  }

  if (chunk_types && chunk_types.length > 0) {
    whereClause += ` AND c.chunk_type = ANY($${paramIdx}::text[])`;
    params.push(chunk_types);
    paramIdx++;
  }

  if (file_patterns && file_patterns.length > 0) {
    const patterns = file_patterns.map((p) => p.replace(/\*/g, "%"));
    whereClause += ` AND (${patterns.map((_, i) => `f.relative_path LIKE $${paramIdx + i}`).join(" OR ")})`;
    patterns.forEach((p) => params.push(p));
  }

  params.push(limit);

  const result = await cloudSQLManager.query<CloudSQLSearchResult>(
    `SELECT
       c.id as chunk_id,
       c.file_id,
       c.workspace_id,
       f.relative_path,
       c.content,
       c.start_line,
       c.end_line,
       c.chunk_type,
       c.symbol_name,
       ${use_stemming ? `ts_rank(c.content_tsv, plainto_tsquery('english', $2))` : "1"} as similarity,
       f.language
     FROM chunks c
     JOIN files f ON c.file_id = f.id
     WHERE ${whereClause}
     ORDER BY ${use_stemming ? `ts_rank(c.content_tsv, plainto_tsquery('english', $2)) DESC` : "c.start_line"}
     LIMIT $${params.length}`,
    params
  );

  return result.rows;
}

// ============================================================================
// Hybrid Search (Vector + Text)
// ============================================================================

export async function hybridSearch(
  workspaceId: string,
  query: string,
  embedding: number[],
  options: {
    limit?: number;
    vectorWeight?: number;
    textWeight?: number;
    threshold?: number;
    chunkTypes?: string[];
  } = {}
): Promise<CloudSQLSearchResult[]> {
  const {
    limit = 10,
    vectorWeight = 0.7,
    textWeight = 0.3,
    threshold = 0.5,
    chunkTypes,
  } = options;

  const embeddingStr = `[${embedding.join(",")}]`;

  let whereClause = "c.workspace_id = $1 AND c.embedding IS NOT NULL";
  const params: unknown[] = [workspaceId, embeddingStr, query, limit];

  if (chunkTypes && chunkTypes.length > 0) {
    whereClause += ` AND c.chunk_type = ANY($5::text[])`;
    params.push(chunkTypes);
  }

  const result = await cloudSQLManager.query<CloudSQLSearchResult>(
    `SELECT
       c.id as chunk_id,
       c.file_id,
       c.workspace_id,
       f.relative_path,
       c.content,
       c.start_line,
       c.end_line,
       c.chunk_type,
       c.symbol_name,
       (${vectorWeight} * (1 - (c.embedding <=> $2::vector)) +
        ${textWeight} * COALESCE(ts_rank(c.content_tsv, plainto_tsquery('english', $3)), 0)) as similarity,
       f.language
     FROM chunks c
     JOIN files f ON c.file_id = f.id
     WHERE ${whereClause}
     HAVING (${vectorWeight} * (1 - (c.embedding <=> $2::vector)) +
             ${textWeight} * COALESCE(ts_rank(c.content_tsv, plainto_tsquery('english', $3)), 0)) >= ${threshold}
     ORDER BY similarity DESC
     LIMIT $4`,
    params
  );

  return result.rows;
}
