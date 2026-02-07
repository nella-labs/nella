/**
 * GCP Cloud Storage Module
 *
 * For storing:
 * - ONNX models
 * - Backups
 * - Large binary files
 */

import type {
  CloudStorageConfig,
  StorageObjectMeta,
  UploadOptions,
  DownloadOptions,
  ListOptions,
  ListResult,
  ModelInfo,
  BackupInfo,
  GCPEvent,
  GCPEventHandler,
} from "./types";

// ============================================================================
// Storage Manager
// ============================================================================

class CloudStorageManager {
  private storage: import("@google-cloud/storage").Storage | null = null;
  private bucket: import("@google-cloud/storage").Bucket | null = null;
  private config: CloudStorageConfig | null = null;
  private handlers: Set<GCPEventHandler> = new Set();

  /**
   * Initialize Cloud Storage
   */
  async init(config: CloudStorageConfig): Promise<void> {
    // Dynamic import to avoid bundling issues
    const { Storage } = await import("@google-cloud/storage");

    this.config = config;
    this.storage = new Storage({
      projectId: config.projectId,
      keyFilename: config.keyFilename,
      credentials: config.credentials,
    });

    this.bucket = this.storage.bucket(config.bucket);

    // Verify bucket access
    const [exists] = await this.bucket.exists();
    if (!exists) {
      throw new Error(`Bucket '${config.bucket}' does not exist or is not accessible`);
    }
  }

  /**
   * Get bucket instance
   */
  getBucket(): import("@google-cloud/storage").Bucket {
    if (!this.bucket) {
      throw new Error(
        "CloudStorage not initialized. Call init() first with configuration."
      );
    }
    return this.bucket;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.bucket !== null;
  }

  /**
   * Get base path
   */
  getBasePath(): string {
    return this.config?.basePath || "";
  }

  /**
   * Disconnect (cleanup)
   */
  disconnect(): void {
    this.storage = null;
    this.bucket = null;
    this.config = null;
  }

