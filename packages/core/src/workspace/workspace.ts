/**
 * Workspace
 *
 * Individual workspace management with integrated IndexManager.
 * Each workspace has isolated index, sessions, and context.
 */

import * as fs from "fs";
import * as path from "path";
import type {
  WorkspaceEntry,
  WorkspaceConfig,
  WorkspaceEvent,
} from "./types";
import { DEFAULT_WORKSPACE_CONFIG } from "./types";
import { WorkspaceRegistry, getWorkspaceRegistry } from "./registry";
import { IndexManager, DEFAULT_INDEX_CONFIG } from "../indexing";
import type { IndexManagerConfig } from "../indexing";
import type { SearchQuery, SearchResponse, VerifyCodeRequest, VerifyCodeResult } from "../indexing/types";

// =============================================================================
// Types
// =============================================================================

export interface WorkspaceOptions {
  registry?: WorkspaceRegistry;
  autoLoad?: boolean;
}

export interface SharedContext {
  variables: Record<string, unknown>;
  snippets: Array<{
    id: string;
    content: string;
    language: string;
    source: string;
    createdAt: string;
  }>;
  preferences: Record<string, unknown>;
  history: Array<{
    query: string;
    response: string;
    timestamp: string;
  }>;
  updatedAt: string;
}

export type WorkspaceEventHandler = (event: WorkspaceEvent) => void;

// =============================================================================
// Workspace Class
// =============================================================================

export class Workspace {
  private registry: WorkspaceRegistry;
  private entry: WorkspaceEntry;
  private indexManager: IndexManager | null = null;
  private sharedContext: SharedContext | null = null;
  private eventHandlers: WorkspaceEventHandler[] = [];

  constructor(workspaceId: string, options: WorkspaceOptions = {}) {
    this.registry = options.registry || getWorkspaceRegistry();

    const entry = this.registry.get(workspaceId);
    if (!entry) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    this.entry = entry;

    if (options.autoLoad !== false) {
      this.loadSharedContext();
    }
  }

  // =============================================================================
  // Static Factory Methods
  // =============================================================================

  /**
   * Create workspace from existing registration
   */
  static fromId(workspaceId: string, options?: WorkspaceOptions): Workspace {
    return new Workspace(workspaceId, options);
  }

  /**
   * Create workspace from path (registers if not exists)
   */
  static fromPath(workspacePath: string, name?: string, options?: WorkspaceOptions): Workspace {
    const registry = options?.registry || getWorkspaceRegistry();
    let entry = registry.findByPath(workspacePath);

    if (!entry) {
      entry = registry.register(workspacePath, name);
    }

    return new Workspace(entry.id, { ...options, registry });
  }

