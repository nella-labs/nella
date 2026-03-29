import { randomUUID, createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { gzipSync, gunzipSync } from "zlib";
import { mkdir, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type {
  CloudSyncConflict,
  CloudSyncMode,
  CloudSyncOptions,
  CloudSyncPendingChange,
  CloudSyncState,
  CloudSyncStats,
  SyncConfig,
  SyncManagerEvent,
  SyncManagerEventHandler,
} from "../types";
import { DEFAULT_CLOUD_SYNC_OPTIONS } from "../types";
import {
  downloadFile,
  fileExists,
  initCloudStorage,
  isCloudStorageInitialized,
  listFiles,
  uploadFile,
  deleteStorageFile,
} from "../../gcp";
import {
  computeLocalManifest,
  encodePathForObject,
  rebuildFromChunks,
  sha256,
  type FileManifest,
  type LocalManifestWithChunks,
} from "./delta";
import { collectWorkspaceFiles } from "./filters";
import { BandwidthThrottle } from "./throttle";
import { buildConflict } from "./conflicts";
import { CloudSyncStateStore } from "./state-store";

interface RemoteIndexEntry {
  manifestPath: string;
  fileHash: string;
  modifiedAt: string;
  size: number;
}

type RemoteIndex = Record<string, RemoteIndexEntry>;

export interface CloudObjectStorage {
  init(config: NonNullable<SyncConfig["cloudStorageConfig"]>): Promise<void>;
  isReady(): boolean;
  upload(path: string, data: Buffer, metadata?: Record<string, string>): Promise<void>;
  download(path: string): Promise<Buffer>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

class GCSObjectStorage implements CloudObjectStorage {
  private basePath: string;

  constructor(basePath: string = "") {
    this.basePath = basePath;
  }

  async init(config: NonNullable<SyncConfig["cloudStorageConfig"]>): Promise<void> {
    this.basePath = config.basePath || "";
    await initCloudStorage({
      bucket: config.bucket,
      projectId: config.projectId,
      keyFilename: config.keyFilename,
      credentials: config.credentials,
      basePath: this.basePath,
    });
  }

  isReady(): boolean {
    return isCloudStorageInitialized();
  }

  async upload(path: string, data: Buffer, metadata: Record<string, string> = {}): Promise<void> {
    await uploadFile(path, data, {
      contentType: "application/octet-stream",
      metadata,
    });
  }

  async download(path: string): Promise<Buffer> {
    return await downloadFile(path);
  }

  async exists(path: string): Promise<boolean> {
    return await fileExists(path);
  }

  async delete(path: string): Promise<void> {
    await deleteStorageFile(path);
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const result = await listFiles({
        prefix,
        pageToken,
      });
      out.push(...result.objects.map((o) => o.name));
      pageToken = result.nextPageToken;
    } while (pageToken);

    return out;
  }
}

function emptyStats(): CloudSyncStats {
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

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isTransientError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return (
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("socket hang up") ||
    message.includes("temporar") ||
    message.includes("429") ||
    message.includes("5xx")
  );
}

function mergeOptions(
  config: SyncConfig,
  overrides: Partial<CloudSyncOptions> | undefined
): CloudSyncOptions {
  return {
    ...DEFAULT_CLOUD_SYNC_OPTIONS,
    ...(config.cloudSync || {}),
    ...(overrides || {}),
    include: overrides?.include || config.cloudSync?.include || DEFAULT_CLOUD_SYNC_OPTIONS.include,
    exclude: overrides?.exclude || config.cloudSync?.exclude || DEFAULT_CLOUD_SYNC_OPTIONS.exclude,
  };
}

/**
 * Cloud sync manager for workspace files.
 */
export class WorkspaceCloudSyncManager {
  private readonly options: CloudSyncOptions;
  private readonly stateStore: CloudSyncStateStore;
  private readonly storage: CloudObjectStorage;
  private readonly throttle: BandwidthThrottle;
  private readonly handlers: Set<SyncManagerEventHandler> = new Set();
  private state: CloudSyncState;
  private initialized = false;
  private syncing = false;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly workspaceId: string,
    private readonly workspacePath: string,
    private readonly config: SyncConfig,
    options: Partial<CloudSyncOptions> = {},
    storage?: CloudObjectStorage,
    private readonly orgId?: string,
    private readonly projectId?: string
  ) {
    this.options = mergeOptions(config, options);
    this.storage = storage || new GCSObjectStorage(this.config.cloudStorageConfig?.basePath || "");
    this.throttle = new BandwidthThrottle(this.options.bandwidthLimitKBps);
    this.stateStore = new CloudSyncStateStore(workspaceId, workspacePath, {
      maxHistoryEntries: this.options.maxHistoryEntries,
    });
    this.state = {
      workspaceId,
      workspacePath,
      status: "idle",
      lastSync: null,
      files: [],
      pending: [],
      conflicts: [],
      history: [],
      errors: [],
      orgId,
      projectId,
    };
  }

  onEvent(handler: SyncManagerEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(event: SyncManagerEvent): void {
    this.handlers.forEach((handler) => handler(event));
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (!this.config.cloudStorageConfig) {
      throw new Error("cloudStorageConfig is required for cloud file sync");
    }

    await this.storage.init(this.config.cloudStorageConfig);
    this.state = await this.stateStore.load();
    this.initialized = true;

    if (this.options.autoSyncInterval > 0 && !this.interval) {
      this.interval = setInterval(() => {
        void this.sync().catch(() => {
          // keep interval alive
        });
      }, this.options.autoSyncInterval * 1000);
    }
  }

  async destroy(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    await this.persistState();
  }

  getState(): CloudSyncState {
    return cloneState(this.state);
  }

  async sync(): Promise<CloudSyncStats> {
    return this.run("sync");
  }

  async push(): Promise<CloudSyncStats> {
    return this.run("push");
  }

  async pull(): Promise<CloudSyncStats> {
    return this.run("pull");
  }

  async resolveConflict(
    conflictId: string,
    resolution: "local-wins" | "remote-wins"
  ): Promise<void> {
    await this.ensureInit();
    const conflict = this.state.conflicts.find((c) => c.id === conflictId);
    if (!conflict) {
      throw new Error(`Conflict ${conflictId} not found`);
    }
    if (conflict.resolvedAt) {
      return;
    }

    const remoteIndex = await this.loadRemoteIndex();
    const localManifests = new Map<string, LocalManifestWithChunks>();

    if (resolution === "local-wins") {
      await this.uploadPath(conflict.path, remoteIndex, localManifests);
    } else {
      await this.downloadPath(conflict.path, remoteIndex, localManifests);
    }

    conflict.resolvedAt = new Date().toISOString();
    conflict.resolution = resolution;
    this.state.status = this.state.conflicts.some((c) => !c.resolvedAt)
      ? "conflict"
      : "idle";
    await this.persistState();
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  private remoteRoot(): string {
    const prefix = this.options.prefix?.replace(/^\/+|\/+$/g, "") || "";
    return [prefix, this.orgId, this.projectId, this.workspaceId].filter(Boolean).join("/");
  }

  private indexPath(): string {
    return `${this.remoteRoot()}/meta/index.json`;
  }

  private manifestPath(relativePath: string): string {
    return `${this.remoteRoot()}/manifests/${encodePathForObject(relativePath)}.json`;
  }

  private chunkPath(hash: string): string {
    return `${this.remoteRoot()}/chunks/${hash}.bin`;
  }

  private async run(mode: CloudSyncMode): Promise<CloudSyncStats> {
    await this.ensureInit();
    if (this.syncing) {
      throw new Error("Cloud sync already in progress");
    }
    this.syncing = true;
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const stats = emptyStats();
    this.state.status = "syncing";

    this.emit({ type: "cloud-sync:started", workspaceId: this.workspaceId, mode });

    try {
      const remoteIndex = await this.loadRemoteIndex();
      const localFiles = await collectWorkspaceFiles(this.workspacePath, this.options);
      const localSet = new Set(localFiles);
      const localManifests = new Map<string, LocalManifestWithChunks>();

      await this.processPendingQueue(remoteIndex, localManifests, stats);

      const allPaths = new Set<string>([...localFiles, ...Object.keys(remoteIndex)]);
      for (const relativePath of Array.from(allPaths).sort()) {
        try {
          await this.processPath(
            relativePath,
            mode,
            localSet,
            remoteIndex,
            localManifests,
            stats
          );
        } catch (error) {
          if (this.options.offlineQueueEnabled && isTransientError(error)) {
            this.enqueuePending(relativePath, mode === "pull" ? "download" : "upload", error);
            stats.queued += 1;
            this.emit({
              type: "cloud-sync:queued",
              workspaceId: this.workspaceId,
              pending: this.state.pending.length,
            });
          } else {
            stats.errors += 1;
            this.state = this.stateStore.addError(
              this.state,
              relativePath,
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      }

      await this.processPendingQueue(remoteIndex, localManifests, stats);
      await this.saveRemoteIndex(remoteIndex);

      const unresolved = this.state.conflicts.some((c) => !c.resolvedAt);
      this.state.status = unresolved ? "conflict" : "idle";
      if (!unresolved) {
        this.state.lastSync = new Date().toISOString();
      }

      stats.duration = Date.now() - started;
      const entry = {
        id: randomUUID(),
        mode,
        startedAt,
        completedAt: new Date().toISOString(),
        status: unresolved ? ("conflict" as const) : ("success" as const),
        stats,
      };
      this.state = this.stateStore.addHistoryEntry(this.state, entry);

      this.emit({
        type: "cloud-sync:history",
        workspaceId: this.workspaceId,
        entry,
      });
      this.emit({
        type: "cloud-sync:completed",
        workspaceId: this.workspaceId,
        mode,
        stats,
      });
      await this.persistState();
      return stats;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.status = "error";
      stats.errors += 1;
      stats.duration = Date.now() - started;

      const entry = {
        id: randomUUID(),
        mode,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "error" as const,
        stats,
        error: message,
      };
      this.state = this.stateStore.addHistoryEntry(this.state, entry);
      this.state = this.stateStore.addError(this.state, ".", message);

      this.emit({
        type: "cloud-sync:error",
        workspaceId: this.workspaceId,
        mode,
        error: message,
      });
      this.emit({
        type: "cloud-sync:history",
        workspaceId: this.workspaceId,
        entry,
      });
      await this.persistState();
      throw error;
    } finally {
      this.syncing = false;
    }
  }

  private async processPath(
    relativePath: string,
    mode: CloudSyncMode,
    localSet: Set<string>,
    remoteIndex: RemoteIndex,
    localManifests: Map<string, LocalManifestWithChunks>,
    stats: CloudSyncStats
  ): Promise<void> {
    const localExists = localSet.has(relativePath);
    const remoteEntry = remoteIndex[relativePath];
    const localManifest = localExists
      ? await this.getLocalManifest(relativePath, localManifests)
      : null;
    const remoteManifest = remoteEntry
      ? await this.loadManifest(remoteEntry.manifestPath).catch(() => null)
      : null;

    const fileState = this.state.files.find((f) => f.path === relativePath);

    if (localManifest && !remoteManifest) {
      if (mode !== "pull") {
        await this.uploadPath(relativePath, remoteIndex, localManifests, stats);
      }
      return;
    }

    if (!localManifest && remoteManifest) {
      if (mode !== "push") {
        await this.downloadPath(relativePath, remoteIndex, localManifests, stats);
      }
      return;
    }

    if (!localManifest || !remoteManifest) {
      return;
    }

    const fileHashesEqual = localManifest.manifest.fileHash === remoteManifest.fileHash;
    if (fileHashesEqual) {
      this.updateFileState(relativePath, {
        status: "synced",
        localHash: localManifest.manifest.fileHash,
        remoteHash: remoteManifest.fileHash,
        localModified: localManifest.manifest.modifiedAt,
        remoteModified: remoteManifest.modifiedAt,
        lastSynced: new Date().toISOString(),
      });
      return;
    }

    const previousLocal = fileState?.localHash;
    const previousRemote = fileState?.remoteHash;
    const localChanged = previousLocal
      ? localManifest.manifest.fileHash !== previousLocal
      : !fileHashesEqual;
    const remoteChanged = previousRemote
      ? remoteManifest.fileHash !== previousRemote
      : !fileHashesEqual;

    if (localChanged && !remoteChanged) {
      if (mode !== "pull") {
        await this.uploadPath(relativePath, remoteIndex, localManifests, stats);
      }
      return;
    }

    if (!localChanged && remoteChanged) {
      if (mode !== "push") {
        await this.downloadPath(relativePath, remoteIndex, localManifests, stats);
      }
      return;
    }

    // Both changed: conflict strategy.
    const strategy = this.options.conflictStrategy || this.options.conflictResolution;
    if (strategy === "local-wins") {
      if (mode !== "pull") {
        await this.uploadPath(relativePath, remoteIndex, localManifests, stats);
      }
      return;
    }
    if (strategy === "remote-wins") {
      if (mode !== "push") {
        await this.downloadPath(relativePath, remoteIndex, localManifests, stats);
      }
      return;
    }
    if (strategy === "newest-wins") {
      const localTime = new Date(localManifest.manifest.modifiedAt).getTime();
      const remoteTime = new Date(remoteManifest.modifiedAt).getTime();
      if (localTime >= remoteTime) {
        if (mode !== "pull") {
          await this.uploadPath(relativePath, remoteIndex, localManifests, stats);
        }
      } else if (mode !== "push") {
        await this.downloadPath(relativePath, remoteIndex, localManifests, stats);
      }
      return;
    }

    const existing = this.state.conflicts.find(
      (c) =>
        c.path === relativePath &&
        !c.resolvedAt &&
        c.localHash === localManifest.manifest.fileHash &&
        c.remoteHash === remoteManifest.fileHash
    );
    if (!existing) {
      const conflict = buildConflict({
        path: relativePath,
        localHash: localManifest.manifest.fileHash,
        remoteHash: remoteManifest.fileHash,
        localModified: localManifest.manifest.modifiedAt,
        remoteModified: remoteManifest.modifiedAt,
        localBuffer: Buffer.concat(localManifest.chunks),
        remoteBuffer: await this.downloadManifestFile(remoteManifest),
        textDiffMaxBytes: this.options.textDiffMaxBytes || 262144,
      });
      this.state.conflicts.push(conflict);
      this.emit({
        type: "cloud-sync:conflict",
        workspaceId: this.workspaceId,
        conflict,
      });
      stats.conflicts += 1;
      this.state.status = "conflict";
    }
  }

  private async processPendingQueue(
    remoteIndex: RemoteIndex,
    localManifests: Map<string, LocalManifestWithChunks>,
    stats: CloudSyncStats
  ): Promise<void> {
    if (!this.options.offlineQueueEnabled || this.state.pending.length === 0) {
      return;
    }

    const remaining: CloudSyncPendingChange[] = [];
    for (const pending of this.state.pending) {
      try {
        if (pending.operation === "upload") {
          await this.uploadPath(pending.path, remoteIndex, localManifests, stats);
        } else if (pending.operation === "download") {
          await this.downloadPath(pending.path, remoteIndex, localManifests, stats);
        } else {
          await this.deletePath(pending.path, remoteIndex, stats);
        }
      } catch (error) {
        const attempts = pending.attempts + 1;
        const backoffSeconds = Math.min(300, 2 ** attempts);
        remaining.push({
          ...pending,
          attempts,
          lastError: error instanceof Error ? error.message : String(error),
          nextRetryAt: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
        });
      }
    }

    this.state.pending = remaining;
  }

  private enqueuePending(
    path: string,
    operation: "upload" | "download" | "delete",
    error: unknown
  ): void {
    const existing = this.state.pending.find(
      (p) => p.path === path && p.operation === operation
    );
    if (existing) {
      existing.attempts += 1;
      existing.lastError = error instanceof Error ? error.message : String(error);
      existing.nextRetryAt = new Date(Date.now() + Math.min(300, 2 ** existing.attempts) * 1000).toISOString();
      return;
    }
    this.state.pending.push({
      id: randomUUID(),
      path,
      operation,
      timestamp: new Date().toISOString(),
      attempts: 1,
      lastError: error instanceof Error ? error.message : String(error),
      nextRetryAt: new Date(Date.now() + 2000).toISOString(),
    });
  }

  private async getLocalManifest(
    relativePath: string,
    cache: Map<string, LocalManifestWithChunks>
  ): Promise<LocalManifestWithChunks> {
    const cached = cache.get(relativePath);
    if (cached) {
      return cached;
    }
    const absPath = join(this.workspacePath, relativePath);
    const manifest = await computeLocalManifest(
      absPath,
      relativePath,
      (this.options.deltaChunkSizeKB || 256) * 1024,
      this.options.smallFileThresholdBytes || 65536
    );
    cache.set(relativePath, manifest);
    return manifest;
  }

  private async loadRemoteIndex(): Promise<RemoteIndex> {
    const path = this.indexPath();
    const exists = await this.storage.exists(path);
    if (!exists) {
      return {};
    }
    const data = await this.storage.download(path);
    try {
      return JSON.parse(data.toString("utf-8")) as RemoteIndex;
    } catch {
      return {};
    }
  }

  private async saveRemoteIndex(index: RemoteIndex): Promise<void> {
    const path = this.indexPath();
    const data = Buffer.from(JSON.stringify(index, null, 2), "utf-8");
    await this.storage.upload(path, data, { contentType: "application/json" });
  }

  private async loadManifest(manifestPath: string): Promise<FileManifest> {
    const data = await this.storage.download(manifestPath);
    return JSON.parse(data.toString("utf-8")) as FileManifest;
  }

  private async uploadPath(
    relativePath: string,
    remoteIndex: RemoteIndex,
    localManifests: Map<string, LocalManifestWithChunks>,
    stats: CloudSyncStats = emptyStats()
  ): Promise<void> {
    const local = await this.getLocalManifest(relativePath, localManifests);
    const currentRemote = remoteIndex[relativePath]
      ? await this.loadManifest(remoteIndex[relativePath].manifestPath).catch(() => null)
      : null;
    const knownRemoteChunks = new Set((currentRemote?.chunks || []).map((chunk) => chunk.hash));

    for (let i = 0; i < local.manifest.chunks.length; i++) {
      const chunk = local.manifest.chunks[i];
      if (
        knownRemoteChunks.has(chunk.hash) ||
        (await this.storage.exists(this.chunkPath(chunk.hash)))
      ) {
        continue;
      }

      let payload = local.chunks[i];
      if (this.options.encryption && this.options.encryptionKey) {
        payload = this.encrypt(payload);
      }
      if (this.options.compression) {
        payload = gzipSync(payload, {
          level: this.options.compressionLevel ?? 6,
        });
      }

      await this.throttle.consume(payload.length);
      await this.storage.upload(
        this.chunkPath(chunk.hash),
        payload,
        {
          compressed: String(Boolean(this.options.compression)),
          compression: this.options.compression ? "gzip" : "none",
          encrypted: String(Boolean(this.options.encryption)),
          encryption: this.options.encryption ? "aes-256-gcm" : "none",
          hash: chunk.hash,
        }
      );
      stats.bytesUploaded += payload.length;
    }

    const manifest: FileManifest = {
      ...local.manifest,
      modifiedAt: new Date().toISOString(),
      compression: this.options.compression ? "gzip" : undefined,
      encryption: this.options.encryption ? "aes-256-gcm" : undefined,
    };
    const manifestPath = this.manifestPath(relativePath);
    await this.storage.upload(
      manifestPath,
      Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"),
      { contentType: "application/json" }
    );

    remoteIndex[relativePath] = {
      manifestPath,
      fileHash: manifest.fileHash,
      modifiedAt: manifest.modifiedAt,
      size: manifest.size,
    };

    stats.uploaded += 1;
    this.updateFileState(relativePath, {
      status: "synced",
      localHash: manifest.fileHash,
      remoteHash: manifest.fileHash,
      localModified: manifest.modifiedAt,
      remoteModified: manifest.modifiedAt,
      lastSynced: new Date().toISOString(),
    });
  }

  private async downloadPath(
    relativePath: string,
    remoteIndex: RemoteIndex,
    localManifests: Map<string, LocalManifestWithChunks>,
    stats: CloudSyncStats = emptyStats()
  ): Promise<void> {
    const entry = remoteIndex[relativePath];
    if (!entry) {
      return;
    }
    const manifest = await this.loadManifest(entry.manifestPath);
    const chunks: Buffer[] = [];

    for (const chunk of manifest.chunks) {
      const encoded = await this.storage.download(this.chunkPath(chunk.hash));
      await this.throttle.consume(encoded.length);
      stats.bytesDownloaded += encoded.length;

      let decoded = encoded;
      if (manifest.compression === "gzip") {
        decoded = gunzipSync(decoded);
      }
      if (manifest.encryption === "aes-256-gcm" && this.options.encryptionKey) {
        decoded = this.decrypt(decoded);
      }

      if (sha256(decoded) !== chunk.hash) {
        throw new Error(`Chunk hash mismatch for ${relativePath}#${chunk.index}`);
      }
      chunks.push(decoded);
    }

    const fileData = rebuildFromChunks(chunks);
    if (sha256(fileData) !== manifest.fileHash) {
      throw new Error(`File hash mismatch for ${relativePath}`);
    }

    const absPath = join(this.workspacePath, relativePath);
    await mkdir(dirname(absPath), { recursive: true });
    const tempPath = `${absPath}.nella.tmp`;
    await writeFile(tempPath, fileData);
    await rename(tempPath, absPath);

    localManifests.delete(relativePath);
    stats.downloaded += 1;
    this.updateFileState(relativePath, {
      status: "synced",
      localHash: manifest.fileHash,
      remoteHash: manifest.fileHash,
      localModified: new Date().toISOString(),
      remoteModified: manifest.modifiedAt,
      lastSynced: new Date().toISOString(),
    });
  }

  private async deletePath(
    relativePath: string,
    remoteIndex: RemoteIndex,
    stats: CloudSyncStats = emptyStats()
  ): Promise<void> {
    const entry = remoteIndex[relativePath];
    if (!entry) {
      return;
    }
    await this.storage.delete(entry.manifestPath);
    delete remoteIndex[relativePath];
    this.state.files = this.state.files.filter((f) => f.path !== relativePath);
    stats.deleted += 1;
  }

  private updateFileState(path: string, updates: Partial<CloudSyncState["files"][number]>): void {
    const existing = this.state.files.find((f) => f.path === path);
    if (existing) {
      Object.assign(existing, updates);
      return;
    }
    this.state.files.push({
      path,
      status: "local-only",
      ...updates,
    });
  }

  private async downloadManifestFile(manifest: FileManifest): Promise<Buffer | undefined> {
    try {
      const chunks: Buffer[] = [];
      for (const chunk of manifest.chunks) {
        let payload = await this.storage.download(this.chunkPath(chunk.hash));
        if (manifest.compression === "gzip") {
          payload = gunzipSync(payload);
        }
        if (manifest.encryption === "aes-256-gcm" && this.options.encryptionKey) {
          payload = this.decrypt(payload);
        }
        chunks.push(payload);
      }
      return rebuildFromChunks(chunks);
    } catch {
      return undefined;
    }
  }

  private encrypt(data: Buffer): Buffer {
    if (!this.options.encryptionKey) {
      return data;
    }
    const key = scryptSync(this.options.encryptionKey, "nella-cloud-sync", 32);
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]);
  }

  private decrypt(data: Buffer): Buffer {
    if (!this.options.encryptionKey) {
      return data;
    }
    const key = scryptSync(this.options.encryptionKey, "nella-cloud-sync", 32);
    const iv = data.subarray(0, 16);
    const authTag = data.subarray(16, 32);
    const encrypted = data.subarray(32);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  private async persistState(): Promise<void> {
    await this.stateStore.save(this.state);
  }
}

export function createWorkspaceCloudSyncManager(
  workspaceId: string,
  workspacePath: string,
  config: SyncConfig,
  options: Partial<CloudSyncOptions> = {},
  storage?: CloudObjectStorage,
  orgId?: string,
  projectId?: string
): WorkspaceCloudSyncManager {
  return new WorkspaceCloudSyncManager(
    workspaceId,
    workspacePath,
    config,
    options,
    storage,
    orgId,
    projectId
  );
}
