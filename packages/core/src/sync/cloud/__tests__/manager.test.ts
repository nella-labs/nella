import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import {
  createWorkspaceCloudSyncManager,
  type CloudObjectStorage,
} from "../manager";
import { BandwidthThrottle } from "../throttle";
import { sha256 } from "../delta";
import type { SyncConfig } from "../../types";
import { createCloudSyncManager } from "../../../cloud-sync/manager";

class FakeStorage implements CloudObjectStorage {
  readonly objects = new Map<string, Buffer>();
  readonly uploads: Array<{ path: string; metadata: Record<string, string> }> = [];
  readonly initConfigs: Array<NonNullable<SyncConfig["cloudStorageConfig"]>> = [];
  private initialized = false;
  private failNextUploads = 0;

  setFailNextUploads(count: number): void {
    this.failNextUploads = count;
  }

  async init(config: NonNullable<SyncConfig["cloudStorageConfig"]>): Promise<void> {
    this.initConfigs.push(config);
    this.initialized = true;
  }

  isReady(): boolean {
    return this.initialized;
  }

  async upload(path: string, data: Buffer, metadata: Record<string, string> = {}): Promise<void> {
    if (this.failNextUploads > 0) {
      this.failNextUploads -= 1;
      throw new Error("ETIMEDOUT simulated network failure");
    }
    this.objects.set(path, Buffer.from(data));
    this.uploads.push({ path, metadata });
  }

  async download(path: string): Promise<Buffer> {
    const found = this.objects.get(path);
    if (!found) {
      throw new Error(`NotFound: ${path}`);
    }
    return Buffer.from(found);
  }

  async exists(path: string): Promise<boolean> {
    return this.objects.has(path);
  }

  async delete(path: string): Promise<void> {
    this.objects.delete(path);
  }

  async list(prefix: string): Promise<string[]> {
    return Array.from(this.objects.keys()).filter((key) => key.startsWith(prefix));
  }
}

async function tempWorkspace(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "nella-sync-test-"));
}