  /**
   * Get current active workspace
   */
  static getActive(options?: WorkspaceOptions): Workspace | null {
    const registry = options?.registry || getWorkspaceRegistry();
    const activeId = registry.getActiveId();
    if (!activeId) return null;

    return new Workspace(activeId, { ...options, registry });
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  onEvent(handler: WorkspaceEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: WorkspaceEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Event handler error:", error);
      }
    }
  }

  // =============================================================================
  // Basic Accessors
  // =============================================================================

  get id(): string {
    return this.entry.id;
  }

  get name(): string {
    return this.entry.name;
  }

  get path(): string {
    return this.entry.path;
  }

  get indexStatus(): WorkspaceEntry["indexStatus"] {
    return this.entry.indexStatus;
  }

  get stats(): WorkspaceEntry["stats"] {
    return this.entry.stats;
  }

  get config(): WorkspaceConfig | undefined {
    return this.entry.config;
  }

  get storagePath(): string {
    return this.registry.getStoragePath(this.entry.id);
  }

  get indexPath(): string {
    return this.registry.getIndexPath(this.entry.id);
  }

  get sessionsPath(): string {
    return this.registry.getSessionsPath(this.entry.id);
  }

  // =============================================================================
  // Index Management
  // =============================================================================

  /**
   * Get or create IndexManager for this workspace
   */
  async getIndexManager(): Promise<IndexManager> {
    if (!this.indexManager) {
      const workspaceConfig = this.entry.config;

      const config: IndexManagerConfig = {
        ...DEFAULT_INDEX_CONFIG,
        workspaceId: this.entry.id,
        workspacePath: this.entry.path,
        storagePath: this.indexPath,
        include: workspaceConfig?.include ?? DEFAULT_INDEX_CONFIG.include,
        exclude: workspaceConfig?.exclude ?? DEFAULT_INDEX_CONFIG.exclude,
        embedder: {
          ...DEFAULT_INDEX_CONFIG.embedder,
          ...workspaceConfig?.embedder,
        },
        chunking: {
          ...DEFAULT_INDEX_CONFIG.chunking,
          ...workspaceConfig?.chunking,
        },
        search: {
          ...DEFAULT_INDEX_CONFIG.search,
          ...workspaceConfig?.search,
        },
      };

      this.indexManager = new IndexManager(config);

      // Forward events
      this.indexManager.onEvent((event) => {
        if (event.type === "index:complete") {
          this.registry.updateIndexStatus(this.entry.id, "ready", {
            filesIndexed: event.stats.filesIndexed,
            chunksCount: event.stats.chunksCount,
            totalTokens: event.stats.totalTokens,
          });
        }
      });
    }

    return this.indexManager;
  }

  /**
   * Index the workspace
   */
  async index(options?: { incremental?: boolean }): Promise<void> {
    this.registry.updateIndexStatus(this.entry.id, "indexing");
    this.emit({ type: "workspace:index:start", workspaceId: this.entry.id });

    try {
      const manager = await this.getIndexManager();
      await manager.index({
        force: options?.incremental === false,
      });

      // Update status through registry
      const status = manager.getStatus();
      const stats = status.stats || {
        filesIndexed: 0,
        chunksCount: 0,
        totalTokens: 0,
        embeddingsCount: 0,
      };
      this.registry.updateIndexStatus(this.entry.id, "ready", {
        filesIndexed: stats.filesIndexed,
        chunksCount: stats.chunksCount,
        totalTokens: stats.totalTokens,
      });

      // Update local entry
      this.entry = this.registry.get(this.entry.id)!;

      this.emit({ type: "workspace:index:complete", workspaceId: this.entry.id });
    } catch (error) {
      this.registry.updateIndexStatus(this.entry.id, "error");
      this.emit({
        type: "workspace:index:error",
        workspaceId: this.entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Search the workspace index
   */
  async search(query: SearchQuery): Promise<SearchResponse> {
    const manager = await this.getIndexManager();
    return manager.search(query);
  }

  /**
   * Verify code against the index
   */
  async verify(request: VerifyCodeRequest): Promise<VerifyCodeResult> {
    const manager = await this.getIndexManager();
    return manager.verify(request);
  }

  /**
   * Clear the index
   */
  async clearIndex(): Promise<void> {
    if (this.indexManager) {
      // Reset the manager
      this.indexManager = null;
    }

    // Remove index files
    const indexPath = this.indexPath;
    if (fs.existsSync(indexPath)) {
      fs.rmSync(indexPath, { recursive: true, force: true });
      fs.mkdirSync(indexPath, { recursive: true });
    }

    this.registry.updateIndexStatus(this.entry.id, "none", {
      filesIndexed: 0,
      chunksCount: 0,
      totalTokens: 0,
    });

    this.entry = this.registry.get(this.entry.id)!;
  }

  // =============================================================================
  // Shared Context
  // =============================================================================

  private getContextPath(): string {
    return path.join(this.storagePath, "shared-context.json");
  }

  private loadSharedContext(): void {
    const contextPath = this.getContextPath();
    if (fs.existsSync(contextPath)) {
      try {
        const content = fs.readFileSync(contextPath, "utf-8");
        this.sharedContext = JSON.parse(content);
      } catch {
        this.sharedContext = this.createEmptyContext();
      }
    } else {
      this.sharedContext = this.createEmptyContext();
    }
  }

  private createEmptyContext(): SharedContext {
    return {
      variables: {},
      snippets: [],
      preferences: {},
      history: [],
      updatedAt: new Date().toISOString(),
    };
  }

  private saveSharedContext(): void {
    if (!this.sharedContext) return;

    this.sharedContext.updatedAt = new Date().toISOString();
    const contextPath = this.getContextPath();
    fs.writeFileSync(contextPath, JSON.stringify(this.sharedContext, null, 2));
  }

  /**
   * Get shared context
   */
  getContext(): SharedContext {
    if (!this.sharedContext) {
      this.loadSharedContext();
    }
    return this.sharedContext!;
  }

  /**
   * Set context variable
   */
  setContextVariable(key: string, value: unknown): void {
    if (!this.sharedContext) {
      this.loadSharedContext();
    }
    this.sharedContext!.variables[key] = value;
    this.saveSharedContext();
  }

  /**
   * Get context variable
   */
  getContextVariable<T = unknown>(key: string): T | undefined {
    if (!this.sharedContext) {
      this.loadSharedContext();
    }
    return this.sharedContext!.variables[key] as T | undefined;
  }

  /**
   * Add code snippet to shared context
   */
  addSnippet(content: string, language: string, source: string): string {
    if (!this.sharedContext) {
      this.loadSharedContext();
    }

    const id = `snip_${Date.now().toString(36)}`;
    this.sharedContext!.snippets.push({
      id,
      content,
      language,
      source,
      createdAt: new Date().toISOString(),
    });

    // Keep last 100 snippets
    if (this.sharedContext!.snippets.length > 100) {
      this.sharedContext!.snippets = this.sharedContext!.snippets.slice(-100);
    }

    this.saveSharedContext();
    return id;
  }

  /**
   * Add to history
   */
  addToHistory(query: string, response: string): void {
    if (!this.sharedContext) {
      this.loadSharedContext();
    }

    this.sharedContext!.history.push({
      query,
      response,
      timestamp: new Date().toISOString(),
    });

    // Keep last 50 history entries
    if (this.sharedContext!.history.length > 50) {
      this.sharedContext!.history = this.sharedContext!.history.slice(-50);
    }

    this.saveSharedContext();
  }

  /**
   * Clear shared context
   */
  clearContext(): void {
    this.sharedContext = this.createEmptyContext();
    this.saveSharedContext();
  }

  // =============================================================================
  // Workspace Management
  // =============================================================================

  /**
   * Activate this workspace
   */
  activate(): boolean {
    return this.registry.setActive(this.entry.id);
  }

  /**
   * Update workspace configuration
   */
  updateConfig(config: Partial<WorkspaceConfig>): void {
    const currentConfig: WorkspaceConfig = {
      ...DEFAULT_WORKSPACE_CONFIG,
      ...this.entry.config,
      embedder: {
        ...DEFAULT_WORKSPACE_CONFIG.embedder,
        ...this.entry.config?.embedder,
      },
      search: {
        ...DEFAULT_WORKSPACE_CONFIG.search,
        ...this.entry.config?.search,
      },
    };
    const newConfig: WorkspaceConfig = {
      ...currentConfig,
      ...config,
      embedder: {
        ...currentConfig.embedder,
        ...config.embedder,
      },
      search: {
        ...currentConfig.search,
        ...config.search,
      },
      chunking: config.chunking ?? currentConfig.chunking,
    };

    this.registry.update(this.entry.id, { config: newConfig });
    this.entry = this.registry.get(this.entry.id)!;
  }

  /**
   * Rename workspace
   */
  rename(newName: string): void {
    this.registry.update(this.entry.id, { name: newName });
    this.entry = this.registry.get(this.entry.id)!;
  }

  /**
   * Delete workspace and all its data
   */
  delete(): boolean {
    // Close index manager
    this.indexManager = null;

    // Remove from registry (this also removes storage)
    return this.registry.remove(this.entry.id);
  }

  /**
   * Export workspace data
   */
  async export(): Promise<{
    entry: WorkspaceEntry;
    context: SharedContext;
    indexStats: {
      filesIndexed: number;
      chunksCount: number;
      tokensIndexed: number;
    };
  }> {
    const manager = await this.getIndexManager();
    const status = manager.getStatus();
    const stats = status.stats || {
      filesIndexed: 0,
      chunksCount: 0,
      totalTokens: 0,
      embeddingsCount: 0,
    };

    return {
      entry: { ...this.entry },
      context: this.getContext(),
      indexStats: {
        filesIndexed: stats.filesIndexed,
        chunksCount: stats.chunksCount,
        tokensIndexed: stats.totalTokens,
      },
    };
  }

  /**
   * Get workspace info summary
   */
  getInfo(): {
    id: string;
    name: string;
    path: string;
    indexStatus: WorkspaceEntry["indexStatus"];
    stats: WorkspaceEntry["stats"];
    isActive: boolean;
    createdAt: string;
    lastAccessed: string;
  } {
    return {
      id: this.entry.id,
      name: this.entry.name,
      path: this.entry.path,
      indexStatus: this.entry.indexStatus,
      stats: this.entry.stats,
      isActive: this.registry.getActiveId() === this.entry.id,
      createdAt: this.entry.createdAt,
      lastAccessed: this.entry.lastAccessed,
    };
  }
}
