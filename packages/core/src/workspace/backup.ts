/**
 * Registry Backup Manager
 *
 * Automatic backup and restore for workspace registry.
 * Maintains rolling backups to prevent data loss.
 */

import * as fs from "fs";
import * as path from "path";
import type { WorkspaceRegistry } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface BackupOptions {
  /** Maximum number of backups to keep (default: 5) */
  maxBackups?: number;
  /** Backup directory (default: ~/.nella/backups) */
  backupDir?: string;
}

export interface BackupInfo {
  filename: string;
  path: string;
  timestamp: Date;
  size: number;
  version: string;
}

// =============================================================================
// Backup Manager Class
// =============================================================================

export class RegistryBackupManager {
  private backupDir: string;
  private maxBackups: number;

  constructor(storagePath: string, options: BackupOptions = {}) {
    this.backupDir = options.backupDir || path.join(storagePath, "backups");
    this.maxBackups = options.maxBackups ?? 5;

    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Create a backup of the registry
   */
  createBackup(registry: WorkspaceRegistry, label?: string): BackupInfo {
    const timestamp = new Date();
    const formattedDate = this.formatDate(timestamp);
    const suffix = label ? `_${label}` : "";
    const filename = `registry_${formattedDate}${suffix}.json`;
    const backupPath = path.join(this.backupDir, filename);

    // Create backup with metadata
    const backupData = {
      _backup: {
        timestamp: timestamp.toISOString(),
        label,
        originalVersion: registry.version,
      },
      ...registry,
    };

    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));

    // Cleanup old backups
    this.cleanupOldBackups();

    return {
      filename,
      path: backupPath,
      timestamp,
      size: fs.statSync(backupPath).size,
      version: registry.version,
    };
  }

  /**
   * Create backup before a risky operation
   */
  createPreOperationBackup(registry: WorkspaceRegistry, operation: string): BackupInfo {
    return this.createBackup(registry, `pre_${operation}`);
  }

  /**
   * List all available backups
   */
  listBackups(): BackupInfo[] {
    if (!fs.existsSync(this.backupDir)) {
      return [];
    }

    const files = fs.readdirSync(this.backupDir);
    const backups: BackupInfo[] = [];

    for (const file of files) {
      if (!file.startsWith("registry_") || !file.endsWith(".json")) {
        continue;
      }

      const filePath = path.join(this.backupDir, file);
      const stats = fs.statSync(filePath);

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(content);

        backups.push({
          filename: file,
          path: filePath,
          timestamp: new Date(data._backup?.timestamp || stats.mtime),
          size: stats.size,
          version: data.version || "unknown",
        });
      } catch {
        // Skip corrupted backup files
      }
    }

    // Sort by timestamp descending (newest first)
    return backups.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * Restore registry from backup
   * @param backupPath - Path to the backup file
   * @param targetPath - Optional target path to write restored data
   * @returns The restored registry data
   */
  restoreFromBackup(backupPath: string, targetPath?: string): WorkspaceRegistry {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupPath}`);
    }

    const content = fs.readFileSync(backupPath, "utf-8");
    const data = JSON.parse(content);

    // Remove backup metadata
    delete data._backup;

    // Write to target if specified
    if (targetPath) {
      fs.writeFileSync(targetPath, JSON.stringify(data, null, 2));
    }

    return data as WorkspaceRegistry;
  }

  /**
   * Restore from most recent backup
   * @param targetPath - Optional target path to write restored data
   */
  restoreLatest(targetPath?: string): WorkspaceRegistry | null {
    const backups = this.listBackups();
    if (backups.length === 0) {
      return null;
    }

    return this.restoreFromBackup(backups[0].path, targetPath);
  }

  /**
   * Delete a specific backup
   */
  deleteBackup(backupPath: string): boolean {
    try {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Delete all backups
   */
  deleteAllBackups(): number {
    const backups = this.listBackups();
    let deleted = 0;

    for (const backup of backups) {
      if (this.deleteBackup(backup.path)) {
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Get backup directory path
   */
  getBackupDir(): string {
    return this.backupDir;
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private cleanupOldBackups(): void {
    const backups = this.listBackups();

    // Keep only maxBackups newest
    if (backups.length > this.maxBackups) {
      const toDelete = backups.slice(this.maxBackups);
      for (const backup of toDelete) {
        this.deleteBackup(backup.path);
      }
    }
  }

  private formatDate(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      "_",
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join("");
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createBackupManager(
  storagePath: string,
  options?: BackupOptions
): RegistryBackupManager {
  return new RegistryBackupManager(storagePath, options);
}
