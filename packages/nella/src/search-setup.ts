/**
 * Shared search setup utilities.
 *
 * Extracted from mcp/tools/indexing.ts so both the CLI and MCP server
 * can resolve embedder config and create IndexManagers without duplication.
 */

import * as path from "path";
import {
  createIndexManager,
  DEFAULT_INDEX_CONFIG,
  DEFAULT_EMBEDDING_MODEL,
  MODEL_DIMENSIONS,
  BranchIndexManager,
  gitUtils,
} from "@usenella/core";
import type { IndexManagerConfig } from "@usenella/core";
import { getValidSession } from "./auth";

// =============================================================================
// Embedder Config Resolution
// =============================================================================

/**
 * Resolve the embedder provider config.
 * Priority: direct Voyage API (lowest latency) > Nella proxy > Azure.
 */
export async function resolveEmbedderConfig(): Promise<IndexManagerConfig["embedder"]> {
  if (process.env.VOYAGE_API_KEY) {
    return {
      provider: "voyage",
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: MODEL_DIMENSIONS[DEFAULT_EMBEDDING_MODEL],
    };
  }

  const session = await getValidSession();
  if (session) {
    return {
      provider: "nella",
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: MODEL_DIMENSIONS[DEFAULT_EMBEDDING_MODEL],
      apiKey: session.access_token,
      apiBase: "https://app.getnella.dev/api",
    };
  }

  if (process.env.AZURE_EMBEDDING_API_KEY && process.env.AZURE_ENDPOINT) {
    return {
      provider: "azure",
      model: "text-embedding-3-small",
      dimensions: 1536,
    };
  }

  throw new Error("Not authenticated. Run 'nella auth login' to get started.");
}

// =============================================================================
// IndexManager Factory (cached)
// =============================================================================

let cachedManager: ReturnType<typeof createIndexManager> | null = null;
let cachedWorkspacePath: string | null = null;
let cachedBranchManager: BranchIndexManager | null = null;
let cachedBranchWorkspacePath: string | null = null;

export async function getOrCreateManager(workspacePath: string): Promise<ReturnType<typeof createIndexManager>> {
  if (cachedManager && cachedWorkspacePath === workspacePath) {
    return cachedManager;
  }

  const workspaceId = path.basename(workspacePath);
  const storagePath = path.join(workspacePath, ".nella", "index");
  const embedderConfig = await resolveEmbedderConfig();

  const config: IndexManagerConfig = {
    workspaceId,
    workspacePath,
    storagePath,
    chunking: {
      maxTokens: 512,
      overlap: 50,
      strategy: "ast",
    },
    embedder: embedderConfig,
    search: {
      vectorWeight: 0.4,
      lexicalWeight: 0.6,
      rerankEnabled: true,
      topK: 5,
    },
    include: DEFAULT_INDEX_CONFIG.include,
    exclude: [...DEFAULT_INDEX_CONFIG.exclude, "**/.nella/**"],
  };

  cachedManager = createIndexManager(config);
  cachedWorkspacePath = workspacePath;
  return cachedManager;
}

export async function getOrCreateBranchManager(workspacePath: string): Promise<BranchIndexManager> {
  if (cachedBranchManager && cachedBranchWorkspacePath === workspacePath) {
    return cachedBranchManager;
  }

  const isRepo = await gitUtils.isGitRepo(workspacePath);
  if (!isRepo) {
    throw new Error("Workspace is not a git repository. Branch operations require git.");
  }

  const defaultBranch = await gitUtils.getDefaultBranch(workspacePath);
  const storagePath = path.join(workspacePath, ".nella", "index");
  const embedderConfig = await resolveEmbedderConfig();

  cachedBranchManager = new BranchIndexManager({
    workspaceId: path.basename(workspacePath),
    workspacePath,
    baseStoragePath: storagePath,
    defaultBranch,
    indexConfig: {
      ...DEFAULT_INDEX_CONFIG,
      chunking: { maxTokens: 512, overlap: 50, strategy: "ast" },
      embedder: embedderConfig,
      search: { vectorWeight: 0.4, lexicalWeight: 0.6, rerankEnabled: true, topK: 5 },
      exclude: [...DEFAULT_INDEX_CONFIG.exclude, "**/.nella/**"],
    },
  });
  cachedBranchWorkspacePath = workspacePath;
  return cachedBranchManager;
}
