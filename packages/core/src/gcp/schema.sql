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
    embedding vector(1024),  -- voyage-code-3 dimension
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
-- Branch Indexes Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS branch_indexes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    branch_name TEXT NOT NULL,
    parent_branch TEXT NOT NULL DEFAULT 'main',
    fork_commit TEXT,
    head_commit TEXT,
    index_status TEXT NOT NULL DEFAULT 'none'
        CHECK (index_status IN ('ready', 'indexing', 'stale', 'none', 'error')),
    stats JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT branch_indexes_name_check CHECK (char_length(branch_name) > 0),
    CONSTRAINT branch_indexes_unique UNIQUE (workspace_id, branch_name)
);

CREATE INDEX IF NOT EXISTS idx_branch_indexes_workspace ON branch_indexes(workspace_id);

-- Add branch_name to chunks for branch-aware cloud search
-- Default 'main' for backward compatibility with existing data
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS branch_name TEXT NOT NULL DEFAULT 'main';
CREATE INDEX IF NOT EXISTS idx_chunks_workspace_branch ON chunks(workspace_id, branch_name);

-- Add default_branch and active_branch to workspaces
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS default_branch TEXT DEFAULT 'main';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS active_branch TEXT DEFAULT 'main';

-- Trigger for branch_indexes updated_at
DROP TRIGGER IF EXISTS branch_indexes_updated_at ON branch_indexes;
CREATE TRIGGER branch_indexes_updated_at
    BEFORE UPDATE ON branch_indexes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- Agent Presence (multi-agent coordination via GCP)
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_presence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'claude',
    branch TEXT,
    current_task TEXT,
    active_files TEXT[] DEFAULT '{}',
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'idle', 'busy', 'disconnected')),
    capabilities TEXT[] DEFAULT '{}',
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_agent_workspace UNIQUE (agent_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_presence_workspace ON agent_presence(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_presence_status ON agent_presence(status);
CREATE INDEX IF NOT EXISTS idx_agent_presence_user ON agent_presence(user_id);

-- ============================================================================
-- Agent Tasks (multi-agent task coordination via GCP)
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    assigned_agent TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'blocked')),
    parent_task_id UUID REFERENCES agent_tasks(id) ON DELETE SET NULL,
    files TEXT[] DEFAULT '{}',
    branch TEXT,
    priority INTEGER DEFAULT 5,
    dependencies UUID[] DEFAULT '{}',
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_workspace ON agent_tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON agent_tasks(assigned_agent);

-- ============================================================================
-- Agent Decisions (decision log via GCP)
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    decision TEXT NOT NULL,
    rationale TEXT NOT NULL,
    alternatives TEXT[] DEFAULT '{}',
    affected_files TEXT[] DEFAULT '{}',
    branch TEXT,
    acknowledged BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_decisions_workspace ON agent_decisions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_agent ON agent_decisions(agent_id);

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
