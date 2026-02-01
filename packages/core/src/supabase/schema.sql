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

-- =============================================================================
-- API Keys Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,  -- First 8 chars for identification (e.g., "nella_k_")
  permissions JSONB DEFAULT '[]'::jsonb,
  rate_limits JSONB DEFAULT '{
    "requests_per_minute": 60,
    "requests_per_hour": 1000,
    "requests_per_day": 10000
  }'::jsonb,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  
  CONSTRAINT valid_permissions CHECK (jsonb_typeof(permissions) = 'array'),
  CONSTRAINT valid_rate_limits CHECK (jsonb_typeof(rate_limits) = 'object')
);

-- Indexes
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);

-- RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own keys" ON api_keys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own keys" ON api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own keys" ON api_keys
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own keys" ON api_keys
  FOR DELETE USING (auth.uid() = user_id);

-- =============================================================================
-- Agents Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('claude', 'gpt', 'gemini', 'codex', 'cursor', 'copilot', 'custom')),
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  config JSONB DEFAULT '{}'::jsonb,
  stats JSONB DEFAULT '{
    "total_calls": 0,
    "total_tokens": 0,
    "total_cost": 0,
    "success_rate": 1.0,
    "avg_latency_ms": 0
  }'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ,
  
  CONSTRAINT unique_agent_name_per_user UNIQUE (user_id, name)
);

-- Indexes
CREATE INDEX idx_agents_user_id ON agents(user_id);
CREATE INDEX idx_agents_api_key_id ON agents(api_key_id);
CREATE INDEX idx_agents_type ON agents(type);

-- RLS
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own agents" ON agents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own agents" ON agents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own agents" ON agents
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own agents" ON agents
  FOR DELETE USING (auth.uid() = user_id);

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

-- Clean up expired context entries (run via pg_cron or scheduled function)
CREATE OR REPLACE FUNCTION cleanup_expired_context()
RETURNS void AS $$
BEGIN
  DELETE FROM context WHERE expires_at IS NOT NULL AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Usage Statistics View
-- =============================================================================

CREATE OR REPLACE VIEW user_stats AS
SELECT
  u.id AS user_id,
  u.email,
  COUNT(DISTINCT ak.id) AS api_key_count,
  COUNT(DISTINCT ag.id) AS agent_count,
  COUNT(DISTINCT c.workspace_id) AS workspace_count,
  COALESCE(SUM((ag.stats->>'total_calls')::int), 0) AS total_calls,
  COALESCE(SUM((ag.stats->>'total_tokens')::int), 0) AS total_tokens,
  COALESCE(SUM((ag.stats->>'total_cost')::numeric), 0) AS total_cost
FROM auth.users u
LEFT JOIN api_keys ak ON ak.user_id = u.id AND ak.revoked_at IS NULL
LEFT JOIN agents ag ON ag.user_id = u.id
LEFT JOIN context c ON c.user_id = u.id
GROUP BY u.id, u.email;

-- Grant access to authenticated users (for their own stats only)
-- Note: This view needs RLS or a function wrapper for security
