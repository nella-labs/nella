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
}

export interface WorkspaceConfig {
  // Index settings
  autoIndex: boolean;
  indexOnChange: boolean;
  
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

export interface EmbedderConfig {
  provider: "azure";
  model: string;
  dimensions?: number;
}

export interface SearchConfig {
  vectorWeight: number;
  lexicalWeight: number;
  rerankEnabled: boolean;
  topK?: number;
}

const _DEFAULT_MODEL = "text-embedding-3-small";
const _DEFAULT_DIMS: Record<string, number> = { "text-embedding-3-small": 1536, "text-embedding-3-large": 3072 };

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  autoIndex: true,
  indexOnChange: true,
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
    provider: "azure",
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
  | { type: "workspace:files:changed"; workspaceId: string; changes: Array<{ type: string; path: string }> };
