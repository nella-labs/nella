-- =============================================================================
-- Supabase Schema for nella
-- 
-- This schema is for the Supabase "control plane":
-- - Auth (handled by Supabase Auth automatically)
-- - API Keys (with RLS)
-- - Agents (with RLS)
-- - Context (with RLS + Realtime)
--
-- Run this in Supabase SQL Editor or via migrations
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- REMOVED 2026-03-15: api_keys table unused by application code
-- CREATE TABLE IF NOT EXISTS api_keys (...);
-- + indexes, RLS policies

-- REMOVED 2026-03-15: agents table unused by application code
-- CREATE TABLE IF NOT EXISTS agents (...);
-- + indexes, RLS policies

-- =============================================================================
-- Context Table (with Realtime)
-- =============================================================================

CREATE TABLE IF NOT EXISTS context (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB,
  type TEXT DEFAULT 'custom' CHECK (type IN ('variable', 'snippet', 'assumption', 'dependency', 'preference', 'custom')),
  tags TEXT[] DEFAULT '{}',
  ttl_seconds INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  
  CONSTRAINT unique_context_key UNIQUE (user_id, workspace_id, key)
);

-- Indexes
CREATE INDEX idx_context_user_workspace ON context(user_id, workspace_id);
CREATE INDEX idx_context_key ON context(key);
CREATE INDEX idx_context_type ON context(type);
CREATE INDEX idx_context_tags ON context USING GIN(tags);
CREATE INDEX idx_context_expires ON context(expires_at) WHERE expires_at IS NOT NULL;

-- RLS
ALTER TABLE context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own context" ON context
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own context" ON context
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own context" ON context
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own context" ON context
  FOR DELETE USING (auth.uid() = user_id);

-- Enable Realtime for context table
ALTER PUBLICATION supabase_realtime ADD TABLE context;

-- =============================================================================
-- Functions
-- =============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER context_updated_at
  BEFORE UPDATE ON context
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Auto-set expires_at based on ttl_seconds
CREATE OR REPLACE FUNCTION set_expires_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ttl_seconds IS NOT NULL THEN
    NEW.expires_at = NOW() + (NEW.ttl_seconds || ' seconds')::INTERVAL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER context_set_expires
  BEFORE INSERT OR UPDATE ON context
  FOR EACH ROW
  EXECUTE FUNCTION set_expires_at();

-- REMOVED 2026-03-15: cleanup_expired_context() never called from application
-- CREATE OR REPLACE FUNCTION cleanup_expired_context() ...;

-- REMOVED 2026-03-15: user_stats view unused — references removed api_keys/agents tables
-- CREATE OR REPLACE VIEW user_stats AS ...;

-- =============================================================================
-- GitHub Repository Links
-- =============================================================================

CREATE TABLE IF NOT EXISTS github_repo_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  repo_id BIGINT NOT NULL,
  default_branch TEXT DEFAULT 'main',
  webhook_id BIGINT,
  webhook_secret TEXT NOT NULL,
  installation_id BIGINT NOT NULL,
  events TEXT[] DEFAULT '{"push","pull_request"}',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'pending', 'error', 'disconnected')),
  org_id UUID,
  project_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_workspace_repo UNIQUE (workspace_id, repo_id)
);

CREATE INDEX IF NOT EXISTS idx_repo_links_user ON github_repo_links(user_id);
CREATE INDEX IF NOT EXISTS idx_repo_links_workspace ON github_repo_links(workspace_id);
CREATE INDEX IF NOT EXISTS idx_repo_links_repo_id ON github_repo_links(repo_id);

ALTER TABLE github_repo_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own repo links" ON github_repo_links
  FOR ALL USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE github_repo_links;

CREATE TRIGGER github_repo_links_updated_at
  BEFORE UPDATE ON github_repo_links
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Agent state (presence, tasks, decisions) is stored in GCP Cloud SQL,
-- not Supabase. See gcp/schema.sql for those tables.
-- Supabase Realtime channels are used only for cross-machine event
-- notifications (lightweight pub/sub), not as the data store.
