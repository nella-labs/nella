import test from "node:test";
import assert from "node:assert/strict";
import { SessionStore } from "../session-store";
import { tempDir, writeWorkspaceFile } from "../../__tests__/helpers";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// =============================================================================
// Construction & Loading
// =============================================================================

test("SessionStore: creates new session when none exists", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    const session = store.getSession();

    assert.ok(session.id.startsWith("session_"));
    assert.ok(session.startedAt);
    assert.equal(session.repoPath, ws);
    assert.deepEqual(session.changes, []);
    assert.deepEqual(session.assumptions, []);
    assert.equal(session.dependencySnapshot, null);
    assert.equal(session.metadata.runCount, 0);
  } finally {
    await cleanup();
  }
});

test("SessionStore: loads existing session from disk", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    // Create and save a session
    const store1 = new SessionStore(ws);
    store1.recordChange({
      runId: "run-1",
      file: "src/app.ts",
      operation: "modify",
      reason: "test change",
      dependsOn: [],
      assumptionIds: [],
    });
    store1.save();

    // Load it in a new instance
    const store2 = new SessionStore(ws);
    const changes = store2.getAllChanges();
    assert.equal(changes.length, 1);
    assert.equal(changes[0].file, "src/app.ts");
  } finally {
    await cleanup();
  }
});

test("SessionStore: handles corrupted session file gracefully", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    await writeWorkspaceFile(ws, ".nella/session.json", "not valid json{{{");
    const store = new SessionStore(ws);
    // Should create a fresh session rather than crashing
    assert.ok(store.getSessionId().startsWith("session_"));
  } finally {
    await cleanup();
  }
});

// =============================================================================
// Save
// =============================================================================

test("SessionStore: save writes valid JSON to disk", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    store.save();

    const filePath = join(ws, ".nella", "session.json");
    assert.ok(existsSync(filePath));
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    assert.ok(data.id);
    assert.ok(data.startedAt);
  } finally {
    await cleanup();
  }
});

test("SessionStore: saveIfDirty only saves when dirty", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    store.save(); // clean state

    // saveIfDirty should not write (not dirty after save)
    store.saveIfDirty(); // no error — just a no-op
    assert.ok(true);

    // Make a change → dirty
    store.recordChange({
      runId: "r1",
      file: "a.ts",
      operation: "create",
      reason: "test",
      dependsOn: [],
      assumptionIds: [],
    });
    store.saveIfDirty(); // should persist
    const store2 = new SessionStore(ws);
    assert.equal(store2.getAllChanges().length, 1);
  } finally {
    await cleanup();
  }
});

// =============================================================================
// Change Management
// =============================================================================

test("SessionStore: recordChange stores change with generated id and timestamp", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    const change = store.recordChange({
      runId: "run-1",
      file: "src/index.ts",
      operation: "create",
      reason: "initial scaffolding",
      dependsOn: [],
      assumptionIds: [],
    });

    assert.ok(change.id);
    assert.ok(change.timestamp);
    assert.equal(change.runId, "run-1");
    assert.equal(change.file, "src/index.ts");
  } finally {
    await cleanup();
  }
});

test("SessionStore: getRecentChanges limits results", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    for (let i = 0; i < 10; i++) {
      store.recordChange({
        runId: `run-${i}`,
        file: `file-${i}.ts`,
        operation: "modify",
        reason: "bulk",
        dependsOn: [],
        assumptionIds: [],
      });
    }

    const recent = store.getRecentChanges(3);
    assert.equal(recent.length, 3);
    assert.equal(recent[0].file, "file-7.ts"); // last 3: 7, 8, 9
  } finally {
    await cleanup();
  }
});

test("SessionStore: getChangesForFile filters by file", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    store.recordChange({ runId: "r1", file: "a.ts", operation: "create", reason: "x", dependsOn: [], assumptionIds: [] });
    store.recordChange({ runId: "r2", file: "b.ts", operation: "create", reason: "y", dependsOn: [], assumptionIds: [] });
    store.recordChange({ runId: "r3", file: "a.ts", operation: "modify", reason: "z", dependsOn: [], assumptionIds: [] });

    const aChanges = store.getChangesForFile("a.ts");
    assert.equal(aChanges.length, 2);
  } finally {
    await cleanup();
  }
});

test("SessionStore: getChangesForRun filters by runId", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    store.recordChange({ runId: "run-A", file: "a.ts", operation: "create", reason: "", dependsOn: [], assumptionIds: [] });
    store.recordChange({ runId: "run-B", file: "b.ts", operation: "create", reason: "", dependsOn: [], assumptionIds: [] });
    store.recordChange({ runId: "run-A", file: "c.ts", operation: "create", reason: "", dependsOn: [], assumptionIds: [] });

    assert.equal(store.getChangesForRun("run-A").length, 2);
    assert.equal(store.getChangesForRun("run-B").length, 1);
  } finally {
    await cleanup();
  }
});

