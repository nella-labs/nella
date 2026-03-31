/**
 * Branch Cloud Sync
 *
 * Syncs branch index overlays to/from GCP Cloud Storage.
 * Only uploads overlay data for feature branches (not full parent index),
 * keeping cloud storage efficient.
 *
 * Cloud path: {basePath}/branches/{branchName}/
 * Uses the GCS storage module directly (uploadFile, downloadFile, etc.)
 */

import * as fs from "fs";
import * as path from "path";
import type { CloudSyncStats } from "../types";
import {
  uploadFile,
  downloadFile,
  deleteFile as deleteStorageFile,
  listFiles,
  fileExists,
  isCloudStorageInitialized,
} from "../../gcp/storage";

// =============================================================================
// Types
// =============================================================================

export interface BranchCloudSyncConfig {
  /** Workspace ID */
  workspaceId: string;
  /** Local workspace path */
  workspacePath: string;
  /**
   * Base path prefix in GCS bucket.
   * Typically: {orgId}/{projectId}/{workspaceId}
   */
  remoteBasePath: string;
}

// =============================================================================
// Branch Cloud Sync
// =============================================================================

export class BranchCloudSync {
  private config: BranchCloudSyncConfig;

  constructor(config: BranchCloudSyncConfig) {
    this.config = config;
  }

  /**
   * Push a branch's index overlay to GCP Cloud Storage.
   */
  async pushBranchIndex(
    branch: string,
    localBranchPath: string,
  ): Promise<CloudSyncStats> {
    this.ensureInitialized();
    const remotePath = this.branchRemotePath(branch);
    const stats = this.emptyStats();
    const startTime = Date.now();

    if (!fs.existsSync(localBranchPath)) {
      return stats;
    }

    const localFiles = this.collectFiles(localBranchPath);

    for (const file of localFiles) {
      const data = fs.readFileSync(path.join(localBranchPath, file));
      const remote = `${remotePath}/${file}`;
      await uploadFile(remote, data, {
        contentType: file.endsWith(".json") ? "application/json" : "application/octet-stream",
        metadata: {
          workspaceId: this.config.workspaceId,
          branch,
          syncedAt: new Date().toISOString(),
        },
      });
      stats.uploaded++;
      stats.bytesUploaded += data.length;
    }

    stats.duration = Date.now() - startTime;
    return stats;
  }

  /**
   * Pull a branch's index overlay from GCP Cloud Storage.
   */
  async pullBranchIndex(
    branch: string,
    localBranchPath: string,
  ): Promise<CloudSyncStats> {
    this.ensureInitialized();
    const remotePath = this.branchRemotePath(branch);
    const stats = this.emptyStats();
    const startTime = Date.now();

    const result = await listFiles({ prefix: remotePath });

    if (!fs.existsSync(localBranchPath)) {
      fs.mkdirSync(localBranchPath, { recursive: true });
    }

    for (const fileInfo of result.objects) {
      const relativePath = fileInfo.name.slice(remotePath.length + 1);
      if (!relativePath) continue;

      const data = await downloadFile(fileInfo.name);
      const localPath = path.join(localBranchPath, relativePath);

      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(localPath, data);
      stats.downloaded++;
      stats.bytesDownloaded += data.length;
    }

    stats.duration = Date.now() - startTime;
    return stats;
  }

  /**
   * Sync branch index bidirectionally.
   * Pushes local changes, pulls remote changes.
   */
  async syncBranchIndex(
    branch: string,
    localBranchPath: string,
  ): Promise<CloudSyncStats> {
    const pushStats = await this.pushBranchIndex(branch, localBranchPath);
    const pullStats = await this.pullBranchIndex(branch, localBranchPath);

    return {
      uploaded: pushStats.uploaded,
      downloaded: pullStats.downloaded,
      deleted: 0,
      queued: 0,
      conflicts: 0,
      errors: pushStats.errors + pullStats.errors,
      bytesUploaded: pushStats.bytesUploaded,
      bytesDownloaded: pullStats.bytesDownloaded,
      duration: pushStats.duration + pullStats.duration,
    };
  }

  /**
   * Delete a branch's cloud index (after merge).
   */
  async deleteBranchCloudIndex(branch: string): Promise<void> {
    this.ensureInitialized();
    const remotePath = this.branchRemotePath(branch);
    const result = await listFiles({ prefix: remotePath });

    for (const fileInfo of result.objects) {
      await deleteStorageFile(fileInfo.name);
    }
  }

  /**
   * List branches that have cloud indexes.
   */
  async listCloudBranches(): Promise<string[]> {
    this.ensureInitialized();
    const prefix = `${this.config.remoteBasePath}/branches/`;
    const result = await listFiles({ prefix });

    const branches = new Set<string>();
    for (const fileInfo of result.objects) {
      const relative = fileInfo.name.slice(prefix.length);
      const branchName = relative.split("/")[0];
      if (branchName) branches.add(branchName);
    }

    return [...branches];
  }

  /**
   * Check if a branch has a cloud index.
   */
  async hasBranchCloudIndex(branch: string): Promise<boolean> {
    this.ensureInitialized();
    const remotePath = `${this.branchRemotePath(branch)}/parent-ref.json`;
    return fileExists(remotePath);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private branchRemotePath(branch: string): string {
    const sanitized = branch.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${this.config.remoteBasePath}/branches/${sanitized}`;
  }

  private ensureInitialized(): void {
    if (!isCloudStorageInitialized()) {
      throw new Error("GCP Cloud Storage not initialized. Call initCloudStorage() first.");
    }
  }

  private collectFiles(dir: string, base = ""): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relative = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...this.collectFiles(path.join(dir, entry.name), relative));
      } else {
        files.push(relative);
      }
    }

    return files;
  }

  private emptyStats(): CloudSyncStats {
    return {
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      queued: 0,
      conflicts: 0,
      errors: 0,
      bytesUploaded: 0,
      bytesDownloaded: 0,
      duration: 0,
    };
  }
}
