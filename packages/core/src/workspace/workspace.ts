/**
 * Workspace
 *
 * Individual workspace management with integrated IndexManager.
 * Each workspace has isolated index, sessions, and context.
 *
 * Features:
 * - Automatic file watching for incremental indexing
 * - Lazy loading of resources
 * - Memory management
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
import { IndexManager, type IndexManagerConfig } from "../indexing";
import type { SearchQuery, SearchResponse, VerifyCodeRequest, VerifyCodeResult } from "../indexing/types";
import { FileWatcher, type BatchChangeEvent, type WatcherOptions } from "./file-watcher";

// =============================================================================
// Types
// =============================================================================

export interface WorkspaceOptions {
  registry?: WorkspaceRegistry;
  autoLoad?: boolean;
  watchEnabled?: boolean;
  watchOptions?: Omit<WatcherOptions, "include" | "exclude">;
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
  private fileWatcher: FileWatcher | null = null;
  private watchEnabled: boolean;
  private watchOptions: Omit<WatcherOptions, "include" | "exclude">;
  private indexingInProgress = false;
  private pendingReindex = false;

  constructor(workspaceId: string, options: WorkspaceOptions = {}) {
    this.registry = options.registry || getWorkspaceRegistry();
    this.watchEnabled = options.watchEnabled ?? false;
    this.watchOptions = options.watchOptions ?? {};

    const entry = this.registry.get(workspaceId);
    if (!entry) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    this.entry = entry;

    if (options.autoLoad !== false) {
      this.loadSharedContext();
    }

    // Start file watching if enabled
    if (this.watchEnabled) {
      this.startWatching();
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
      // Build IndexManagerConfig from workspace config
      const indexConfig: IndexManagerConfig = {
        workspaceId: this.entry.id,
        workspacePath: this.entry.path,
        storagePath: this.indexPath,
        embedder: {
          provider: this.entry.config?.embedder?.provider || "voyage",
          model: this.entry.config?.embedder?.model || "voyage-code-2",
          dimensions: 1536,
        },
        chunking: {
          maxTokens: 512,
          overlap: 50,
          strategy: "ast",
        },
        search: {
          vectorWeight: this.entry.config?.search?.vectorWeight || 0.4,
          lexicalWeight: this.entry.config?.search?.lexicalWeight || 0.6,
          rerankEnabled: this.entry.config?.search?.rerankEnabled || false,
          topK: 10,
        },
        include: this.entry.config?.include || ["**/*.ts", "**/*.js", "**/*.py"],
        exclude: this.entry.config?.exclude || ["**/node_modules/**", "**/dist/**"],
      };

      this.indexManager = new IndexManager(indexConfig);

      // Forward events
      this.indexManager.onEvent((event) => {
        if (event.type === "index:complete") {
          const metadata = this.indexManager?.getMetadata();
          if (metadata) {
            this.registry.updateIndexStatus(this.entry.id, "ready", {
              filesIndexed: metadata.stats.filesIndexed,
              chunksCount: metadata.stats.chunksCount,
              totalTokens: metadata.stats.totalTokens,
            });
          }
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
        force: !options?.incremental,
      });

      // Update status through registry
      const metadata = manager.getMetadata();
      if (metadata) {
        this.registry.updateIndexStatus(this.entry.id, "ready", {
          filesIndexed: metadata.stats.filesIndexed,
          chunksCount: metadata.stats.chunksCount,
          totalTokens: metadata.stats.totalTokens,
        });
      }

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
    const currentConfig = this.entry.config || DEFAULT_WORKSPACE_CONFIG;
    const newConfig: WorkspaceConfig = { ...currentConfig, ...config };

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
    const metadata = manager.getMetadata();

    return {
      entry: { ...this.entry },
      context: this.getContext(),
      indexStats: {
        filesIndexed: metadata?.stats.filesIndexed || 0,
        chunksCount: metadata?.stats.chunksCount || 0,
        tokensIndexed: metadata?.stats.totalTokens || 0,
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
    watchEnabled: boolean;
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
      watchEnabled: this.fileWatcher?.isRunning() ?? false,
    };
  }

  // =============================================================================
  // File Watching
  // =============================================================================

  /**
   * Start watching for file changes
   */
  startWatching(): void {
    if (this.fileWatcher?.isRunning()) return;

    const config = this.entry.config || DEFAULT_WORKSPACE_CONFIG;

    this.fileWatcher = new FileWatcher(this.entry.path, {
      ...this.watchOptions,
      include: config.include,
      exclude: config.exclude,
    });

    this.fileWatcher.onChange(async (event: BatchChangeEvent) => {
      await this.handleFileChanges(event);
    });

    this.fileWatcher.start();
    this.emit({ type: "workspace:watch:start", workspaceId: this.entry.id });
  }

  /**
   * Stop watching for file changes
   */
  stopWatching(): void {
    if (!this.fileWatcher) return;

    this.fileWatcher.stop();
    this.fileWatcher = null;
    this.emit({ type: "workspace:watch:stop", workspaceId: this.entry.id });
  }

  /**
   * Check if watching is enabled
   */
  isWatching(): boolean {
    return this.fileWatcher?.isRunning() ?? false;
  }

  /**
   * Get watch statistics
   */
  getWatchStats(): { watchedDirectories: number; pendingChanges: number } | null {
    return this.fileWatcher?.getStats() ?? null;
  }

  /**
   * Handle file change events
   */
  private async handleFileChanges(event: BatchChangeEvent): Promise<void> {
    // Skip if indexing is already in progress
    if (this.indexingInProgress) {
      this.pendingReindex = true;
      return;
    }

    // Only trigger re-index if config allows
    const config = this.entry.config;
    if (!config?.indexOnChange) return;

    // Emit change event
    this.emit({
      type: "workspace:files:changed",
      workspaceId: this.entry.id,
      changes: event.changes.map((c) => ({
        type: c.type,
        path: c.relativePath,
      })),
    });

    // Mark index as stale
    this.registry.updateIndexStatus(this.entry.id, "stale");
    this.entry = this.registry.get(this.entry.id)!;

    // Trigger incremental re-index
    try {
      this.indexingInProgress = true;
      await this.index({ incremental: true });
    } finally {
      this.indexingInProgress = false;

      // Check if more changes came in while we were indexing
      if (this.pendingReindex) {
        this.pendingReindex = false;
        // Schedule another re-index after a short delay
        setTimeout(() => {
          this.index({ incremental: true }).catch((err) => {
            console.error("Pending re-index failed:", err);
          });
        }, 500);
      }
    }
  }

  // =============================================================================
  // Lifecycle
  // =============================================================================

  /**
   * Dispose workspace resources
   */
  dispose(): void {
    // Stop watching
    this.stopWatching();

    // Clear index manager
    this.indexManager = null;

    // Clear context (don't save - it's already saved on each change)
    this.sharedContext = null;

    // Clear event handlers
    this.eventHandlers = [];
  }
}
