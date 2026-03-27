/**
 * Search Service
 *
 * Wraps IndexManager for workspace indexing, hybrid search, and code verification.
 * Provides the bridge between REST API endpoints and the RAG system.
 */

import { IndexManager, type IndexManagerConfig } from "../indexing";
import type {
  SearchQuery,
  SearchResponse,
  VerifyCodeRequest,
  VerifyCodeResult,
  IndexMetadata,
} from "../indexing";

// =============================================================================
// Types
// =============================================================================

export interface SearchServiceConfig {
  workspacePath: string;
  storagePath: string;
  embeddingProvider?: string;
  embeddingModel?: string;
}

export interface SearchParams {
  workspaceId: string;
  query: string;
  mode?: "hybrid" | "semantic" | "lexical";
  topK?: number;
  filters?: {
    language?: string;
    filePattern?: string;
  };
}

// =============================================================================
// Service
// =============================================================================

export class SearchService {
  private indexManagers: Map<string, IndexManager> = new Map();

  /**
   * Get or create an IndexManager for a workspace.
   */
  private getIndexManager(workspaceId: string, config: SearchServiceConfig): IndexManager {
    const existing = this.indexManagers.get(workspaceId);
    if (existing) return existing;

    const manager = new IndexManager({
      workspaceId,
      workspacePath: config.workspacePath,
      storagePath: config.storagePath,
      chunking: {
        maxTokens: 512,
        overlap: 50,
        strategy: "ast" as any,
      },
      embedder: {
        provider: "azure",
        model: "text-embedding-3-small",
        dimensions: 1536,
      },
      search: {
        vectorWeight: 0.7,
        lexicalWeight: 0.3,
        rerankEnabled: false,
        topK: 10,
      },
      include: ["**/*.ts", "**/*.js", "**/*.py", "**/*.java"],
      exclude: ["**/node_modules/**", "**/dist/**"],
    });

    this.indexManagers.set(workspaceId, manager);
    return manager;
  }

  /**
   * Index a workspace (async, can be long-running).
   */
  async indexWorkspace(
    workspaceId: string,
    config: SearchServiceConfig,
    _onProgress?: (progress: number, file: string) => void
  ): Promise<IndexMetadata> {
    const manager = this.getIndexManager(workspaceId, config);
    return manager.index();
  }

  /**
   * Search a workspace.
   */
  async search(
    params: SearchParams,
    config: SearchServiceConfig
  ): Promise<SearchResponse> {
    const manager = this.getIndexManager(params.workspaceId, config);

    const query: SearchQuery = {
      query: params.query,
      limit: params.topK || 10,
      mode: params.mode || "hybrid",
      filter: params.filters ? {
        fileTypes: params.filters.language ? [params.filters.language] : undefined,
        paths: params.filters.filePattern ? [params.filters.filePattern] : undefined,
      } : undefined,
    };

    return manager.search(query);
  }

  /**
   * Verify code against the indexed codebase.
   */
  async verifyCode(
    workspaceId: string,
    code: string,
    config: SearchServiceConfig,
    options?: { checkImports?: boolean; checkSymbols?: boolean }
  ): Promise<VerifyCodeResult> {
    const manager = this.getIndexManager(workspaceId, config);

    const request: VerifyCodeRequest = {
      code,
      checkImports: options?.checkImports ?? true,
      checkSymbols: options?.checkSymbols ?? true,
    };

    return manager.verify(request);
  }

  /**
   * Cleanup: remove an IndexManager from the cache.
   */
  removeWorkspace(workspaceId: string): void {
    this.indexManagers.delete(workspaceId);
  }
}
