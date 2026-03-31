/**
 * Branch Cloud Sync
 *
 * Syncs branch index overlays to/from cloud storage.
 * Only uploads overlay data for feature branches (not full parent index),
 * keeping cloud storage efficient.
 *
 * Cloud path: {prefix}/{orgId}/{projectId}/{workspaceId}/branches/{branchName}/
 */

import * as fs from "fs";
import * as path from "path";
import type { CloudSyncStats } from "../types";
import type { BranchIndexManager } from "../../indexing/branch-manager";

// =============================================================================
// Types
// =============================================================================

export interface BranchCloudSyncConfig {
  /** Workspace ID */
  workspaceId: string;
  /** Local workspace path */
  workspacePath: string;
  /** Base remote path (workspace root in cloud) */
  remoteBasePath: string;
  /** Cloud storage interface */
  storage: CloudObjectStorage;
}

export interface CloudObjectStorage {
  /** Upload a file to cloud storage */
  upload(remotePath: string, data: Buffer): Promise<void>;
  /** Download a file from cloud storage */
  download(remotePath: string): Promise<Buffer>;
  /** Delete a file from cloud storage */
  delete(remotePath: string): Promise<void>;
  /** List files under a prefix */
  list(prefix: string): Promise<string[]>;
  /** Check if a file exists */
  exists(remotePath: string): Promise<boolean>;
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
   * Push a branch's index overlay to cloud storage.
   */
  async pushBranchIndex(
    branch: string,
    localBranchPath: string,
  ): Promise<CloudSyncStats> {
    const remotePath = this.branchRemotePath(branch);
    const stats = this.emptyStats();
    const startTime = Date.now();

    // Collect local overlay files
    if (!fs.existsSync(localBranchPath)) {
      return stats;
    }

    const files = this.collectFiles(localBranchPath);

    for (const file of files) {
      const data = fs.readFileSync(path.join(localBranchPath, file));
      const remote = `${remotePath}/${file}`;
      await this.config.storage.upload(remote, data);
      stats.uploaded++;
      stats.bytesUploaded += data.length;
    }

    stats.duration = Date.now() - startTime;
    return stats;
  }

  /**
   * Pull a branch's index overlay from cloud storage.
   */
  async pullBranchIndex(
    branch: string,
    localBranchPath: string,
  ): Promise<CloudSyncStats> {
    const remotePath = this.branchRemotePath(branch);
    const stats = this.emptyStats();
    const startTime = Date.now();

    // List remote files
    const remoteFiles = await this.config.storage.list(remotePath);

    if (!fs.existsSync(localBranchPath)) {
      fs.mkdirSync(localBranchPath, { recursive: true });
    }

    for (const remote of remoteFiles) {
      const relativePath = remote.slice(remotePath.length + 1);
      if (!relativePath) continue;

      const data = await this.config.storage.download(remote);
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
   * Delete a branch's cloud index (after merge).
   */
  async deleteBranchCloudIndex(branch: string): Promise<void> {
    const remotePath = this.branchRemotePath(branch);
    const files = await this.config.storage.list(remotePath);

    for (const file of files) {
      await this.config.storage.delete(file);
    }
  }

  /**
   * List branches that have cloud indexes.
   */
  async listCloudBranches(): Promise<string[]> {
    const prefix = `${this.config.remoteBasePath}/branches/`;
    const files = await this.config.storage.list(prefix);

    // Extract unique branch names from file paths
    const branches = new Set<string>();
    for (const file of files) {
      const relative = file.slice(prefix.length);
      const branchName = relative.split("/")[0];
      if (branchName) branches.add(branchName);
    }

    return [...branches];
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private branchRemotePath(branch: string): string {
    const sanitized = branch.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${this.config.remoteBasePath}/branches/${sanitized}`;
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
