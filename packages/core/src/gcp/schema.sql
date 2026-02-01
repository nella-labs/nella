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
CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_workspace_path ON files(workspace_id, relative_path);

-- Trigram index for path pattern matching
CREATE INDEX IF NOT EXISTS idx_files_path_trgm ON files USING gin(relative_path gin_trgm_ops);

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
CREATE INDEX IF NOT EXISTS idx_chunks_chunk_type ON chunks(chunk_type);
CREATE INDEX IF NOT EXISTS idx_chunks_symbol_name ON chunks(symbol_name) WHERE symbol_name IS NOT NULL;

-- Unique constraint for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_file_lines ON chunks(file_id, start_line, end_line);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_chunks_content_tsv ON chunks USING gin(content_tsv);

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

-- ============================================================================
-- Index Stats Table (for optimization)
-- ============================================================================

CREATE TABLE IF NOT EXISTS index_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    stat_date DATE NOT NULL DEFAULT CURRENT_DATE,
    file_count INTEGER NOT NULL DEFAULT 0,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    embedding_count INTEGER NOT NULL DEFAULT 0,
    total_size_bytes BIGINT NOT NULL DEFAULT 0,
    index_time_ms INTEGER NOT NULL DEFAULT 0,
    search_count INTEGER NOT NULL DEFAULT 0,
    avg_search_time_ms REAL NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT index_stats_unique UNIQUE (workspace_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_index_stats_workspace_date ON index_stats(workspace_id, stat_date DESC);

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

-- Function for hybrid search (vector + text)
CREATE OR REPLACE FUNCTION hybrid_search(
    p_workspace_id UUID,
    p_query TEXT,
    p_embedding vector(384),
    p_limit INTEGER DEFAULT 10,
    p_vector_weight REAL DEFAULT 0.7,
    p_text_weight REAL DEFAULT 0.3,
    p_threshold REAL DEFAULT 0.5
)
RETURNS TABLE (
    chunk_id UUID,
    file_id UUID,
    workspace_id UUID,
    relative_path TEXT,
    content TEXT,
    start_line INTEGER,
    end_line INTEGER,
    chunk_type TEXT,
    symbol_name TEXT,
    similarity REAL,
    language TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id AS chunk_id,
        c.file_id,
        c.workspace_id,
        f.relative_path,
        c.content,
        c.start_line,
        c.end_line,
        c.chunk_type,
        c.symbol_name,
        (p_vector_weight * (1 - (c.embedding <=> p_embedding)) +
         p_text_weight * COALESCE(ts_rank(c.content_tsv, plainto_tsquery('english', p_query)), 0))::REAL AS similarity,
        f.language
    FROM chunks c
    JOIN files f ON c.file_id = f.id
    WHERE c.workspace_id = p_workspace_id
      AND c.embedding IS NOT NULL
      AND (p_vector_weight * (1 - (c.embedding <=> p_embedding)) +
           p_text_weight * COALESCE(ts_rank(c.content_tsv, plainto_tsquery('english', p_query)), 0)) >= p_threshold
    ORDER BY similarity DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

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

-- ============================================================================
-- Maintenance Functions
-- ============================================================================

-- Function to vacuum and reindex (run periodically)
CREATE OR REPLACE FUNCTION maintenance_vacuum_analyze()
RETURNS void AS $$
BEGIN
    VACUUM ANALYZE workspaces;
    VACUUM ANALYZE files;
    VACUUM ANALYZE chunks;
    VACUUM ANALYZE index_stats;
END;
$$ LANGUAGE plpgsql;

-- Function to delete old workspaces (not updated in N days)
CREATE OR REPLACE FUNCTION cleanup_stale_workspaces(p_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    WITH deleted AS (
        DELETE FROM workspaces
        WHERE updated_at < NOW() - (p_days || ' days')::INTERVAL
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM deleted;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Grants (adjust for your user)
-- ============================================================================

-- Example: Grant access to application user
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nella_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nella_app;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO nella_app;
