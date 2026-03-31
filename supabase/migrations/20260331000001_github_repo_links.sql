-- GitHub Repository Links
-- Links nella workspaces to GitHub repos for automatic indexing

CREATE TABLE IF NOT EXISTS github_repo_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  repo_id BIGINT NOT NULL DEFAULT 0,
  default_branch TEXT DEFAULT 'main',
  webhook_id BIGINT,
  webhook_secret TEXT NOT NULL,
  installation_id BIGINT NOT NULL DEFAULT 0,
  events TEXT[] DEFAULT '{push,pull_request}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'error', 'disconnected')),
  org_id UUID,
  project_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repo_links_user ON github_repo_links(user_id);
CREATE INDEX IF NOT EXISTS idx_repo_links_workspace ON github_repo_links(workspace_id);
CREATE INDEX IF NOT EXISTS idx_repo_links_org ON github_repo_links(org_id);

ALTER TABLE github_repo_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own repo links" ON github_repo_links
  FOR ALL USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE github_repo_links;
