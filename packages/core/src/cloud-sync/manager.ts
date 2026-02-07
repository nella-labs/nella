/**
 * Cloud Sync Compatibility Manager
 *
 * @deprecated Use `SyncManager.createCloudSync()` from `sync/manager.ts`.
 */

import type {
  CloudSyncConfig,
  SyncEvent,
  SyncStats,
  SyncState,
} from "./types";
import {
  createWorkspaceCloudSyncManager,
  type WorkspaceCloudSyncManager,
  type CloudObjectStorage,
} from "../sync/cloud";
import type { SyncConfig, CloudSyncOptions, SyncManagerEvent } from "../sync/types";

export type SyncEventHandler = (event: SyncEvent) => void;

function toCompatConfig(config: CloudSyncConfig): {
  syncConfig: SyncConfig;
  cloudOptions: Partial<CloudSyncOptions>;
} {
  const gcs = config.gcs || {
    bucketName: config.bucketName || "",
    projectId: config.projectId,
    keyFilename: config.keyFilename,
  };
  if (!gcs.bucketName) {
    throw new Error("Cloud sync config requires gcs.bucketName or bucketName");
  }

  return {
    syncConfig: {
      tier: "gcp",
      cloudStorageConfig: {
        bucket: gcs.bucketName,
        projectId: gcs.projectId,
        keyFilename: gcs.keyFilename,
        credentials: gcs.credentials,
        basePath: gcs.basePath,
      },
      cloudSync: {
        prefix: config.prefix,
        autoSyncInterval: config.autoSyncInterval,
        conflictResolution: config.conflictResolution,
        conflictStrategy: config.conflictStrategy,
        encryption: config.encryption,
        encryptionKey: config.encryptionKey,
        compression: config.compression,
        compressionLevel: config.compressionLevel,
        bandwidthLimitKBps: config.bandwidthLimitKBps,
        offlineQueueEnabled: config.offlineQueueEnabled,
        maxHistoryEntries: config.maxHistoryEntries,
        include: config.include,
        exclude: config.exclude,
        deltaChunkSizeKB: config.deltaChunkSizeKB,
        textDiffMaxBytes: config.textDiffMaxBytes,
        smallFileThresholdBytes: config.smallFileThresholdBytes,
      },
    },
    cloudOptions: {},
  };
}

function toLegacyEvent(event: SyncManagerEvent): SyncEvent | null {
  switch (event.type) {
    case "cloud-sync:started":
      return { type: "sync:started", workspaceId: event.workspaceId };
    case "cloud-sync:completed":
      return { type: "sync:completed", workspaceId: event.workspaceId, stats: event.stats };
    case "cloud-sync:error":
      return { type: "sync:error", workspaceId: event.workspaceId, error: event.error };
    case "cloud-sync:queued":
      return { type: "sync:queued", workspaceId: event.workspaceId, pending: event.pending };
    case "cloud-sync:history":
      return { type: "sync:history", workspaceId: event.workspaceId, entry: event.entry };
    case "cloud-sync:conflict":
      return { type: "sync:conflict", workspaceId: event.workspaceId, path: event.conflict.path };
    default:
      return null;
  }
}

export class CloudSyncManager {
  private readonly manager: WorkspaceCloudSyncManager;
  private readonly ready: Promise<void>;
  private handlers: SyncEventHandler[] = [];

  constructor(
    private readonly workspaceId: string,
    private readonly localPath: string,
    config: CloudSyncConfig,
    storage?: CloudObjectStorage
  ) {
    const { syncConfig, cloudOptions } = toCompatConfig(config);
    this.manager = createWorkspaceCloudSyncManager(
      workspaceId,
      localPath,
      syncConfig,
      cloudOptions,
      storage
    );
    this.manager.onEvent((event) => {
      const compat = toLegacyEvent(event);
      if (!compat) {
        return;
      }
      for (const handler of this.handlers) {
        handler(compat);
      }
    });
    this.ready = this.manager.init();
  }

  onEvent(handler: SyncEventHandler): void {
    this.handlers.push(handler);
  }

  async sync(): Promise<SyncStats> {
    await this.ready;
    return await this.manager.sync();
  }

  async push(): Promise<SyncStats> {
    await this.ready;
    return await this.manager.push();
  }

  async pull(): Promise<SyncStats> {
    await this.ready;
    return await this.manager.pull();
  }

  getStatus(): SyncState {
    return this.manager.getState();
  }

  async resolveConflict(
    filePath: string,
    resolution: "keep-local" | "keep-remote"
  ): Promise<void> {
    await this.ready;
    const state = this.manager.getState();
    const conflict = state.conflicts.find((c) => c.path === filePath && !c.resolvedAt);
    if (!conflict) {
      throw new Error(`No unresolved conflict found for ${filePath}`);
    }
    await this.manager.resolveConflict(
      conflict.id,
      resolution === "keep-local" ? "local-wins" : "remote-wins"
    );
  }

  startAutoSync(): void {
    // Backward compatibility no-op: auto sync is configured via autoSyncInterval.
  }

  stopAutoSync(): void {
    // Backward compatibility no-op: auto sync is configured via autoSyncInterval.
  }

  async destroy(): Promise<void> {
    await this.ready;
    await this.manager.destroy();
  }
}

/**
 * @deprecated Use `SyncManager.createCloudSync(...)` instead.
 */
export function createCloudSyncManager(
  workspaceId: string,
  localPath: string,
  config: CloudSyncConfig,
  storage?: CloudObjectStorage
): CloudSyncManager {
  return new CloudSyncManager(workspaceId, localPath, config, storage);
}
