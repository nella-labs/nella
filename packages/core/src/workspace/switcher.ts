/**
 * Workspace Switcher
 *
 * Hot-swap between workspaces with proper lifecycle management.
 * Handles index loading/unloading and resource cleanup.
 *
 * Features:
 * - LRU caching of workspaces
 * - Preloading of recently used workspaces
 * - Graceful shutdown with resource cleanup
 */

import type { WorkspaceEntry, WorkspaceEvent } from "./types";
import { WorkspaceRegistry, getWorkspaceRegistry } from "./registry";
import { Workspace, type WorkspaceOptions } from "./workspace";
import { LRUCache } from "./lru-cache";

// =============================================================================
// Types
// =============================================================================

export interface SwitcherOptions {
  registry?: WorkspaceRegistry;
  /** Number of workspaces to keep in memory (default: 3) */
  cacheSize?: number;
  /** TTL for cached workspaces in ms (default: 30 minutes) */
  cacheTtl?: number;
  /** Enable preloading of recent workspaces (default: false) */
  preloadRecent?: boolean;
  /** Number of recent workspaces to preload (default: 2) */
  preloadCount?: number;
  /** Enable file watching for active workspace (default: false) */
  watchEnabled?: boolean;
  /** Options to pass to loaded workspaces */
  workspaceOptions?: Partial<WorkspaceOptions>;
}

export type SwitcherEventHandler = (event: WorkspaceEvent) => void;

export type SwitcherState = "idle" | "switching" | "preloading" | "shutdown";

// =============================================================================
// Workspace Switcher Class
// =============================================================================

