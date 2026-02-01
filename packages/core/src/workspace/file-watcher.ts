/**
 * File Watcher
 *
 * Watches workspace for file changes and triggers re-indexing.
 * Uses debouncing to batch rapid changes.
 */

import * as fs from "fs";
import * as path from "path";
import { minimatch } from "minimatch";

// =============================================================================
// Types
// =============================================================================

export interface WatcherOptions {
  /** Debounce delay in ms (default: 1000) */
  debounceMs?: number;
  /** Include patterns for files to watch */
  include?: string[];
  /** Exclude patterns for files to ignore */
  exclude?: string[];
  /** Max depth to watch (default: 10) */
  maxDepth?: number;
  /** Ignore hidden files (default: true) */
  ignoreHidden?: boolean;
}

export interface FileChangeEvent {
  type: "add" | "change" | "delete";
  filePath: string;
  relativePath: string;
}

export interface BatchChangeEvent {
  changes: FileChangeEvent[];
  timestamp: Date;
}

export type ChangeHandler = (event: BatchChangeEvent) => void | Promise<void>;

// =============================================================================
// File Watcher Class
// =============================================================================

export class FileWatcher {
  private workspacePath: string;
  private options: Required<WatcherOptions>;
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private pendingChanges: FileChangeEvent[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private changeHandlers: ChangeHandler[] = [];
  private running = false;

  constructor(workspacePath: string, options: WatcherOptions = {}) {
    this.workspacePath = path.resolve(workspacePath);
    this.options = {
      debounceMs: options.debounceMs ?? 1000,
      include: options.include ?? ["**/*"],
      exclude: options.exclude ?? ["**/node_modules/**", "**/.git/**", "**/dist/**"],
      maxDepth: options.maxDepth ?? 10,
      ignoreHidden: options.ignoreHidden ?? true,
    };
  }

  /**
   * Start watching for changes
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.watchDirectory(this.workspacePath, 0);
  }

  /**
   * Stop watching
   */
  stop(): void {
    this.running = false;

    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Close all watchers
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();

    // Clear pending changes
    this.pendingChanges = [];
  }

  /**
   * Register change handler
   */
  onChange(handler: ChangeHandler): void {
    this.changeHandlers.push(handler);
  }

  /**
   * Check if watcher is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get watch statistics
   */
  getStats(): { watchedDirectories: number; pendingChanges: number } {
    return {
      watchedDirectories: this.watchers.size,
      pendingChanges: this.pendingChanges.length,
    };
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private watchDirectory(dirPath: string, depth: number): void {
    if (!this.running) return;
    if (depth > this.options.maxDepth) return;
    if (this.watchers.has(dirPath)) return;

    // Check if directory should be excluded
    const relativePath = path.relative(this.workspacePath, dirPath);
    if (this.shouldExclude(relativePath, true)) return;

    try {
      const watcher = fs.watch(dirPath, { persistent: true }, (eventType, filename) => {
        if (!filename) return;

        const fullPath = path.join(dirPath, filename);
        const relPath = path.relative(this.workspacePath, fullPath);

        // Check if file should be processed
        if (!this.shouldProcess(relPath)) return;

        // Determine event type
        let changeType: FileChangeEvent["type"];
        const exists = fs.existsSync(fullPath);

        if (eventType === "rename") {
          changeType = exists ? "add" : "delete";
          
          // If a new directory is added, watch it
          if (exists && fs.statSync(fullPath).isDirectory()) {
            this.watchDirectory(fullPath, depth + 1);
          }
        } else {
          changeType = "change";
        }

        // Add to pending changes
        this.addChange({
          type: changeType,
          filePath: fullPath,
          relativePath: relPath,
        });
      });

      watcher.on("error", (error) => {
        console.warn(`Watcher error for ${dirPath}:`, error);
        this.watchers.delete(dirPath);
      });

      this.watchers.set(dirPath, watcher);

      // Watch subdirectories
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subDir = path.join(dirPath, entry.name);
          this.watchDirectory(subDir, depth + 1);
        }
      }
    } catch (error) {
      console.warn(`Failed to watch directory ${dirPath}:`, error);
    }
  }

  private addChange(change: FileChangeEvent): void {
    // Deduplicate by path (keep latest)
    this.pendingChanges = this.pendingChanges.filter(
      (c) => c.filePath !== change.filePath
    );
    this.pendingChanges.push(change);

    // Reset debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flushChanges();
    }, this.options.debounceMs);
  }

  private flushChanges(): void {
    if (this.pendingChanges.length === 0) return;

    const event: BatchChangeEvent = {
      changes: [...this.pendingChanges],
      timestamp: new Date(),
    };

    this.pendingChanges = [];

    // Notify handlers
    for (const handler of this.changeHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Change handler error:", error);
      }
    }
  }

  private shouldProcess(relativePath: string): boolean {
    // Check hidden files
    if (this.options.ignoreHidden && this.isHidden(relativePath)) {
      return false;
    }

    // Check excludes first
    if (this.shouldExclude(relativePath, false)) {
      return false;
    }

    // Check includes
    return this.shouldInclude(relativePath);
  }

  private shouldInclude(relativePath: string): boolean {
    // Normalize path separators
    const normalizedPath = relativePath.replace(/\\/g, "/");

    for (const pattern of this.options.include) {
      if (minimatch(normalizedPath, pattern, { dot: true })) {
        return true;
      }
    }
    return false;
  }

  private shouldExclude(relativePath: string, isDirectory: boolean): boolean {
    // Normalize path separators
    let normalizedPath = relativePath.replace(/\\/g, "/");
    if (isDirectory && !normalizedPath.endsWith("/")) {
      normalizedPath += "/";
    }

    for (const pattern of this.options.exclude) {
      if (minimatch(normalizedPath, pattern, { dot: true })) {
        return true;
      }
    }
    return false;
  }

  private isHidden(relativePath: string): boolean {
    const parts = relativePath.split(/[/\\]/);
    return parts.some((part) => part.startsWith(".") && part !== ".");
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createFileWatcher(
  workspacePath: string,
  options?: WatcherOptions
): FileWatcher {
  return new FileWatcher(workspacePath, options);
}
