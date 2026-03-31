/**
 * Workspace Registry
 *
 * Global registry for managing multiple workspaces.
 * Stores workspace metadata and provides CRUD operations.
 *
 * Features:
 * - File locking for concurrent access safety
 * - Automatic backup/restore
 * - Schema migration support
 * - Workspace validation
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
} from "./types";
import {
  DEFAULT_WORKSPACE_CONFIG,
} from "./types";
import { FileLock, withFileLock } from "./file-lock";
import { RegistryBackupManager, type BackupInfo } from "./backup";
import {
  RegistryMigrationManager,
  CURRENT_REGISTRY_VERSION,
  type MigrationResult,
} from "./migration";
import {
  WorkspaceValidator,
  type BatchValidationResult,
  type ValidationResult,
} from "./validator";

// =============================================================================
// Types
// =============================================================================

export type WorkspaceEventHandler = (event: WorkspaceEvent) => void;

export interface RegistryOptions {
  storagePath?: string;
  enableBackups?: boolean;
  maxBackups?: number;
  enableValidation?: boolean;
  enableLocking?: boolean;
  lockTimeout?: number;
}

// =============================================================================
// Workspace Registry Class
// =============================================================================

export class WorkspaceRegistry {
  private registry: IWorkspaceRegistry;
  private registryPath: string;
  private storagePath: string;
  private eventHandlers: WorkspaceEventHandler[] = [];

  // New utilities
  private fileLock: FileLock | null = null;
  private backupManager: RegistryBackupManager | null = null;
  private migrationManager: RegistryMigrationManager;
  private validator: WorkspaceValidator;
  private options: Required<RegistryOptions>;

  constructor(storagePathOrOptions?: string | RegistryOptions) {
    // Parse options
    if (typeof storagePathOrOptions === "string") {
      this.options = {
        storagePath: storagePathOrOptions,
        enableBackups: true,
        maxBackups: 5,
        enableValidation: true,
        enableLocking: true,
        lockTimeout: 5000,
      };
    } else {
      this.options = {
        storagePath: storagePathOrOptions?.storagePath || path.join(os.homedir(), ".nella"),
        enableBackups: storagePathOrOptions?.enableBackups ?? true,
        maxBackups: storagePathOrOptions?.maxBackups ?? 5,
        enableValidation: storagePathOrOptions?.enableValidation ?? true,
        enableLocking: storagePathOrOptions?.enableLocking ?? true,
        lockTimeout: storagePathOrOptions?.lockTimeout ?? 5000,
      };
    }

    this.storagePath = this.options.storagePath;
    this.registryPath = path.join(this.storagePath, "workspaces.json");

    // Ensure storage directory exists
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }

    // Initialize utilities
    if (this.options.enableLocking) {
      this.fileLock = new FileLock(this.registryPath);
    }

    if (this.options.enableBackups) {
      this.backupManager = new RegistryBackupManager(this.storagePath, {
        maxBackups: this.options.maxBackups,
      });
    }

    this.migrationManager = new RegistryMigrationManager();
    this.validator = new WorkspaceValidator();

    // Load or create registry (with migration)
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
  register(
    workspacePath: string,
    name?: string,
    config?: Partial<WorkspaceConfig>,
    orgId?: string,
    projectId?: string
  ): WorkspaceEntry {
    const normalizedPath = path.normalize(path.resolve(workspacePath));

    // Check if already registered
    const existing = this.findByPath(normalizedPath);
    if (existing) {
      // Update org/project if provided and different
      if (orgId !== undefined || projectId !== undefined) {
        if (orgId !== undefined) existing.orgId = orgId;
        if (projectId !== undefined) existing.projectId = projectId;
        this.save();
      }
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
      orgId,
      projectId,
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
   * Get branch-specific index path.
   * Default branch stores at index/main/, feature branches at index/branches/<name>/.
   */
  getBranchIndexPath(workspaceId: string, branch: string): string {
    const basePath = this.getIndexPath(workspaceId);
    if (branch === "main" || branch === "master") {
      return path.join(basePath, "main");
    }
    const sanitized = branch.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(basePath, "branches", sanitized);
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
  // Validation Methods
  // =============================================================================

  /**
   * Validate all workspaces
   */
  async validateWorkspaces(): Promise<BatchValidationResult> {
    return this.validator.validateBatch(this.registry.workspaces);
  }

  /**
   * Validate a single workspace
   */
  async validateWorkspace(workspaceId: string): Promise<ValidationResult | null> {
    const workspace = this.get(workspaceId);
    if (!workspace) return null;
    return this.validator.validate(workspace);
  }

  /**
   * Get stale workspace IDs (paths that no longer exist)
   */
  async getStaleWorkspaces(): Promise<string[]> {
    return this.validator.getStaleWorkspaceIds(this.registry.workspaces);
  }

  /**
   * Remove all stale workspaces
   */
  async removeStaleWorkspaces(): Promise<string[]> {
    const staleIds = await this.getStaleWorkspaces();
    for (const id of staleIds) {
      this.remove(id);
    }
    return staleIds;
  }

  // =============================================================================
  // Backup Methods
  // =============================================================================

  /**
   * Create a backup of the registry
   */
  createBackup(label?: string): BackupInfo | null {
    if (!this.backupManager) return null;
    return this.backupManager.createBackup(this.registry, label);
  }

  /**
   * List available backups
   */
  listBackups(): BackupInfo[] {
    if (!this.backupManager) return [];
    return this.backupManager.listBackups();
  }

  /**
   * Restore from a specific backup
   */
  restoreFromBackup(backupPath: string): boolean {
    if (!this.backupManager) return false;

    try {
      this.backupManager.restoreFromBackup(backupPath, this.registryPath);
      // Reload registry after restore
      this.registry = this.loadRegistry();
      const active = this.getActive();
      if (active) {
        this.emit({ type: "workspace:updated", workspace: active });
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Restore from latest backup
   */
  restoreLatestBackup(): boolean {
    if (!this.backupManager) return false;

    try {
      const restored = this.backupManager.restoreLatest(this.registryPath);
      if (restored) {
        // Reload registry after restore
        this.registry = this.loadRegistry();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // =============================================================================
  // Migration Methods
  // =============================================================================

  /**
   * Check if migration is needed
   */
  needsMigration(): boolean {
    return this.migrationManager.needsMigration(this.registry);
  }

  /**
   * Get current registry version
   */
  getVersion(): string {
    return this.registry.version || "1.0.0";
  }

  /**
   * Get target version
   */
  getTargetVersion(): string {
    return CURRENT_REGISTRY_VERSION;
  }

  /**
   * Manually run migration
   */
  runMigration(): MigrationResult {
    const result = this.migrationManager.migrate(this.registry);
    if (result.success) {
      this.save();
    }
    return result;
  }

  // =============================================================================
  // Import/Export Methods
  // =============================================================================

  /**
   * Export registry to JSON string
   */
  export(): string {
    return JSON.stringify(this.registry, null, 2);
  }

  /**
   * Import registry from JSON string (merges with existing)
   */
  import(json: string, overwrite = false): { imported: number; skipped: number } {
    const imported: IWorkspaceRegistry = JSON.parse(json);
    let importCount = 0;
    let skipCount = 0;

    for (const workspace of imported.workspaces) {
      const existing = this.findByPath(workspace.path);

      if (existing && !overwrite) {
        skipCount++;
        continue;
      }

      if (existing && overwrite) {
        // Update existing
        Object.assign(existing, workspace);
      } else {
        // Add new
        this.registry.workspaces.push(workspace);
      }

      importCount++;
    }

    if (importCount > 0) {
      this.save();
    }

    return { imported: importCount, skipped: skipCount };
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private loadRegistry(): IWorkspaceRegistry {
    if (fs.existsSync(this.registryPath)) {
      try {
        const content = fs.readFileSync(this.registryPath, "utf-8");
        let registry = JSON.parse(content) as IWorkspaceRegistry;

        // Handle malformed registry (e.g., bare array or non-object)
        if (Array.isArray(registry) || typeof registry !== "object" || registry === null) {
          console.warn("Registry file has invalid structure, reinitializing");
          registry = {
            workspaces: Array.isArray(registry) ? [] : [],
            activeWorkspaceId: null,
            settings: this.getDefaultSettings(),
            version: "1.0.0",
            updatedAt: new Date().toISOString(),
          } as IWorkspaceRegistry;
        }

        // Ensure workspaces is a valid array before any migration
        if (!Array.isArray(registry.workspaces)) {
          registry.workspaces = [];
        }

        // Ensure settings have defaults
        registry.settings = {
          ...this.getDefaultSettings(),
          ...registry.settings,
        };

        // Check and run migrations if needed
        if (this.migrationManager.needsMigration(registry)) {
          const result = this.migrationManager.migrate(registry);
          if (result.success) {
            console.log(
              `Registry migrated from v${result.fromVersion} to v${result.toVersion}`
            );
            // Save migrated registry
            fs.writeFileSync(
              this.registryPath,
              JSON.stringify(registry, null, 2)
            );
          } else {
            console.error("Registry migration failed:", result.error);
          }
        }

        return registry;
      } catch (error) {
        // Corrupted file, try to restore from backup
        if (this.backupManager) {
          console.warn("Registry file corrupted, attempting restore from backup");
          const restored = this.backupManager.restoreLatest();
          if (restored) {
            console.log("Registry restored from backup");
            return this.loadRegistry(); // Reload after restore
          }
        }
        // Start fresh if no backup available
        console.warn("Starting with fresh registry");
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

    const writeRegistry = () => {
      // Create backup before save if enabled
      if (this.backupManager) {
        try {
          this.backupManager.createBackup(this.registry);
        } catch (error) {
          console.warn("Failed to create backup:", error);
        }
      }

      fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2));
    };

    // Use file locking if enabled
    if (this.fileLock) {
      // For sync save, we need to run acquire/release around write
      // Use the async method internally with a sync wrapper
      this.fileLock
        .acquire({ timeout: this.options.lockTimeout })
        .then((acquired) => {
          if (acquired) {
            try {
              writeRegistry();
            } finally {
              this.fileLock?.release();
            }
          } else {
            // Fallback: write without lock (better than failing)
            console.warn("Could not acquire file lock, saving without lock");
            writeRegistry();
          }
        })
        .catch(() => {
          writeRegistry();
        });
    } else {
      writeRegistry();
    }
  }

  /**
   * Save registry with async file locking (recommended)
   */
  async saveAsync(): Promise<void> {
    this.registry.updatedAt = new Date().toISOString();

    const writeRegistry = async () => {
      // Create backup before save if enabled
      if (this.backupManager) {
        try {
          this.backupManager.createBackup(this.registry);
        } catch (error) {
          console.warn("Failed to create backup:", error);
        }
      }

      await fs.promises.writeFile(
        this.registryPath,
        JSON.stringify(this.registry, null, 2)
      );
    };

    // Use file locking if enabled
    if (this.fileLock) {
      await withFileLock(this.registryPath, writeRegistry, {
        timeout: this.options.lockTimeout,
      });
    } else {
      await writeRegistry();
    }
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
    return { ...DEFAULT_WORKSPACE_CONFIG };
  }

  private generateWorkspaceId(workspacePath: string): string {
    const hash = crypto.createHash("sha256").update(workspacePath).digest("hex").slice(0, 8);
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

export function getWorkspaceRegistry(storagePathOrOptions?: string | RegistryOptions): WorkspaceRegistry {
  if (!defaultRegistry || storagePathOrOptions) {
    defaultRegistry = new WorkspaceRegistry(storagePathOrOptions);
  }
  return defaultRegistry;
}

export function createWorkspaceRegistry(storagePathOrOptions?: string | RegistryOptions): WorkspaceRegistry {
  return new WorkspaceRegistry(storagePathOrOptions);
}

/**
 * Reset the default registry instance (for testing)
 */
export function resetDefaultRegistry(): void {
  defaultRegistry = null;
}

// Re-export utilities for direct access
export { FileLock, withFileLock } from "./file-lock";
export { RegistryBackupManager, type BackupInfo } from "./backup";
export {
  RegistryMigrationManager,
  CURRENT_REGISTRY_VERSION,
  type Migration,
  type MigrationResult,
} from "./migration";
export {
  WorkspaceValidator,
  ValidationCodes,
  type ValidationResult,
  type BatchValidationResult,
  type ValidationIssue,
  type ValidationWarning,
} from "./validator";