async function writeWorkspaceFile(
  workspacePath: string,
  relativePath: string,
  content: string
): Promise<void> {
  const abs = join(workspacePath, relativePath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf-8");
}

function baseConfig(overrides: Partial<SyncConfig> = {}): SyncConfig {
  return {
    tier: "gcp",
    cloudStorageConfig: {
      bucket: "test-bucket",
    },
    ...overrides,
  };
}

async function createManager(
  workspaceId: string,
  workspacePath: string,
  storage: FakeStorage,
  configOverrides: Partial<SyncConfig> = {},
  options: Record<string, unknown> = {}
) {
  const manager = createWorkspaceCloudSyncManager(
    workspaceId,
    workspacePath,
    baseConfig(configOverrides),
    options,
    storage
  );
  await manager.init();
  return manager;
}

function chunkObjectPath(workspaceId: string, hash: string): string {
  return `${workspaceId}/chunks/${hash}.bin`;
}

function manifestObjectPath(workspaceId: string, relativePath: string): string {
  return `${workspaceId}/manifests/${encodeURIComponent(relativePath)}.json`;
}

function indexObjectPath(workspaceId: string): string {
  return `${workspaceId}/meta/index.json`;
}

async function setRemoteFile(
  storage: FakeStorage,
  workspaceId: string,
  relativePath: string,
  content: string
): Promise<void> {
  const buffer = Buffer.from(content, "utf-8");
  const fileHash = sha256(buffer);
  const manifestPath = manifestObjectPath(workspaceId, relativePath);
  const chunkPath = chunkObjectPath(workspaceId, fileHash);
  const manifest = {
    path: relativePath,
    fileHash,
    size: buffer.length,
    modifiedAt: new Date().toISOString(),
    isBinary: false,
    chunks: [
      {
        index: 0,
        hash: fileHash,
        size: buffer.length,
      },
    ],
  };
  storage.objects.set(chunkPath, buffer);
  storage.objects.set(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"));

  const indexPath = indexObjectPath(workspaceId);
  let index: Record<string, unknown> = {};
  if (storage.objects.has(indexPath)) {
    index = JSON.parse(storage.objects.get(indexPath)!.toString("utf-8")) as Record<string, unknown>;
  }
  index[relativePath] = {
    manifestPath,
    fileHash,
    modifiedAt: new Date().toISOString(),
    size: buffer.length,
  };
  storage.objects.set(indexPath, Buffer.from(JSON.stringify(index, null, 2), "utf-8"));
}

test("GCS config accepts ADC, keyfile, and inline credential modes", async () => {
  const workspacePath = await tempWorkspace();

  const adc = new FakeStorage();
  const m1 = await createManager("ws-auth-1", workspacePath, adc, {
    cloudStorageConfig: { bucket: "b1" },
  });
  assert.equal(adc.initConfigs[0].bucket, "b1");
  assert.equal(adc.initConfigs[0].keyFilename, undefined);
  assert.equal(adc.initConfigs[0].credentials, undefined);
  await m1.destroy();

  const keyfile = new FakeStorage();
  const m2 = await createManager("ws-auth-2", workspacePath, keyfile, {
    cloudStorageConfig: { bucket: "b2", keyFilename: "/tmp/key.json" },
  });
  assert.equal(keyfile.initConfigs[0].keyFilename, "/tmp/key.json");
  await m2.destroy();

  const creds = new FakeStorage();
  const m3 = await createManager("ws-auth-3", workspacePath, creds, {
    cloudStorageConfig: {
      bucket: "b3",
      credentials: { client_email: "x@test", private_key: "abc" },
    },
  });
  assert.equal(typeof creds.initConfigs[0].credentials, "object");
  await m3.destroy();
});

test("full sync uploads files to empty remote", async () => {
  const storage = new FakeStorage();
  const workspacePath = await tempWorkspace();
  await writeWorkspaceFile(workspacePath, "src/a.ts", "export const a = 1;\n");
  await writeWorkspaceFile(workspacePath, "src/b.ts", "export const b = 2;\n");

  const manager = await createManager("ws-full", workspacePath, storage);
  const stats = await manager.sync();
  assert.equal(stats.uploaded, 2);

  const indexData = storage.objects.get(indexObjectPath("ws-full"));
  assert.ok(indexData);
  const index = JSON.parse(indexData!.toString("utf-8")) as Record<string, unknown>;
  assert.equal(Object.keys(index).length, 2);
  await manager.destroy();
});

test("delta sync uploads only changed chunk hashes", async () => {
  const storage = new FakeStorage();
  const workspacePath = await tempWorkspace();
  const content = `${"a".repeat(1024)}${"b".repeat(1024)}${"c".repeat(1024)}`;
  await writeWorkspaceFile(workspacePath, "big.txt", content);

  const manager = await createManager(
    "ws-delta",
    workspacePath,
    storage,
    {},
    {
      deltaChunkSizeKB: 1,
      smallFileThresholdBytes: 1,
      include: ["**/*"],
      exclude: ["**/.nella/**", "**/.sync-state.json"],
    }
  );
  await manager.sync();
  storage.uploads.length = 0;

  const changed = `${"a".repeat(1024)}${"z".repeat(1024)}${"c".repeat(1024)}`;
  await writeWorkspaceFile(workspacePath, "big.txt", changed);
  await manager.sync();

  const chunkUploads = storage.uploads.filter((u) => u.path.includes("/chunks/"));
  assert.equal(chunkUploads.length, 1);
  await manager.destroy();
});

test("compression mode round-trips file content", async () => {
  const storage = new FakeStorage();
  const workspacePath = await tempWorkspace();
  const filePath = "src/compress.ts";
  const content = "line 1\nline 2\nline 3\n";
  await writeWorkspaceFile(workspacePath, filePath, content);

  const manager = await createManager(
    "ws-compress",
    workspacePath,
    storage,
    {},
    { compression: true, include: ["**/*"], exclude: [] }
  );
  await manager.sync();

  await unlink(join(workspacePath, filePath));
  await manager.pull();
  const restored = await readFile(join(workspacePath, filePath), "utf-8");
  assert.equal(restored, content);
  await manager.destroy();
});

test("bandwidth throttle enforces lower-bound transfer time", async () => {
  const throttle = new BandwidthThrottle(10); // 10KB/s
  const started = Date.now();
  await throttle.consume(20 * 1024);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 900);
});

test("offline queue retries transient failures", async () => {
  const storage = new FakeStorage();
  storage.setFailNextUploads(1);
  const workspacePath = await tempWorkspace();
  await writeWorkspaceFile(workspacePath, "src/offline.ts", "export const x = 1;\n");

  const manager = await createManager("ws-offline", workspacePath, storage);
  const first = await manager.sync();
  assert.ok(first.queued >= 1);

  const second = await manager.sync();
  assert.equal(second.errors, 0);
  assert.equal(manager.getState().pending.length, 0);
  await manager.destroy();
});

test("conflict detection and resolution supports local and remote wins", async () => {
  const storage = new FakeStorage();
  const workspacePath = await tempWorkspace();
  await writeWorkspaceFile(workspacePath, "src/conflict.ts", "base\n");
  const manager = await createManager("ws-conflict", workspacePath, storage);

  await manager.sync();
  await writeWorkspaceFile(workspacePath, "src/conflict.ts", "local change\n");
  await setRemoteFile(storage, "ws-conflict", "src/conflict.ts", "remote change\n");

  await manager.sync();
  const conflict = manager.getState().conflicts.find((c) => !c.resolvedAt);
  assert.ok(conflict);

  await manager.resolveConflict(conflict!.id, "local-wins");
  const afterLocal = manager.getState().conflicts.find((c) => c.id === conflict!.id);
  assert.ok(afterLocal?.resolvedAt);

  await writeWorkspaceFile(workspacePath, "src/conflict.ts", "second local\n");
  await setRemoteFile(storage, "ws-conflict", "src/conflict.ts", "second remote\n");
  await manager.sync();
  const conflict2 = manager.getState().conflicts.find((c) => !c.resolvedAt);
  assert.ok(conflict2);
  await manager.resolveConflict(conflict2!.id, "remote-wins");
  const localText = await readFile(join(workspacePath, "src/conflict.ts"), "utf-8");
  assert.equal(localText, "second remote\n");
  await manager.destroy();
});

test("sync history is capped by maxHistoryEntries", async () => {
  const storage = new FakeStorage();
  const workspacePath = await tempWorkspace();
  await writeWorkspaceFile(workspacePath, "src/history.ts", "v1\n");

  const manager = await createManager(
    "ws-history",
    workspacePath,
    storage,
    {},
    { maxHistoryEntries: 2, include: ["**/*"], exclude: [] }
  );

  await manager.sync();
  await writeWorkspaceFile(workspacePath, "src/history.ts", "v2\n");
  await manager.sync();
  await writeWorkspaceFile(workspacePath, "src/history.ts", "v3\n");
  await manager.sync();

  assert.equal(manager.getState().history.length, 2);
  await manager.destroy();
});

test("selective sync respects include/exclude and .nella-syncignore", async () => {
  const storage = new FakeStorage();
  const workspacePath = await tempWorkspace();
  await writeWorkspaceFile(workspacePath, ".nella-syncignore", "src/ignored.ts\n");
  await writeWorkspaceFile(workspacePath, "src/keep.ts", "export const keep = true;\n");
  await writeWorkspaceFile(workspacePath, "src/ignored.ts", "ignored\n");
  await writeWorkspaceFile(workspacePath, "skip/nope.ts", "nope\n");

  const manager = await createManager(
    "ws-filter",
    workspacePath,
    storage,
    {},
    { include: ["**/*.ts"], exclude: ["skip/**"] }
  );
  await manager.sync();
  const index = JSON.parse(
    storage.objects.get(indexObjectPath("ws-filter"))!.toString("utf-8")
  ) as Record<string, unknown>;
  assert.deepEqual(Object.keys(index), ["src/keep.ts"]);
  await manager.destroy();
});

test("legacy createCloudSyncManager remains functional as wrapper", async () => {
  const storage = new FakeStorage();
  const workspacePath = await tempWorkspace();
  await writeWorkspaceFile(workspacePath, "src/legacy.ts", "legacy\n");

  const legacy = createCloudSyncManager(
    "ws-legacy",
    workspacePath,
    {
      gcs: { bucketName: "bucket" },
      autoSyncInterval: 0,
      conflictResolution: "manual",
      include: ["**/*"],
      exclude: [],
    },
    storage
  );

  const syncStats = await legacy.sync();
  assert.equal(syncStats.uploaded, 1);
  const pushStats = await legacy.push();
  assert.ok(pushStats.uploaded >= 0);
  const pullStats = await legacy.pull();
  assert.ok(pullStats.downloaded >= 0);
  assert.equal(legacy.getStatus().workspaceId, "ws-legacy");
  await legacy.destroy();
});

test("state migration from legacy .sync-state.json to canonical path", async () => {
  const storage = new FakeStorage();
  const workspacePath = await tempWorkspace();
  const legacyState = {
    workspaceId: "ws-migrate",
    status: "idle",
    lastSync: null,
    files: [],
    pending: [],
    errors: [],
  };
  await writeWorkspaceFile(workspacePath, ".sync-state.json", JSON.stringify(legacyState, null, 2));

  const manager = await createManager("ws-migrate", workspacePath, storage);
  const canonical = join(workspacePath, ".nella/sync/ws-migrate/state.json");
  assert.equal(existsSync(canonical), true);
  const stateFile = JSON.parse((await readFile(canonical, "utf-8"))) as { workspaceId: string };
  assert.equal(stateFile.workspaceId, "ws-migrate");
  await manager.destroy();
});
