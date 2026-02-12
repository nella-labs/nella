import test from "node:test";
import assert from "node:assert/strict";
import {
  RegistryMigrationManager,
  createMigrationManager,
  CURRENT_REGISTRY_VERSION,
} from "../migration";
import type { WorkspaceRegistry } from "../types";

// =============================================================================
// Helpers
// =============================================================================

function makeRegistry(
  version: string,
  overrides: Partial<WorkspaceRegistry> = {}
): WorkspaceRegistry {
  return {
    workspaces: [],
    activeWorkspaceId: null,
    settings: {
      maxWorkspaces: 50,
      autoCleanup: true,
      cleanupAfterDays: 30,
      globalStoragePath: "/tmp/nella",
    },
    version,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// =============================================================================
// Version Comparison (via needsMigration)
// =============================================================================

test("MigrationManager: needsMigration returns false for current version", () => {
  const mgr = createMigrationManager();
  const reg = makeRegistry(CURRENT_REGISTRY_VERSION);
  assert.equal(mgr.needsMigration(reg), false);
});

test("MigrationManager: needsMigration returns true for old version", () => {
  const mgr = createMigrationManager();
  const reg = makeRegistry("1.0.0");
  assert.equal(mgr.needsMigration(reg), true);
});

test("MigrationManager: needsMigration returns true for missing version", () => {
  const mgr = createMigrationManager();
  const reg = makeRegistry("");
  (reg as any).version = undefined;
  assert.equal(mgr.needsMigration(reg), true);
});

// =============================================================================
// getPendingMigrations
// =============================================================================

test("MigrationManager: getPendingMigrations from 1.0.0 returns all", () => {
  const mgr = createMigrationManager();
  const pending = mgr.getPendingMigrations("1.0.0");
  assert.ok(pending.length >= 4); // at least 1.1, 1.2, 1.3, 2.0
});

test("MigrationManager: getPendingMigrations from current returns empty", () => {
  const mgr = createMigrationManager();
  const pending = mgr.getPendingMigrations(CURRENT_REGISTRY_VERSION);
  assert.equal(pending.length, 0);
});

test("MigrationManager: getPendingMigrations from 1.2.0 skips earlier", () => {
  const mgr = createMigrationManager();
  const pending = mgr.getPendingMigrations("1.2.0");
  assert.ok(pending.every((m) => m.version > "1.2.0"));
});

// =============================================================================
// Migrate
// =============================================================================

test("MigrationManager: migrate from 1.0.0 to current succeeds", () => {
  const mgr = createMigrationManager();
  const reg = makeRegistry("1.0.0");

  const result = mgr.migrate(reg);
  assert.equal(result.success, true);
  assert.equal(result.fromVersion, "1.0.0");
  assert.equal(result.toVersion, CURRENT_REGISTRY_VERSION);
  assert.ok(result.migrationsApplied.length >= 4);
  assert.equal(reg.version, CURRENT_REGISTRY_VERSION);
});

test("MigrationManager: migrate is idempotent", () => {
  const mgr = createMigrationManager();
  const reg = makeRegistry(CURRENT_REGISTRY_VERSION);

  const result = mgr.migrate(reg);
  assert.equal(result.success, true);
  assert.equal(result.migrationsApplied.length, 0);
  assert.equal(reg.version, CURRENT_REGISTRY_VERSION);
});

test("MigrationManager: migrate adds workspace fields", () => {
  const mgr = createMigrationManager();
  const reg = makeRegistry("1.0.0", {
    workspaces: [
      {
        id: "ws-1",
        name: "test",
        path: "/test",
        createdAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
        indexStatus: "none" as any,
        stats: { files: 0, chunks: 0, lastIndexed: null } as any,
      } as any,
    ],
  });

  mgr.migrate(reg);

  const ws = reg.workspaces[0] as any;
  // v1.1.0 adds validated
  assert.equal(ws.validated, false);
  // v1.3.0 adds tags and metadata
  assert.deepEqual(ws.tags, []);
  assert.deepEqual(ws.metadata, {});
});

test("MigrationManager: migrate adds sync settings", () => {
  const mgr = createMigrationManager();
  const reg = makeRegistry("1.0.0");

  mgr.migrate(reg);

  const settings = reg.settings as any;
  // v1.2.0 adds sync settings
  assert.equal(settings.syncEnabled, false);
  assert.equal(settings.syncProvider, "local");
  // v2.0.0 adds sync tier
  assert.equal(settings.syncTier, "local");
});

// =============================================================================
// Validate
// =============================================================================

test("MigrationManager: validate accepts valid registry", () => {
  const mgr = createMigrationManager();
  const reg = makeRegistry(CURRENT_REGISTRY_VERSION);
  const result = mgr.validate(reg);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("MigrationManager: validate catches missing workspaces", () => {
  const mgr = createMigrationManager();
  const reg = { settings: {}, version: "1.0.0" } as any;
  const result = mgr.validate(reg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("workspaces")));
});

test("MigrationManager: validate catches missing settings", () => {
  const mgr = createMigrationManager();
  const reg = { workspaces: [], version: "1.0.0" } as any;
  const result = mgr.validate(reg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("settings")));
});

test("MigrationManager: validate catches workspace missing required fields", () => {
  const mgr = createMigrationManager();
  const reg = makeRegistry("2.0.0", {
    workspaces: [{ id: "ws-1" } as any],
  });

  const result = mgr.validate(reg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("name")));
  assert.ok(result.errors.some((e) => e.includes("path")));
});

// =============================================================================
// Utility
// =============================================================================

test("MigrationManager: getCurrentVersion", () => {
  const mgr = createMigrationManager();
  assert.equal(mgr.getCurrentVersion(), CURRENT_REGISTRY_VERSION);
});

test("MigrationManager: getAllMigrations returns copies", () => {
  const mgr = createMigrationManager();
  const migs = mgr.getAllMigrations();
  assert.ok(migs.length >= 4);
  assert.ok(migs[0].version);
  assert.ok(migs[0].description);
});