  /**
   * Subscribe to events
   */
  onEvent(handler: GCPEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(event: GCPEvent): void {
    this.handlers.forEach((h) => h(event));
  }

  /**
   * Resolve full path with base path
   */
  resolvePath(path: string): string {
    const base = this.getBasePath();
    return base ? `${base}/${path}`.replace(/\/+/g, "/") : path;
  }
}

// Singleton instance
export const cloudStorageManager = new CloudStorageManager();

// ============================================================================
// Initialization Functions
// ============================================================================

export async function initCloudStorage(config: CloudStorageConfig): Promise<void> {
  await cloudStorageManager.init(config);
}

export function isCloudStorageInitialized(): boolean {
  return cloudStorageManager.isInitialized();
}

export function disconnectCloudStorage(): void {
  cloudStorageManager.disconnect();
}

export function onCloudStorageEvent(handler: GCPEventHandler): () => void {
  return cloudStorageManager.onEvent(handler);
}

// ============================================================================
// Core Operations
// ============================================================================

/**
 * Upload a file or buffer to Cloud Storage
 */
export async function uploadFile(
  path: string,
  data: Buffer | string | NodeJS.ReadableStream,
  options: UploadOptions = {}
): Promise<StorageObjectMeta> {
  const bucket = cloudStorageManager.getBucket();
  const fullPath = cloudStorageManager.resolvePath(path);
  const file = bucket.file(fullPath);

  const size = Buffer.isBuffer(data)
    ? data.length
    : typeof data === "string"
      ? Buffer.byteLength(data)
      : 0;

  cloudStorageManager.emit({
    type: "storage:upload:start",
    path: fullPath,
    size,
  });

  try {
    if (Buffer.isBuffer(data) || typeof data === "string") {
      await file.save(data, {
        contentType: options.contentType,
        metadata: options.metadata,
        public: options.public,
        resumable: options.resumable ?? size > 5 * 1024 * 1024,
      });
    } else {
      // Stream upload
      await new Promise<void>((resolve, reject) => {
        const writeStream = file.createWriteStream({
          contentType: options.contentType,
          metadata: options.metadata,
          public: options.public,
          resumable: options.resumable ?? true,
        });

        data.pipe(writeStream);
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });
    }

    cloudStorageManager.emit({ type: "storage:upload:complete", path: fullPath });

    const [metadata] = await file.getMetadata();
    return parseMetadata(metadata);
  } catch (error) {
    cloudStorageManager.emit({
      type: "storage:upload:error",
      path: fullPath,
      error: error as Error,
    });
    throw error;
  }
}

/**
 * Download a file from Cloud Storage
 */
export async function downloadFile(
  path: string,
  options: DownloadOptions = {}
): Promise<Buffer> {
  const bucket = cloudStorageManager.getBucket();
  const fullPath = cloudStorageManager.resolvePath(path);
  const file = bucket.file(fullPath);

  cloudStorageManager.emit({ type: "storage:download:start", path: fullPath });

  try {
    const [data] = await file.download({
      decompress: options.decompress,
      validation: options.validation,
    });

    cloudStorageManager.emit({
      type: "storage:download:complete",
      path: fullPath,
      size: data.length,
    });

    return data;
  } catch (error) {
    cloudStorageManager.emit({
      type: "storage:download:error",
      path: fullPath,
      error: error as Error,
    });
    throw error;
  }
}

/**
 * Download file as stream
 */
export function downloadStream(
  path: string
): NodeJS.ReadableStream {
  const bucket = cloudStorageManager.getBucket();
  const fullPath = cloudStorageManager.resolvePath(path);
  return bucket.file(fullPath).createReadStream();
}

/**
 * Check if file exists
 */
export async function fileExists(path: string): Promise<boolean> {
  const bucket = cloudStorageManager.getBucket();
  const fullPath = cloudStorageManager.resolvePath(path);
  const [exists] = await bucket.file(fullPath).exists();
  return exists;
}

/**
 * Get file metadata
 */
export async function getFileMetadata(path: string): Promise<StorageObjectMeta> {
  const bucket = cloudStorageManager.getBucket();
  const fullPath = cloudStorageManager.resolvePath(path);
  const [metadata] = await bucket.file(fullPath).getMetadata();
  return parseMetadata(metadata);
}

/**
 * Delete a file
 */
export async function deleteFile(path: string): Promise<void> {
  const bucket = cloudStorageManager.getBucket();
  const fullPath = cloudStorageManager.resolvePath(path);
  await bucket.file(fullPath).delete();
}

/**
 * Copy a file
 */
export async function copyFile(
  sourcePath: string,
  destPath: string
): Promise<StorageObjectMeta> {
  const bucket = cloudStorageManager.getBucket();
  const sourceFullPath = cloudStorageManager.resolvePath(sourcePath);
  const destFullPath = cloudStorageManager.resolvePath(destPath);

  await bucket.file(sourceFullPath).copy(bucket.file(destFullPath));

  const [metadata] = await bucket.file(destFullPath).getMetadata();
  return parseMetadata(metadata);
}

/**
 * Move a file
 */
export async function moveFile(
  sourcePath: string,
  destPath: string
): Promise<StorageObjectMeta> {
  const bucket = cloudStorageManager.getBucket();
  const sourceFullPath = cloudStorageManager.resolvePath(sourcePath);
  const destFullPath = cloudStorageManager.resolvePath(destPath);

  await bucket.file(sourceFullPath).move(bucket.file(destFullPath));

  const [metadata] = await bucket.file(destFullPath).getMetadata();
  return parseMetadata(metadata);
}

/**
 * List files
 */
export async function listFiles(options: ListOptions = {}): Promise<ListResult> {
  const bucket = cloudStorageManager.getBucket();
  const basePath = cloudStorageManager.getBasePath();

  const prefix = options.prefix
    ? cloudStorageManager.resolvePath(options.prefix)
    : basePath;

  const [files, , apiResponse] = await bucket.getFiles({
    prefix: prefix || undefined,
    delimiter: options.delimiter,
    maxResults: options.maxResults,
    pageToken: options.pageToken,
  });

  return {
    objects: files.map((f: { metadata: unknown }) => parseMetadata(f.metadata)),
    prefixes: (apiResponse as { prefixes?: string[] })?.prefixes,
    nextPageToken: (apiResponse as { nextPageToken?: string })?.nextPageToken,
  };
}

// ============================================================================
// Model Operations
// ============================================================================

const MODELS_PREFIX = "models";

/**
 * Upload an ONNX model
 */
export async function uploadModel(
  name: string,
  version: string,
  data: Buffer,
  metadata: ModelInfo["metadata"]
): Promise<ModelInfo> {
  const path = `${MODELS_PREFIX}/${name}/${version}/model.onnx`;
  const checksum = await computeChecksum(data);

  await uploadFile(path, data, {
    contentType: "application/octet-stream",
    metadata: {
      name,
      version,
      checksum,
      ...Object.fromEntries(
        Object.entries(metadata).map(([k, v]) => [k, String(v)])
      ),
    },
  });

  const info: ModelInfo = {
    name,
    version,
    path,
    size: data.length,
    checksum,
    metadata,
    created_at: new Date(),
    updated_at: new Date(),
  };

  // Save model info JSON
  await uploadFile(
    `${MODELS_PREFIX}/${name}/${version}/info.json`,
    JSON.stringify(info, null, 2),
    { contentType: "application/json" }
  );

  return info;
}

/**
 * Download an ONNX model
 */
export async function downloadModel(
  name: string,
  version: string
): Promise<{ data: Buffer; info: ModelInfo }> {
  const modelPath = `${MODELS_PREFIX}/${name}/${version}/model.onnx`;
  const infoPath = `${MODELS_PREFIX}/${name}/${version}/info.json`;

  const [data, infoData] = await Promise.all([
    downloadFile(modelPath),
    downloadFile(infoPath),
  ]);

  const info = JSON.parse(infoData.toString()) as ModelInfo;

  return { data, info };
}

/**
 * List available models
 */
export async function listModels(): Promise<ModelInfo[]> {
  const { objects } = await listFiles({
    prefix: MODELS_PREFIX,
  });

  const infoFiles = objects.filter((o) => o.name.endsWith("/info.json"));
  const models: ModelInfo[] = [];

  for (const file of infoFiles) {
    try {
      const data = await downloadFile(file.name.replace(cloudStorageManager.getBasePath() + "/", ""));
      models.push(JSON.parse(data.toString()));
    } catch {
      // Skip invalid model info files
    }
  }

  return models;
}

/**
 * Delete a model version
 */
export async function deleteModel(name: string, version: string): Promise<void> {
  const prefix = `${MODELS_PREFIX}/${name}/${version}/`;
  const { objects } = await listFiles({ prefix });

  await Promise.all(
    objects.map((o) =>
      deleteFile(o.name.replace(cloudStorageManager.getBasePath() + "/", ""))
    )
  );
}

// ============================================================================
// Backup Operations
// ============================================================================

const BACKUPS_PREFIX = "backups";

/**
 * Create a workspace backup
 */
export async function createBackup(
  workspaceId: string,
  data: Buffer,
  metadata: BackupInfo["metadata"],
  type: "full" | "incremental" = "full"
): Promise<BackupInfo> {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${BACKUPS_PREFIX}/${workspaceId}/${timestamp}_${type}_${id}.tar.gz`;
  const checksum = await computeChecksum(data);

  await uploadFile(path, data, {
    contentType: "application/gzip",
    metadata: {
      workspace_id: workspaceId,
      backup_id: id,
      type,
      checksum,
    },
  });

  const info: BackupInfo = {
    id,
    workspace_id: workspaceId,
    type,
    size: data.length,
    path,
    checksum,
    created_at: new Date(),
    metadata,
  };

  // Save backup info JSON
  await uploadFile(
    `${BACKUPS_PREFIX}/${workspaceId}/${timestamp}_${type}_${id}.json`,
    JSON.stringify(info, null, 2),
    { contentType: "application/json" }
  );

  return info;
}

/**
 * Download a backup
 */
export async function downloadBackup(
  workspaceId: string,
  backupId: string
): Promise<{ data: Buffer; info: BackupInfo }> {
  // Find backup info file
  const { objects } = await listFiles({
    prefix: `${BACKUPS_PREFIX}/${workspaceId}/`,
  });

  const infoFile = objects.find(
    (o) => o.name.includes(backupId) && o.name.endsWith(".json")
  );

  if (!infoFile) {
    throw new Error(`Backup ${backupId} not found`);
  }

  const infoData = await downloadFile(
    infoFile.name.replace(cloudStorageManager.getBasePath() + "/", "")
  );
  const info = JSON.parse(infoData.toString()) as BackupInfo;

  const data = await downloadFile(info.path);

  return { data, info };
}

/**
 * List backups for a workspace
 */
export async function listBackups(workspaceId: string): Promise<BackupInfo[]> {
  const { objects } = await listFiles({
    prefix: `${BACKUPS_PREFIX}/${workspaceId}/`,
  });

  const infoFiles = objects.filter((o) => o.name.endsWith(".json"));
  const backups: BackupInfo[] = [];

  for (const file of infoFiles) {
    try {
      const data = await downloadFile(
        file.name.replace(cloudStorageManager.getBasePath() + "/", "")
      );
      backups.push(JSON.parse(data.toString()));
    } catch {
      // Skip invalid backup info files
    }
  }

  // Sort by created_at descending
  return backups.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/**
 * Delete a backup
 */
export async function deleteBackup(
  workspaceId: string,
  backupId: string
): Promise<void> {
  const { objects } = await listFiles({
    prefix: `${BACKUPS_PREFIX}/${workspaceId}/`,
  });

  const filesToDelete = objects.filter((o) => o.name.includes(backupId));

  await Promise.all(
    filesToDelete.map((o) =>
      deleteFile(o.name.replace(cloudStorageManager.getBasePath() + "/", ""))
    )
  );
}

/**
 * Cleanup old backups (keep N most recent)
 */
export async function cleanupBackups(
  workspaceId: string,
  keepCount: number = 5
): Promise<number> {
  const backups = await listBackups(workspaceId);

  if (backups.length <= keepCount) {
    return 0;
  }

  const toDelete = backups.slice(keepCount);
  await Promise.all(toDelete.map((b) => deleteBackup(workspaceId, b.id)));

  return toDelete.length;
}

// ============================================================================
// Helpers
// ============================================================================

function parseMetadata(metadata: unknown): StorageObjectMeta {
  const m = metadata as Record<string, unknown>;
  return {
    name: String(m.name || ""),
    bucket: String(m.bucket || ""),
    size: Number(m.size || 0),
    contentType: String(m.contentType || "application/octet-stream"),
    created: new Date(String(m.timeCreated || Date.now())),
    updated: new Date(String(m.updated || Date.now())),
    etag: String(m.etag || ""),
    md5Hash: m.md5Hash ? String(m.md5Hash) : undefined,
    metadata: m.metadata as Record<string, string> | undefined,
  };
}

async function computeChecksum(data: Buffer): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(data).digest("hex");
}