export class WorkspaceSwitcher {
  private registry: WorkspaceRegistry;
  private cache: LRUCache<Workspace>;
  private currentWorkspace: Workspace | null = null;
  private options: Required<Omit<SwitcherOptions, "registry" | "workspaceOptions">> & {
    registry: WorkspaceRegistry;
    workspaceOptions: Partial<WorkspaceOptions>;
  };
  private eventHandlers: SwitcherEventHandler[] = [];
  private state: SwitcherState = "idle";
  private preloadPromise: Promise<void> | null = null;
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: SwitcherOptions = {}) {
    this.registry = options.registry || getWorkspaceRegistry();
    this.options = {
      registry: this.registry,
      cacheSize: options.cacheSize ?? 3,
      cacheTtl: options.cacheTtl ?? 30 * 60 * 1000, // 30 minutes
      preloadRecent: options.preloadRecent ?? false,
      preloadCount: options.preloadCount ?? 2,
      watchEnabled: options.watchEnabled ?? false,
      workspaceOptions: options.workspaceOptions ?? {},
    };

    // Initialize LRU cache with eviction callback
    this.cache = new LRUCache<Workspace>({
      maxSize: this.options.cacheSize,
      ttl: this.options.cacheTtl,
      onEvict: async (_, workspace) => {
        // Dispose workspace on eviction
        workspace.dispose();
      },
    });

    // Load current active workspace if any
    const activeId = this.registry.getActiveId();
    if (activeId) {
      this.loadWorkspace(activeId).catch((err) => {
        console.error("Failed to load active workspace:", err);
      });
    }

    // Preload recent workspaces in background
    if (this.options.preloadRecent) {
      this.preloadRecentWorkspaces();
    }
  }

  // =============================================================================
  // State Management
  // =============================================================================

  /**
   * Get current switcher state
   */
  getState(): SwitcherState {
    return this.state;
  }

  /**
   * Check if switcher is ready for operations
   */
  isReady(): boolean {
    return this.state === "idle";
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  onEvent(handler: SwitcherEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: WorkspaceEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Switcher event handler error:", error);
      }
    }
  }

  // =============================================================================
  // Workspace Switching
  // =============================================================================

  /**
   * Switch to workspace by ID
   */
  async switchTo(workspaceId: string): Promise<Workspace> {
    // Don't switch during shutdown
    if (this.state === "shutdown") {
      throw new Error("Switcher is shutting down");
    }

    // Check if already current
    if (this.currentWorkspace?.id === workspaceId) {
      return this.currentWorkspace;
    }

    this.state = "switching";
    const previousId = this.currentWorkspace?.id || null;

    try {
      // Stop watching previous workspace
      if (this.currentWorkspace && this.options.watchEnabled) {
        this.currentWorkspace.stopWatching();
      }

      // Load or get from cache
      const workspace = await this.loadWorkspace(workspaceId);

      // Set as active in registry
      this.registry.setActive(workspaceId);

      // Update current
      this.currentWorkspace = workspace;

      // Start watching new workspace if enabled
      if (this.options.watchEnabled) {
        workspace.startWatching();
      }

      // Emit event
      this.emit({
        type: "workspace:switched",
        from: previousId,
        to: workspaceId,
      });

      return workspace;
    } finally {
      this.state = "idle";
    }
  }

  /**
   * Switch to workspace by path
   */
  async switchToPath(workspacePath: string, name?: string): Promise<Workspace> {
    let entry = this.registry.findByPath(workspacePath);

    if (!entry) {
      // Register new workspace
      entry = this.registry.register(workspacePath, name);
    }

    return this.switchTo(entry.id);
  }

  /**
   * Get current workspace
   */
  getCurrent(): Workspace | null {
    return this.currentWorkspace;
  }

  /**
   * Get current workspace or throw
   */
  requireCurrent(): Workspace {
    if (!this.currentWorkspace) {
      throw new Error("No active workspace. Use switchTo() or switchToPath() first.");
    }
    return this.currentWorkspace;
  }

  // =============================================================================
  // Workspace Management
  // =============================================================================

  /**
   * List all registered workspaces
   */
  list(): WorkspaceEntry[] {
    return this.registry.list();
  }

  /**
   * Get workspace by ID (lazy load)
   */
  async get(workspaceId: string): Promise<Workspace | null> {
    const entry = this.registry.get(workspaceId);
    if (!entry) return null;

    return this.loadWorkspace(workspaceId);
  }

  /**
   * Check if workspace is cached
   */
  isCached(workspaceId: string): boolean {
    return this.cache.has(workspaceId);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    cachedIds: string[];
  } {
    return {
      size: this.cache.size,
      maxSize: this.options.cacheSize,
      cachedIds: this.cache.keys(),
    };
  }

  /**
   * Create and register a new workspace
   */
  async create(workspacePath: string, name?: string): Promise<Workspace> {
    const entry = this.registry.register(workspacePath, name);
    const workspace = await this.loadWorkspace(entry.id);

    this.emit({ type: "workspace:created", workspace: entry });

    return workspace;
  }

  /**
   * Remove a workspace
   */
  async remove(workspaceId: string): Promise<boolean> {
    // Remove from cache (will call dispose via onEvict)
    await this.cache.delete(workspaceId);

    // If current, clear it
    if (this.currentWorkspace?.id === workspaceId) {
      this.currentWorkspace = null;
    }

    // Remove from registry
    const success = this.registry.remove(workspaceId);

    if (success) {
      this.emit({ type: "workspace:removed", workspaceId });
    }

    return success;
  }

  // =============================================================================
  // Recent Workspaces
  // =============================================================================

  /**
   * Get recently accessed workspaces
   */
  getRecent(limit: number = 5): WorkspaceEntry[] {
    const all = this.registry.list();
    return all
      .sort((a, b) => new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime())
      .slice(0, limit);
  }

  /**
   * Get workspaces by index status
   */
  getByStatus(status: WorkspaceEntry["indexStatus"]): WorkspaceEntry[] {
    return this.registry.list().filter((w) => w.indexStatus === status);
  }

  // =============================================================================
  // Index Operations
  // =============================================================================

  /**
   * Index current workspace
   */
  async indexCurrent(options?: { incremental?: boolean }): Promise<void> {
    const workspace = this.requireCurrent();
    await workspace.index(options);
  }

  /**
   * Index all workspaces
   */
  async indexAll(options?: { incremental?: boolean; parallel?: boolean }): Promise<Map<string, Error | null>> {
    const results = new Map<string, Error | null>();
    const workspaces = this.registry.list();

    if (options?.parallel) {
      // Parallel indexing
      const promises = workspaces.map(async (entry) => {
        try {
          const workspace = await this.loadWorkspace(entry.id);
          await workspace.index(options);
          results.set(entry.id, null);
        } catch (error) {
          results.set(entry.id, error instanceof Error ? error : new Error(String(error)));
        }
      });

      await Promise.all(promises);
    } else {
      // Sequential indexing
      for (const entry of workspaces) {
        try {
          const workspace = await this.loadWorkspace(entry.id);
          await workspace.index(options);
          results.set(entry.id, null);
        } catch (error) {
          results.set(entry.id, error instanceof Error ? error : new Error(String(error)));
        }
      }
    }

    return results;
  }

  // =============================================================================
  // Search Across Workspaces
  // =============================================================================

  /**
   * Search across all workspaces
   */
  async searchAll(query: string, limit: number = 10): Promise<Array<{
    workspaceId: string;
    workspaceName: string;
    results: Array<{
      content: string;
      filePath: string;
      score: number;
    }>;
  }>> {
    const workspaces = this.registry.list();
    const allResults: Array<{
      workspaceId: string;
      workspaceName: string;
      results: Array<{
        content: string;
        filePath: string;
        score: number;
      }>;
    }> = [];

    for (const entry of workspaces) {
      if (entry.indexStatus !== "ready") continue;

      try {
        const workspace = await this.loadWorkspace(entry.id);
        const response = await workspace.search({
          query,
          limit: limit,
          mode: "hybrid",
        });

        if (response.results.length > 0) {
          allResults.push({
            workspaceId: entry.id,
            workspaceName: entry.name,
            results: response.results.map((r) => ({
              content: r.chunk.content,
              filePath: r.chunk.filePath,
              score: r.score,
            })),
          });
        }
      } catch (error) {
        console.error(`Search error in workspace ${entry.id}:`, error);
      }
    }

    // Sort by best score in each workspace
    allResults.sort((a, b) => {
      const aScore = Math.max(...a.results.map((r) => r.score));
      const bScore = Math.max(...b.results.map((r) => r.score));
      return bScore - aScore;
    });

    return allResults;
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private async loadWorkspace(workspaceId: string): Promise<Workspace> {
    // Check cache first
    const cached = this.cache.get(workspaceId);
    if (cached) {
      return cached;
    }

    // Load workspace
    const workspace = new Workspace(workspaceId, {
      registry: this.registry,
      autoLoad: true,
      watchEnabled: false, // We control watching at switcher level
      ...this.options.workspaceOptions,
    });

    // Add to cache
    this.cache.set(workspaceId, workspace);

    return workspace;
  }

  /**
   * Preload recent workspaces in background
   */
  private async preloadRecentWorkspaces(): Promise<void> {
    if (this.preloadPromise) return;

    this.state = "preloading";
    this.preloadPromise = (async () => {
      try {
        const recent = this.getRecent(this.options.preloadCount);
        const currentId = this.currentWorkspace?.id;

        for (const entry of recent) {
          // Skip current workspace
          if (entry.id === currentId) continue;
          // Skip if already cached
          if (this.cache.has(entry.id)) continue;

          try {
            await this.loadWorkspace(entry.id);
          } catch (error) {
            console.warn(`Failed to preload workspace ${entry.id}:`, error);
          }
        }
      } finally {
        this.state = "idle";
        this.preloadPromise = null;
      }
    })();

    return this.preloadPromise;
  }

  // =============================================================================
  // Shutdown
  // =============================================================================

  /**
   * Graceful shutdown with resource cleanup
   */
  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.state = "shutdown";
    this.shutdownPromise = (async () => {
      try {
        // Wait for any preloading to complete
        if (this.preloadPromise) {
          await this.preloadPromise;
        }

        // Stop watching current workspace
        if (this.currentWorkspace && this.options.watchEnabled) {
          this.currentWorkspace.stopWatching();
        }

        // Clear cache (will dispose all workspaces)
        await this.cache.clear();

        // Clear current workspace reference
        this.currentWorkspace = null;

        // Clear event handlers
        this.eventHandlers = [];
      } finally {
        this.shutdownPromise = null;
      }
    })();

    return this.shutdownPromise;
  }

  /**
   * Close switcher and cleanup resources (alias for shutdown)
   */
  async close(): Promise<void> {
    return this.shutdown();
  }
}

// =============================================================================
// Factory
// =============================================================================

let defaultSwitcher: WorkspaceSwitcher | null = null;

export function getWorkspaceSwitcher(options?: SwitcherOptions): WorkspaceSwitcher {
  if (!defaultSwitcher) {
    defaultSwitcher = new WorkspaceSwitcher(options);
  }
  return defaultSwitcher;
}

export function createWorkspaceSwitcher(options?: SwitcherOptions): WorkspaceSwitcher {
  return new WorkspaceSwitcher(options);
}

/**
 * Reset the default switcher instance (for testing)
 */
export async function resetDefaultSwitcher(): Promise<void> {
  if (defaultSwitcher) {
    await defaultSwitcher.shutdown();
    defaultSwitcher = null;
  }
}
