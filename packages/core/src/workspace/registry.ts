/**
 * Workspace Registry
 *
 * Global registry for managing multiple workspaces.
 * Stores workspace metadata and provides CRUD operations.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import type {
  WorkspaceEntry,
  WorkspaceConfig,
  WorkspaceRegistry as IWorkspaceRegistry,
  RegistrySettings,
  WorkspaceEvent,
  DEFAULT_WORKSPACE_CONFIG,
  DEFAULT_REGISTRY_SETTINGS,
} from "./types";

// =============================================================================
// Types
// =============================================================================

export type WorkspaceEventHandler = (event: WorkspaceEvent) => void;

// =============================================================================
// Workspace Registry Class
// =============================================================================

export class WorkspaceRegistry {
  private registry: IWorkspaceRegistry;
  private registryPath: string;
  private storagePath: string;
  private eventHandlers: WorkspaceEventHandler[] = [];

  constructor(storagePath?: string) {
    this.storagePath = storagePath || path.join(os.homedir(), ".nella");
    this.registryPath = path.join(this.storagePath, "workspaces.json");

    // Ensure storage directory exists
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }

    // Load or create registry
    this.registry = this.loadRegistry();
  }

  /**
   * Add event handler
   */
  onEvent(handler: WorkspaceEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit event
   */
  private emit(event: WorkspaceEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Event handler error:", error);
      }
    }
  }

  /**
   * Register a new workspace
   */
  register(workspacePath: string, name?: string, config?: Partial<WorkspaceConfig>): WorkspaceEntry {
    const normalizedPath = path.normalize(path.resolve(workspacePath));

    // Check if already registered
    const existing = this.findByPath(normalizedPath);
    if (existing) {
      return existing;
    }

    // Generate workspace ID
    const id = this.generateWorkspaceId(normalizedPath);

    // Create workspace entry
    const workspace: WorkspaceEntry = {
      id,
      name: name || path.basename(normalizedPath),
      path: normalizedPath,
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      indexStatus: "none",
      stats: {
        filesIndexed: 0,
        chunksCount: 0,
        totalTokens: 0,
      },
      config: config ? { ...this.getDefaultConfig(), ...config } : undefined,
    };

    // Add to registry
    this.registry.workspaces.push(workspace);
    this.save();

    // Create workspace storage directory
    this.createWorkspaceStorage(id);

    this.emit({ type: "workspace:created", workspace });

    // Cleanup old workspaces if needed
    this.cleanupIfNeeded();

    return workspace;
  }

  /**
   * Remove a workspace
   */
  remove(workspaceId: string): boolean {
    const index = this.registry.workspaces.findIndex((w) => w.id === workspaceId);
    if (index === -1) return false;

    this.registry.workspaces.splice(index, 1);

    // Clear active if this was active
    if (this.registry.activeWorkspaceId === workspaceId) {
      this.registry.activeWorkspaceId = null;
    }

    this.save();

    // Remove workspace storage
    this.removeWorkspaceStorage(workspaceId);

    this.emit({ type: "workspace:removed", workspaceId });

    return true;
  }

  /**
   * Update a workspace
   */
  update(workspaceId: string, updates: Partial<Omit<WorkspaceEntry, "id" | "path" | "createdAt">>): WorkspaceEntry | null {
    const workspace = this.get(workspaceId);
    if (!workspace) return null;

    Object.assign(workspace, updates);
    this.save();

    this.emit({ type: "workspace:updated", workspace });

    return workspace;
  }

  /**
   * Get a workspace by ID
   */
  get(workspaceId: string): WorkspaceEntry | null {
    return this.registry.workspaces.find((w) => w.id === workspaceId) || null;
  }

  /**
   * Find workspace by path
   */
  findByPath(workspacePath: string): WorkspaceEntry | null {
    const normalizedPath = path.normalize(path.resolve(workspacePath));
    return this.registry.workspaces.find((w) => w.path === normalizedPath) || null;
  }

  /**
   * Get all workspaces
   */
  list(): WorkspaceEntry[] {
    return [...this.registry.workspaces];
  }

  /**
   * Set active workspace
   */
  setActive(workspaceId: string): boolean {
    const workspace = this.get(workspaceId);
    if (!workspace) return false;

    const previousId = this.registry.activeWorkspaceId;
    this.registry.activeWorkspaceId = workspaceId;
    workspace.lastAccessed = new Date().toISOString();
    this.save();

    this.emit({ type: "workspace:switched", from: previousId, to: workspaceId });

    return true;
  }

  /**
   * Get active workspace
   */
  getActive(): WorkspaceEntry | null {
    if (!this.registry.activeWorkspaceId) return null;
    return this.get(this.registry.activeWorkspaceId);
  }

  /**
   * Get active workspace ID
   */
  getActiveId(): string | null {
    return this.registry.activeWorkspaceId;
  }

  /**
   * Get workspace storage path
   */
  getStoragePath(workspaceId: string): string {
    return path.join(this.storagePath, "workspaces", workspaceId);
  }

  /**
   * Get workspace index path
   */
  getIndexPath(workspaceId: string): string {
    return path.join(this.getStoragePath(workspaceId), "index");
  }

  /**
   * Get workspace sessions path
   */
  getSessionsPath(workspaceId: string): string {
    return path.join(this.getStoragePath(workspaceId), "sessions");
  }

  /**
   * Update index status
   */
  updateIndexStatus(
    workspaceId: string,
    status: WorkspaceEntry["indexStatus"],
    stats?: WorkspaceEntry["stats"]
  ): void {
    const workspace = this.get(workspaceId);
    if (!workspace) return;

    workspace.indexStatus = status;
    if (stats) {
      workspace.stats = stats;
    }
    this.save();

    if (status === "ready") {
      this.emit({ type: "workspace:index:complete", workspaceId });
    } else if (status === "error") {
      this.emit({ type: "workspace:index:error", workspaceId, error: "Index failed" });
    }
  }

  /**
   * Get registry settings
   */
  getSettings(): RegistrySettings {
    return { ...this.registry.settings };
  }

  /**
   * Update registry settings
   */
  updateSettings(settings: Partial<RegistrySettings>): void {
    this.registry.settings = { ...this.registry.settings, ...settings };
    this.save();
  }

  /**
   * Get global storage path
   */
  getGlobalStoragePath(): string {
    return this.storagePath;
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private loadRegistry(): IWorkspaceRegistry {
    if (fs.existsSync(this.registryPath)) {
      try {
        const content = fs.readFileSync(this.registryPath, "utf-8");
        const registry = JSON.parse(content) as IWorkspaceRegistry;

        // Ensure settings have defaults
        registry.settings = {
          ...this.getDefaultSettings(),
          ...registry.settings,
        };

        return registry;
      } catch {
        // Corrupted file, start fresh
      }
    }

    return {
      workspaces: [],
      activeWorkspaceId: null,
      settings: this.getDefaultSettings(),
      version: "1.0.0",
      updatedAt: new Date().toISOString(),
    };
  }

  private save(): void {
    this.registry.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2));
  }

  private getDefaultSettings(): RegistrySettings {
    return {
      maxWorkspaces: 50,
      autoCleanup: true,
      cleanupAfterDays: 30,
      globalStoragePath: this.storagePath,
    };
  }

  private getDefaultConfig(): WorkspaceConfig {
    return {
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
        provider: "voyage",
        model: "voyage-code-2",
      },
      search: {
        vectorWeight: 0.4,
        lexicalWeight: 0.6,
        rerankEnabled: false,
      },
    };
  }

  private generateWorkspaceId(workspacePath: string): string {
    const hash = crypto.createHash("md5").update(workspacePath).digest("hex").slice(0, 8);
    const timestamp = Date.now().toString(36).slice(-4);
    return `ws_${hash}_${timestamp}`;
  }

  private createWorkspaceStorage(workspaceId: string): void {
    const storagePath = this.getStoragePath(workspaceId);
    const indexPath = this.getIndexPath(workspaceId);
    const sessionsPath = this.getSessionsPath(workspaceId);

    for (const dir of [storagePath, indexPath, sessionsPath]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  private removeWorkspaceStorage(workspaceId: string): void {
    const storagePath = this.getStoragePath(workspaceId);
    if (fs.existsSync(storagePath)) {
      fs.rmSync(storagePath, { recursive: true, force: true });
    }
  }

  private cleanupIfNeeded(): void {
    const settings = this.registry.settings;
    if (!settings.autoCleanup) return;

    // Remove old workspaces if over limit
    if (this.registry.workspaces.length > settings.maxWorkspaces) {
      // Sort by last accessed (oldest first)
      const sorted = [...this.registry.workspaces].sort(
        (a, b) => new Date(a.lastAccessed).getTime() - new Date(b.lastAccessed).getTime()
      );

      // Remove oldest
      const toRemove = sorted.slice(0, this.registry.workspaces.length - settings.maxWorkspaces);
      for (const workspace of toRemove) {
        // Don't remove active workspace
        if (workspace.id !== this.registry.activeWorkspaceId) {
          this.remove(workspace.id);
        }
      }
    }

    // Remove stale workspaces
    const cutoff = Date.now() - settings.cleanupAfterDays * 24 * 60 * 60 * 1000;
    const stale = this.registry.workspaces.filter(
      (w) => new Date(w.lastAccessed).getTime() < cutoff && w.id !== this.registry.activeWorkspaceId
    );

    for (const workspace of stale) {
      this.remove(workspace.id);
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

let defaultRegistry: WorkspaceRegistry | null = null;

export function getWorkspaceRegistry(storagePath?: string): WorkspaceRegistry {
  if (!defaultRegistry || storagePath) {
    defaultRegistry = new WorkspaceRegistry(storagePath);
  }
  return defaultRegistry;
}

export function createWorkspaceRegistry(storagePath?: string): WorkspaceRegistry {
  return new WorkspaceRegistry(storagePath);
}
