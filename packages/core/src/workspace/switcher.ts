/**
 * Workspace Switcher
 *
 * Hot-swap between workspaces with proper lifecycle management.
 * Handles index loading/unloading and resource cleanup.
 */

import type { WorkspaceEntry, WorkspaceEvent } from "./types";
import { WorkspaceRegistry, getWorkspaceRegistry } from "./registry";
import { Workspace } from "./workspace";

// =============================================================================
// Types
// =============================================================================

export interface SwitcherOptions {
  registry?: WorkspaceRegistry;
  preloadNext?: boolean;
  keepInMemory?: number;
}

export type SwitcherEventHandler = (event: WorkspaceEvent) => void;

interface CachedWorkspace {
  workspace: Workspace;
  lastUsed: number;
}

// =============================================================================
// Workspace Switcher Class
// =============================================================================

export class WorkspaceSwitcher {
  private registry: WorkspaceRegistry;
  private cache: Map<string, CachedWorkspace> = new Map();
  private currentWorkspace: Workspace | null = null;
  private options: Required<SwitcherOptions>;
  private eventHandlers: SwitcherEventHandler[] = [];

  constructor(options: SwitcherOptions = {}) {
    this.registry = options.registry || getWorkspaceRegistry();
    this.options = {
      registry: this.registry,
      preloadNext: options.preloadNext ?? false,
      keepInMemory: options.keepInMemory ?? 3,
    };

    // Load current active workspace if any
    const activeId = this.registry.getActiveId();
    if (activeId) {
      this.loadWorkspace(activeId);
    }
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
    // Check if already current
    if (this.currentWorkspace?.id === workspaceId) {
      return this.currentWorkspace;
    }

    const previousId = this.currentWorkspace?.id || null;

    // Load or get from cache
    const workspace = await this.loadWorkspace(workspaceId);

    // Set as active in registry
    this.registry.setActive(workspaceId);

    // Update current
    this.currentWorkspace = workspace;

    // Emit event
    this.emit({
      type: "workspace:switched",
      from: previousId,
      to: workspaceId,
    });

    // Cleanup cache if needed
    this.cleanupCache();

    return workspace;
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
    // Remove from cache
    this.cache.delete(workspaceId);

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
              content: r.content,
              filePath: r.filePath,
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
      cached.lastUsed = Date.now();
      return cached.workspace;
    }

    // Load workspace
    const workspace = new Workspace(workspaceId, {
      registry: this.registry,
      autoLoad: true,
    });

    // Add to cache
    this.cache.set(workspaceId, {
      workspace,
      lastUsed: Date.now(),
    });

    return workspace;
  }

  private cleanupCache(): void {
    if (this.cache.size <= this.options.keepInMemory) {
      return;
    }

    // Get cache entries sorted by last used (oldest first)
    const entries = Array.from(this.cache.entries()).sort(
      ([, a], [, b]) => a.lastUsed - b.lastUsed
    );

    // Remove oldest entries, keeping current workspace
    const toRemove = entries.slice(0, this.cache.size - this.options.keepInMemory);
    for (const [id] of toRemove) {
      if (id !== this.currentWorkspace?.id) {
        this.cache.delete(id);
      }
    }
  }

  /**
   * Close switcher and cleanup resources
   */
  close(): void {
    this.cache.clear();
    this.currentWorkspace = null;
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
