-- ============================================================================
-- GCP Cloud SQL Schema for nella
-- PostgreSQL with pgvector extension
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- Workspaces Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    stats JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_indexed_at TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT workspaces_name_check CHECK (char_length(name) > 0),
    CONSTRAINT workspaces_root_path_check CHECK (char_length(root_path) > 0)
);

-- Indexes for workspaces
CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_updated_at ON workspaces(updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_user_root ON workspaces(user_id, root_path);

-- ============================================================================
-- Files Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'unknown',
    size_bytes BIGINT NOT NULL DEFAULT 0,
    hash TEXT NOT NULL,
    content TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT files_relative_path_check CHECK (char_length(relative_path) > 0),
    CONSTRAINT files_hash_check CHECK (char_length(hash) > 0)
);

-- Indexes for files
CREATE INDEX IF NOT EXISTS idx_files_workspace_id ON files(workspace_id);
-- REMOVED 2026-03-15: unused indexes — no queries filter by language or hash alone
-- CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
-- CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_workspace_path ON files(workspace_id, relative_path);

-- REMOVED 2026-03-15: trigram index unused — no pattern matching queries
-- CREATE INDEX IF NOT EXISTS idx_files_path_trgm ON files USING gin(relative_path gin_trgm_ops);

-- ============================================================================
-- Chunks Table (with pgvector)
-- ============================================================================

CREATE TABLE IF NOT EXISTS chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    chunk_type TEXT NOT NULL DEFAULT 'block',
    symbol_name TEXT,
    embedding vector(384),  -- MiniLM-L6-v2 dimension
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Full-text search vector (auto-generated)
    content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    
    -- Constraints
    CONSTRAINT chunks_lines_check CHECK (start_line >= 0 AND end_line >= start_line),
    CONSTRAINT chunks_chunk_type_check CHECK (chunk_type IN (
        'function', 'class', 'method', 'interface', 'type',
        'const', 'import', 'export', 'comment', 'block', 'file'
    ))
);

-- Indexes for chunks
CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_workspace_id ON chunks(workspace_id);
-- REMOVED 2026-03-15: unused indexes — filtering done in application, not DB
-- CREATE INDEX IF NOT EXISTS idx_chunks_chunk_type ON chunks(chunk_type);
-- CREATE INDEX IF NOT EXISTS idx_chunks_symbol_name ON chunks(symbol_name) WHERE symbol_name IS NOT NULL;

-- Unique constraint for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_file_lines ON chunks(file_id, start_line, end_line);

-- REMOVED 2026-03-15: full-text search index unused — hybrid search reimplemented in TypeScript
-- CREATE INDEX IF NOT EXISTS idx_chunks_content_tsv ON chunks USING gin(content_tsv);

-- HNSW index for vector similarity search (faster than IVFFlat for small-medium datasets)
-- Note: Create after data is loaded for better index quality
-- Parameters: m=16 (connections per node), ef_construction=64 (build quality)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw ON chunks 
USING hnsw(embedding vector_cosine_ops) 
WITH (m = 16, ef_construction = 64);

-- Alternative: IVFFlat for larger datasets (100k+ vectors)
-- CREATE INDEX IF NOT EXISTS idx_chunks_embedding_ivfflat ON chunks 
-- USING ivfflat(embedding vector_cosine_ops) 
-- WITH (lists = 100);

-- REMOVED 2026-03-15: index_stats table unused by application code
-- CREATE TABLE IF NOT EXISTS index_stats (...);
-- CREATE INDEX IF NOT EXISTS idx_index_stats_workspace_date ON index_stats(...);

-- ============================================================================
-- Functions
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS workspaces_updated_at ON workspaces;
CREATE TRIGGER workspaces_updated_at
    BEFORE UPDATE ON workspaces
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS files_updated_at ON files;
CREATE TRIGGER files_updated_at
    BEFORE UPDATE ON files
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- REMOVED 2026-03-15: hybrid_search() reimplemented in TypeScript (gcp/cloudsql.ts:610)
-- CREATE OR REPLACE FUNCTION hybrid_search(...) ...;

-- Function to cleanup old chunks when file is re-indexed
CREATE OR REPLACE FUNCTION cleanup_file_chunks()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.hash != NEW.hash THEN
        DELETE FROM chunks WHERE file_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS files_cleanup_chunks ON files;
CREATE TRIGGER files_cleanup_chunks
    AFTER UPDATE ON files
    FOR EACH ROW
    EXECUTE FUNCTION cleanup_file_chunks();

-- Function to update workspace stats
CREATE OR REPLACE FUNCTION update_workspace_stats(p_workspace_id UUID)
RETURNS void AS $$
DECLARE
    v_file_count INTEGER;
    v_chunk_count INTEGER;
    v_total_size BIGINT;
BEGIN
    SELECT COUNT(*), COALESCE(SUM(size_bytes), 0)
    INTO v_file_count, v_total_size
    FROM files
    WHERE workspace_id = p_workspace_id;
    
    SELECT COUNT(*)
    INTO v_chunk_count
    FROM chunks
    WHERE workspace_id = p_workspace_id;
    
    UPDATE workspaces
    SET stats = jsonb_build_object(
        'file_count', v_file_count,
        'chunk_count', v_chunk_count,
        'total_size_bytes', v_total_size
    ),
    updated_at = NOW()
    WHERE id = p_workspace_id;
END;
$$ LANGUAGE plpgsql;

-- REMOVED 2026-03-15: maintenance functions unused by application code
-- CREATE OR REPLACE FUNCTION maintenance_vacuum_analyze() ...;
-- CREATE OR REPLACE FUNCTION cleanup_stale_workspaces(...) ...;

-- ============================================================================
-- Grants (adjust for your user)
-- ============================================================================

-- Example: Grant access to application user
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nella_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nella_app;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO nella_app;
