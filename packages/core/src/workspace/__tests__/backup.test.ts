import test from "node:test";
import assert from "node:assert/strict";
import { RegistryBackupManager, createBackupManager } from "../backup";
import { tempDir } from "../../__tests__/helpers";
import type { WorkspaceRegistry } from "../types";

// =============================================================================
// Helpers
// =============================================================================

function sampleRegistry(overrides: Partial<WorkspaceRegistry> = {}): WorkspaceRegistry {
  return {
    workspaces: [],
    activeWorkspaceId: null,
    settings: {
      maxWorkspaces: 50,
      autoCleanup: true,
      cleanupAfterDays: 30,
      globalStoragePath: "",
    },
    version: "1.0.0",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// =============================================================================
// Create Backup
// =============================================================================

test("BackupManager: createBackup creates a backup file", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = new RegistryBackupManager(dir);
    const registry = sampleRegistry();
    const info = mgr.createBackup(registry);

    assert.ok(info.filename.startsWith("registry_"));
    assert.ok(info.filename.endsWith(".json"));
    assert.ok(info.size > 0);
    assert.equal(info.version, "1.0.0");
  } finally {
    await cleanup();
  }
});

test("BackupManager: createBackup with label includes label in filename", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = new RegistryBackupManager(dir);
    const info = mgr.createBackup(sampleRegistry(), "pre_delete");
    assert.ok(info.filename.includes("pre_delete"));
  } finally {
    await cleanup();
  }
});

test("BackupManager: createPreOperationBackup adds operation label", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = new RegistryBackupManager(dir);
    const info = mgr.createPreOperationBackup(sampleRegistry(), "remove");
    assert.ok(info.filename.includes("pre_remove"));
  } finally {
    await cleanup();
  }
});

// =============================================================================
// List Backups
// =============================================================================

test("BackupManager: listBackups returns sorted (newest first)", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = new RegistryBackupManager(dir, { maxBackups: 10 });

    mgr.createBackup(sampleRegistry(), "first");
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 50));
    mgr.createBackup(sampleRegistry(), "second");

    const backups = mgr.listBackups();
    assert.equal(backups.length, 2);
    assert.ok(backups[0].timestamp.getTime() >= backups[1].timestamp.getTime());
  } finally {
    await cleanup();
  }
});

test("BackupManager: listBackups returns empty when no backups", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = new RegistryBackupManager(dir);
    assert.deepEqual(mgr.listBackups(), []);
  } finally {
    await cleanup();
  }
});

// =============================================================================
// Cleanup
// =============================================================================

test("BackupManager: auto-cleans old backups beyond maxBackups", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = new RegistryBackupManager(dir, { maxBackups: 2 });

    mgr.createBackup(sampleRegistry(), "a");
    await new Promise((r) => setTimeout(r, 30));
    mgr.createBackup(sampleRegistry(), "b");
    await new Promise((r) => setTimeout(r, 30));
    mgr.createBackup(sampleRegistry(), "c"); // should trigger cleanup

    const backups = mgr.listBackups();
    assert.ok(backups.length <= 2, `expected <=2, got ${backups.length}`);
  } finally {
    await cleanup();
  }
});

// =============================================================================
// Restore
// =============================================================================

test("BackupManager: restoreFromBackup returns registry data", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = new RegistryBackupManager(dir);
    const original = sampleRegistry({ version: "2.0.0" });
    const info = mgr.createBackup(original);

    const restored = mgr.restoreFromBackup(info.path);
    assert.equal(restored.version, "2.0.0");
    assert.ok(Array.isArray(restored.workspaces));
    // _backup metadata should be stripped
    assert.equal((restored as any)._backup, undefined);
  } finally {
    await cleanup();
  }
});

test("BackupManager: restoreFromBackup throws for non-existent path", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = new RegistryBackupManager(dir);
    assert.throws(
      () => mgr.restoreFromBackup("/nonexistent/backup.json"),
      /Backup not found/
    );
  } finally {
    await cleanup();
  }
});

test("BackupManager: restoreLatest restores most recent backup", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = new RegistryBackupManager(dir, { maxBackups: 10 });

    mgr.createBackup(sampleRegistry({ version: "1.0.0" }));
    await new Promise((r) => setTimeout(r, 50));
    mgr.createBackup(sampleRegistry({ version: "2.0.0" }));

    const restored = mgr.restoreLatest();
    assert.ok(restored);
    assert.equal(restored!.version, "2.0.0");
  } finally {
    await cleanup();
  }
});

test("BackupManager: restoreLatest returns null when no backups", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = new RegistryBackupManager(dir);
    assert.equal(mgr.restoreLatest(), null);
  } finally {
    await cleanup();
  }
});

// =============================================================================
// Delete
// =============================================================================

test("BackupManager: deleteBackup removes specific backup", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = new RegistryBackupManager(dir, { maxBackups: 10 });
    const info = mgr.createBackup(sampleRegistry());

    assert.equal(mgr.deleteBackup(info.path), true);
    assert.deepEqual(mgr.listBackups(), []);
  } finally {
    await cleanup();
  }
});

test("BackupManager: deleteBackup returns false for non-existent", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = new RegistryBackupManager(dir);
    assert.equal(mgr.deleteBackup("/nonexistent.json"), false);
  } finally {
    await cleanup();
  }
});

test("BackupManager: deleteAllBackups removes everything", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = new RegistryBackupManager(dir, { maxBackups: 10 });
    mgr.createBackup(sampleRegistry());
    await new Promise((r) => setTimeout(r, 30));
    mgr.createBackup(sampleRegistry());

    const beforeCount = mgr.listBackups().length;
    const deleted = mgr.deleteAllBackups();
    assert.equal(deleted, beforeCount);
    assert.deepEqual(mgr.listBackups(), []);
  } finally {
    await cleanup();
  }
});

// =============================================================================
// Factory
// =============================================================================

test("createBackupManager: creates instance", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = createBackupManager(dir, { maxBackups: 3 });
    assert.ok(mgr instanceof RegistryBackupManager);
  } finally {
    await cleanup();
  }
});

test("BackupManager: getBackupDir returns the backup directory", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const mgr = new RegistryBackupManager(dir);
    assert.ok(mgr.getBackupDir().includes("backups"));
  } finally {
    await cleanup();
  }
});
