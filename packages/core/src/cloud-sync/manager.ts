/**
 * Cloud Sync Manager
 *
 * Google Cloud Storage synchronization for nella data.
 * Uses Application Default Credentials or service account key.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type {
  CloudSyncConfig,
  SyncState,
  SyncFileState,
  SyncStats,
  SyncEvent,
  PendingChange,
  SyncError,
  FileSyncStatus,
} from "./types";
import { DEFAULT_SYNC_CONFIG } from "./types";

// =============================================================================
// Types
// =============================================================================

export type SyncEventHandler = (event: SyncEvent) => void;

interface GCSFile {
  name: string;
  metadata: {
    md5Hash?: string;
    updated?: string;
  };
}

// =============================================================================
// Cloud Sync Manager Class
// =============================================================================

export class CloudSyncManager {
  private config: CloudSyncConfig;
  private state: SyncState;
  private localPath: string;
  private statePath: string;
  private eventHandlers: SyncEventHandler[] = [];
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private isSyncing: boolean = false;

  constructor(workspaceId: string, localPath: string, config: Partial<CloudSyncConfig> & { projectId: string; bucketName: string }) {
    this.localPath = localPath;
    this.statePath = path.join(localPath, ".sync-state.json");
    
    this.config = {
      ...DEFAULT_SYNC_CONFIG,
      ...config,
    };

    this.state = this.loadState(workspaceId);

    // Start auto-sync if enabled
    if (this.config.autoSyncInterval > 0) {
      this.startAutoSync();
    }
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  onEvent(handler: SyncEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: SyncEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Sync event handler error:", error);
      }
    }
  }

  // =============================================================================
  // Sync Operations
  // =============================================================================

  /**
   * Perform full sync
   */
  async sync(): Promise<SyncStats> {
    if (this.isSyncing) {
      throw new Error("Sync already in progress");
    }

    this.isSyncing = true;
    this.state.status = "syncing";
    const startTime = Date.now();

    this.emit({ type: "sync:started", workspaceId: this.state.workspaceId });

    const stats: SyncStats = {
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      conflicts: 0,
      errors: 0,
      duration: 0,
    };

    try {
      // Get local files
      const localFiles = this.getLocalFiles();

      // Get remote files
      const remoteFiles = await this.listRemoteFiles();

      // Compare and determine actions
      const actions = this.determineActions(localFiles, remoteFiles);

      // Process uploads
      for (const file of actions.upload) {
        try {
          await this.uploadFile(file);
          stats.uploaded++;
          this.emit({ type: "file:uploaded", path: file });
        } catch (error) {
          stats.errors++;
          this.addError(file, error instanceof Error ? error.message : String(error));
        }
      }

      // Process downloads
      for (const file of actions.download) {
        try {
          await this.downloadFile(file);
          stats.downloaded++;
          this.emit({ type: "file:downloaded", path: file });
        } catch (error) {
          stats.errors++;
          this.addError(file, error instanceof Error ? error.message : String(error));
        }
      }

      // Process deletes
      for (const file of actions.delete) {
        try {
          await this.deleteRemoteFile(file);
          stats.deleted++;
          this.emit({ type: "file:deleted", path: file });
        } catch (error) {
          stats.errors++;
          this.addError(file, error instanceof Error ? error.message : String(error));
        }
      }

      // Handle conflicts
      stats.conflicts = actions.conflicts.length;
      for (const file of actions.conflicts) {
        this.emit({ type: "sync:conflict", workspaceId: this.state.workspaceId, path: file });
      }

      this.state.status = stats.conflicts > 0 ? "conflict" : "idle";
      this.state.lastSync = new Date().toISOString();
    } catch (error) {
      this.state.status = "error";
      stats.errors++;
      this.emit({
        type: "sync:error",
        workspaceId: this.state.workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isSyncing = false;
      stats.duration = Date.now() - startTime;
      this.saveState();
    }

    this.emit({ type: "sync:completed", workspaceId: this.state.workspaceId, stats });

    return stats;
  }

  /**
   * Push local changes only
   */
  async push(): Promise<SyncStats> {
    const localFiles = this.getLocalFiles();
    const stats: SyncStats = {
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      conflicts: 0,
      errors: 0,
      duration: 0,
    };

    const startTime = Date.now();

    for (const file of localFiles) {
      try {
        await this.uploadFile(file);
        stats.uploaded++;
      } catch (error) {
        stats.errors++;
      }
    }

    stats.duration = Date.now() - startTime;
    return stats;
  }

  /**
   * Pull remote changes only
   */
  async pull(): Promise<SyncStats> {
    const remoteFiles = await this.listRemoteFiles();
    const stats: SyncStats = {
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      conflicts: 0,
      errors: 0,
      duration: 0,
    };

    const startTime = Date.now();

    for (const file of remoteFiles) {
      try {
        await this.downloadFile(file.name);
        stats.downloaded++;
      } catch (error) {
        stats.errors++;
      }
    }

    stats.duration = Date.now() - startTime;
    return stats;
  }

  /**
   * Get sync status
   */
  getStatus(): SyncState {
    return { ...this.state };
  }

  /**
   * Resolve conflict
   */
  async resolveConflict(filePath: string, resolution: "keep-local" | "keep-remote"): Promise<void> {
    if (resolution === "keep-local") {
      await this.uploadFile(filePath);
    } else {
      await this.downloadFile(filePath);
    }

    // Update file state
    const fileState = this.state.files.find((f) => f.path === filePath);
    if (fileState) {
      fileState.status = "synced";
    }

    // Remove from conflicts
    this.state.pending = this.state.pending.filter((p) => p.path !== filePath);

    this.saveState();
  }

  // =============================================================================
  // Auto Sync
  // =============================================================================

  startAutoSync(): void {
    if (this.syncInterval) return;

    this.syncInterval = setInterval(
      () => this.sync().catch(console.error),
      this.config.autoSyncInterval * 1000
    );
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // =============================================================================
  // Private Methods - GCS Operations
  // =============================================================================

  /**
   * Upload file to GCS
   * Note: This is a mock implementation. Real implementation would use @google-cloud/storage
   */
  private async uploadFile(filePath: string): Promise<void> {
    const localFilePath = path.join(this.localPath, filePath);
    const remotePath = `${this.config.prefix}/${this.state.workspaceId}/${filePath}`;

    if (!fs.existsSync(localFilePath)) {
      throw new Error(`Local file not found: ${localFilePath}`);
    }

    let content = fs.readFileSync(localFilePath);

    // Encrypt if enabled
    if (this.config.encryption && this.config.encryptionKey) {
      content = this.encrypt(content);
    }

    // Mock GCS upload - in real implementation:
    // const storage = new Storage({ projectId: this.config.projectId, keyFilename: this.config.keyFilePath });
    // const bucket = storage.bucket(this.config.bucketName);
    // await bucket.file(remotePath).save(content);

    console.log(`[CloudSync] Would upload: ${localFilePath} -> gs://${this.config.bucketName}/${remotePath}`);

    // Update file state
    const hash = this.hashFile(localFilePath);
    this.updateFileState(filePath, {
      localHash: hash,
      remoteHash: hash,
      localModified: new Date().toISOString(),
      remoteModified: new Date().toISOString(),
      status: "synced",
    });
  }

  /**
   * Download file from GCS
   */
  private async downloadFile(filePath: string): Promise<void> {
    const localFilePath = path.join(this.localPath, filePath);
    const remotePath = `${this.config.prefix}/${this.state.workspaceId}/${filePath}`;

    // Ensure directory exists
    const dir = path.dirname(localFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Mock GCS download - in real implementation:
    // const storage = new Storage({ projectId: this.config.projectId, keyFilename: this.config.keyFilePath });
    // const bucket = storage.bucket(this.config.bucketName);
    // const [content] = await bucket.file(remotePath).download();

    console.log(`[CloudSync] Would download: gs://${this.config.bucketName}/${remotePath} -> ${localFilePath}`);

    // Update file state
    this.updateFileState(filePath, {
      status: "synced",
    });
  }

  /**
   * Delete remote file
   */
  private async deleteRemoteFile(filePath: string): Promise<void> {
    const remotePath = `${this.config.prefix}/${this.state.workspaceId}/${filePath}`;

    // Mock GCS delete - in real implementation:
    // const storage = new Storage({ projectId: this.config.projectId, keyFilename: this.config.keyFilePath });
    // const bucket = storage.bucket(this.config.bucketName);
    // await bucket.file(remotePath).delete();

    console.log(`[CloudSync] Would delete: gs://${this.config.bucketName}/${remotePath}`);

    // Remove from state
    this.state.files = this.state.files.filter((f) => f.path !== filePath);
  }

  /**
   * List remote files
   */
  private async listRemoteFiles(): Promise<GCSFile[]> {
    const prefix = `${this.config.prefix}/${this.state.workspaceId}/`;

    // Mock GCS list - in real implementation:
    // const storage = new Storage({ projectId: this.config.projectId, keyFilename: this.config.keyFilePath });
    // const bucket = storage.bucket(this.config.bucketName);
    // const [files] = await bucket.getFiles({ prefix });

    console.log(`[CloudSync] Would list: gs://${this.config.bucketName}/${prefix}`);

    // Return empty for mock
    return [];
  }

  // =============================================================================
  // Private Methods - Local Operations
  // =============================================================================

  private getLocalFiles(): string[] {
    const files: string[] = [];
    
    const walk = (dir: string, prefix: string = "") => {
      if (!fs.existsSync(dir)) return;
      
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        
        if (entry.isDirectory()) {
          // Skip excluded patterns
          if (!this.shouldInclude(relativePath)) continue;
          walk(path.join(dir, entry.name), relativePath);
        } else {
          if (this.shouldInclude(relativePath)) {
            files.push(relativePath);
          }
        }
      }
    };

    walk(this.localPath);
    return files;
  }

  private shouldInclude(filePath: string): boolean {
    // Check excludes first
    for (const pattern of this.config.exclude) {
      if (this.matchPattern(filePath, pattern)) {
        return false;
      }
    }

    // Check includes
    for (const pattern of this.config.include) {
      if (this.matchPattern(filePath, pattern)) {
        return true;
      }
    }

    return false;
  }

  private matchPattern(filePath: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\*\*/g, "§")
      .replace(/\*/g, "[^/]*")
      .replace(/§/g, ".*")
      .replace(/\?/g, ".");
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }

  private determineActions(localFiles: string[], remoteFiles: GCSFile[]): {
    upload: string[];
    download: string[];
    delete: string[];
    conflicts: string[];
  } {
    const actions = {
      upload: [] as string[],
      download: [] as string[],
      delete: [] as string[],
      conflicts: [] as string[],
    };

    const remoteFileMap = new Map(remoteFiles.map((f) => [f.name, f]));
    const localFileSet = new Set(localFiles);

    // Check local files
    for (const localFile of localFiles) {
      const remotePath = `${this.config.prefix}/${this.state.workspaceId}/${localFile}`;
      const remoteFile = remoteFileMap.get(remotePath);
      const fileState = this.state.files.find((f) => f.path === localFile);

      if (!remoteFile) {
        // Local only, upload
        actions.upload.push(localFile);
      } else {
        // Both exist, check for changes
        const localHash = this.hashFile(path.join(this.localPath, localFile));
        
        if (localHash !== fileState?.localHash && remoteFile.metadata.md5Hash !== fileState?.remoteHash) {
          // Both changed, conflict
          if (this.config.conflictStrategy === "manual") {
            actions.conflicts.push(localFile);
          } else if (this.config.conflictStrategy === "local-wins") {
            actions.upload.push(localFile);
          } else if (this.config.conflictStrategy === "remote-wins") {
            actions.download.push(localFile);
          } else {
            // newest-wins
            const localMod = fs.statSync(path.join(this.localPath, localFile)).mtime;
            const remoteMod = remoteFile.metadata.updated ? new Date(remoteFile.metadata.updated) : new Date(0);
            if (localMod > remoteMod) {
              actions.upload.push(localFile);
            } else {
              actions.download.push(localFile);
            }
          }
        } else if (localHash !== fileState?.localHash) {
          // Local changed only
          actions.upload.push(localFile);
        } else if (remoteFile.metadata.md5Hash !== fileState?.remoteHash) {
          // Remote changed only
          actions.download.push(localFile);
        }
      }
    }

    // Check remote files not in local
    for (const [remotePath, remoteFile] of remoteFileMap) {
      const prefix = `${this.config.prefix}/${this.state.workspaceId}/`;
      if (remotePath.startsWith(prefix)) {
        const localPath = remotePath.slice(prefix.length);
        if (!localFileSet.has(localPath)) {
          actions.download.push(localPath);
        }
      }
    }

    return actions;
  }

  // =============================================================================
  // Private Methods - Helpers
  // =============================================================================

  private loadState(workspaceId: string): SyncState {
    if (fs.existsSync(this.statePath)) {
      try {
        const content = fs.readFileSync(this.statePath, "utf-8");
        return JSON.parse(content);
      } catch {
        // Corrupted, start fresh
      }
    }

    return {
      workspaceId,
      lastSync: null,
      status: "idle",
      files: [],
      pending: [],
      errors: [],
    };
  }

  private saveState(): void {
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  private updateFileState(filePath: string, updates: Partial<SyncFileState>): void {
    const existing = this.state.files.find((f) => f.path === filePath);
    if (existing) {
      Object.assign(existing, updates);
    } else {
      this.state.files.push({
        path: filePath,
        localHash: null,
        remoteHash: null,
        localModified: null,
        remoteModified: null,
        status: "local-only",
        ...updates,
      });
    }
  }

  private addError(path: string, message: string): void {
    this.state.errors.push({
      id: `err_${Date.now()}`,
      path,
      message,
      code: "SYNC_ERROR",
      occurredAt: new Date().toISOString(),
      retryCount: 0,
    });

    // Keep only last 50 errors
    if (this.state.errors.length > 50) {
      this.state.errors = this.state.errors.slice(-50);
    }
  }

  private hashFile(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("md5").update(content).digest("hex");
  }

  private encrypt(data: Buffer): Buffer {
    if (!this.config.encryptionKey) {
      throw new Error("Encryption key required");
    }

    const key = crypto.scryptSync(this.config.encryptionKey, "nella-salt", 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Return: iv (16) + authTag (16) + encrypted
    return Buffer.concat([iv, authTag, encrypted]);
  }

  private decrypt(data: Buffer): Buffer {
    if (!this.config.encryptionKey) {
      throw new Error("Encryption key required");
    }

    const key = crypto.scryptSync(this.config.encryptionKey, "nella-salt", 32);
    const iv = data.subarray(0, 16);
    const authTag = data.subarray(16, 32);
    const encrypted = data.subarray(32);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.stopAutoSync();
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createCloudSyncManager(
  workspaceId: string,
  localPath: string,
  config: Partial<CloudSyncConfig> & { projectId: string; bucketName: string }
): CloudSyncManager {
  return new CloudSyncManager(workspaceId, localPath, config);
}
