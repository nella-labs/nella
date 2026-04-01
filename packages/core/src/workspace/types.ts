/**
 * Workspace Types
 *
 * Type definitions for multi-workspace management.
 */

// =============================================================================
// Workspace
// =============================================================================

export interface WorkspaceEntry {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastAccessed: string;
  indexStatus: "ready" | "indexing" | "stale" | "none" | "error";
  stats: {
    filesIndexed: number;
    chunksCount: number;
    totalTokens: number;
  };
  config?: WorkspaceConfig;
  orgId?: string;
  projectId?: string;
  /** Git branch tracking (populated when workspace is in a git repo) */
  git?: GitBranchTracking;
}

// =============================================================================
// Branch Tracking
// =============================================================================

export interface GitBranchTracking {
  /** Remote repository URL (set when GitHub-linked) */
  remoteUrl?: string;
  /** Default/main branch name (e.g., "main" or "master") */
  defaultBranch: string;
  /** Currently active branch for this workspace */
  activeBranch: string;
  /** Branch index metadata keyed by branch name */
  branches: Record<string, BranchIndexInfo>;
}

export interface BranchIndexInfo {
  /** Branch name */
  name: string;
  /** Parent branch this was forked from */
  parentBranch: string;
  /** Commit SHA at fork point */
  forkPoint: string;
  /** Current HEAD commit when last indexed */
  headCommit: string;
  /** Index status for this branch overlay */
  indexStatus: WorkspaceEntry["indexStatus"];
  /** Stats specific to this branch overlay */
  stats: WorkspaceEntry["stats"];
  /** When this branch index was created */
  createdAt: string;
  /** When this branch index was last updated */
  updatedAt: string;
}

export interface WorkspaceConfig {
  // Index settings
  autoIndex: boolean;
  indexOnChange: boolean;

  /**
   * Where the index is stored and searched.
   * - "local": Index stored on disk only (default, safest)
   * - "cloud": Index synced to GCP Cloud SQL + Cloud Storage
   *
   * Cloud mode requires the org to have enabled cloud indexing for this
   * repo. Use local by default; orgs opt-in specific repos for cloud.
   */
  indexMode: IndexMode;

  // Include/exclude patterns
  include: string[];
  exclude: string[];

  // Embedding settings
  embedder: EmbedderConfig;

  // Chunking settings
  chunking?: {
    maxTokens: number;
    overlap: number;
    strategy: "ast" | "recursive" | "fixed";
  };

  // Search settings
  search: SearchConfig;
}

/**
 * Index storage mode.
 * - "local": All index data stays on the developer's machine (default)
 * - "cloud": Index is synced to GCP for cross-machine search and
 *   GitHub-triggered auto-indexing. Requires org-level opt-in.
 */
export type IndexMode = "local" | "cloud";

/**
 * Organization-level cloud indexing policy.
 * Controls which repos within an org are allowed to use cloud indexing.
 */
export interface CloudIndexPolicy {
  /** Whether cloud indexing is enabled for this org at all */
  enabled: boolean;
  /**
   * Allowlisted repo patterns (owner/repo or glob).
   * Empty = all repos allowed when enabled.
   * Example: ["acme/frontend", "acme/api-*"]
   */
  allowedRepos: string[];
  /**
   * Denylisted repos (overrides allowlist).
   * Example: ["acme/secrets-vault"]
   */
  deniedRepos: string[];
}

export interface EmbedderConfig {
  provider: "azure" | "voyage";
  model: string;
  dimensions?: number;
}

export interface SearchConfig {
  vectorWeight: number;
  lexicalWeight: number;
  rerankEnabled: boolean;
  topK?: number;
}

const _DEFAULT_MODEL = "voyage-code-3";
const _DEFAULT_DIMS: Record<string, number> = { "text-embedding-3-small": 1536, "text-embedding-3-large": 3072, "voyage-code-3": 2048 };

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  autoIndex: true,
  indexOnChange: true,
  indexMode: "local",
  include: [
    "**/*.ts",
    "**/*.tsx",
    "**/*.js",
    "**/*.jsx",
    "**/*.py",
    "**/*.md",
    "**/*.json",
  ],
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**",
  ],
  embedder: {
    provider: "voyage",
    model: _DEFAULT_MODEL,
    dimensions: _DEFAULT_DIMS[_DEFAULT_MODEL],
  },
  search: {
    vectorWeight: 0.4,
    lexicalWeight: 0.6,
    rerankEnabled: true,
    topK: 10,
  },
};

// =============================================================================
// Registry
// =============================================================================

export interface WorkspaceRegistry {
  workspaces: WorkspaceEntry[];
  activeWorkspaceId: string | null;
  settings: RegistrySettings;
  version: string;
  updatedAt: string;
}

export interface RegistrySettings {
  maxWorkspaces: number;
  autoCleanup: boolean;
  cleanupAfterDays: number;
  globalStoragePath: string;
}

export const DEFAULT_REGISTRY_SETTINGS: RegistrySettings = {
  maxWorkspaces: 50,
  autoCleanup: true,
  cleanupAfterDays: 30,
  globalStoragePath: "",  // Set dynamically to ~/.nella
};

// =============================================================================
// Events
// =============================================================================

export type WorkspaceEvent =
  | { type: "workspace:created"; workspace: WorkspaceEntry }
  | { type: "workspace:updated"; workspace: WorkspaceEntry }
  | { type: "workspace:removed"; workspaceId: string }
  | { type: "workspace:switched"; from: string | null; to: string }
  | { type: "workspace:index:start"; workspaceId: string }
  | { type: "workspace:index:complete"; workspaceId: string }
  | { type: "workspace:index:error"; workspaceId: string; error: string }
  | { type: "workspace:watch:start"; workspaceId: string }
  | { type: "workspace:watch:stop"; workspaceId: string }
  | { type: "workspace:files:changed"; workspaceId: string; changes: Array<{ type: string; path: string }> }
  | { type: "workspace:branch:created"; workspaceId: string; branch: string }
  | { type: "workspace:branch:switched"; workspaceId: string; from: string; to: string }
  | { type: "workspace:branch:merged"; workspaceId: string; branch: string; into: string }
  | { type: "workspace:branch:deleted"; workspaceId: string; branch: string };