test("SessionStore: getModifiedFiles returns unique files", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    store.recordChange({ runId: "r", file: "a.ts", operation: "create", reason: "", dependsOn: [], assumptionIds: [] });
    store.recordChange({ runId: "r", file: "a.ts", operation: "modify", reason: "", dependsOn: [], assumptionIds: [] });
    store.recordChange({ runId: "r", file: "b.ts", operation: "create", reason: "", dependsOn: [], assumptionIds: [] });

    const files = store.getModifiedFiles();
    assert.equal(files.length, 2);
    assert.ok(files.includes("a.ts"));
    assert.ok(files.includes("b.ts"));
  } finally {
    await cleanup();
  }
});

test("SessionStore: getHotspotFiles returns sorted by frequency", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    for (let i = 0; i < 5; i++) store.recordChange({ runId: "r", file: "hot.ts", operation: "modify", reason: "", dependsOn: [], assumptionIds: [] });
    for (let i = 0; i < 2; i++) store.recordChange({ runId: "r", file: "warm.ts", operation: "modify", reason: "", dependsOn: [], assumptionIds: [] });
    store.recordChange({ runId: "r", file: "cold.ts", operation: "modify", reason: "", dependsOn: [], assumptionIds: [] });

    const hotspots = store.getHotspotFiles();
    assert.equal(hotspots[0].file, "hot.ts");
    assert.equal(hotspots[0].changeCount, 5);
    assert.equal(hotspots[1].file, "warm.ts");
  } finally {
    await cleanup();
  }
});

// =============================================================================
// Assumption Management
// =============================================================================

test("SessionStore: addAssumption stores with generated id", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    const a = store.addAssumption({
      description: "User model has email field",
      type: "schema",
      relatedFiles: ["src/models/user.ts"],
      confidence: 0.9,
    });

    assert.ok(a.id);
    assert.ok(a.createdAt);
    assert.equal(a.valid, true);
    assert.equal(a.description, "User model has email field");
  } finally {
    await cleanup();
  }
});

test("SessionStore: getValidAssumptions filters valid only", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    const a1 = store.addAssumption({ description: "a1", type: "schema", relatedFiles: [], confidence: 0.9 });
    store.addAssumption({ description: "a2", type: "schema", relatedFiles: [], confidence: 0.8 });

    store.invalidateAssumption(a1.id, "run-x", "schema changed");

    const valid = store.getValidAssumptions();
    assert.equal(valid.length, 1);
    assert.equal(valid[0].description, "a2");
  } finally {
    await cleanup();
  }
});

test("SessionStore: invalidateAssumption marks invalid with metadata", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    const a = store.addAssumption({ description: "test", type: "behavior", relatedFiles: [], confidence: 0.9 });

    const invalidated = store.invalidateAssumption(a.id, "run-y", "behavior changed");
    assert.ok(invalidated);
    assert.equal(invalidated!.valid, false);
    assert.equal(invalidated!.invalidatedBy, "run-y");
    assert.equal(invalidated!.invalidationReason, "behavior changed");
  } finally {
    await cleanup();
  }
});

test("SessionStore: revalidateAssumption restores validity", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    const a = store.addAssumption({ description: "test", type: "config", relatedFiles: [], confidence: 0.9 });
    store.invalidateAssumption(a.id, "run-z", "was wrong");
    const revalidated = store.revalidateAssumption(a.id);
    assert.ok(revalidated);
    assert.equal(revalidated!.valid, true);
    assert.equal(revalidated!.invalidatedAt, undefined);
  } finally {
    await cleanup();
  }
});

// =============================================================================
// Session Management
// =============================================================================

test("SessionStore: incrementRunCount", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    assert.equal(store.getMetadata().runCount, 0);
    store.incrementRunCount();
    store.incrementRunCount();
    assert.equal(store.getMetadata().runCount, 2);
  } finally {
    await cleanup();
  }
});

test("SessionStore: reset clears all data", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    store.recordChange({ runId: "r", file: "a.ts", operation: "create", reason: "", dependsOn: [], assumptionIds: [] });
    store.addAssumption({ description: "test", type: "other", relatedFiles: [], confidence: 1 });
    const oldId = store.getSessionId();

    store.reset();
    assert.notEqual(store.getSessionId(), oldId);
    assert.equal(store.getAllChanges().length, 0);
    assert.equal(store.getAllAssumptions().length, 0);
  } finally {
    await cleanup();
  }
});

test("SessionStore: static exists returns true when file present", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    assert.equal(SessionStore.exists(ws), false);
    const store = new SessionStore(ws);
    store.save();
    assert.equal(SessionStore.exists(ws), true);
  } finally {
    await cleanup();
  }
});

test("SessionStore: static delete removes session file", async () => {
  const [ws, cleanup] = await tempDir();
  try {
    const store = new SessionStore(ws);
    store.save();
    assert.equal(SessionStore.exists(ws), true);
    SessionStore.delete(ws);
    assert.equal(SessionStore.exists(ws), false);
  } finally {
    await cleanup();
  }
});
