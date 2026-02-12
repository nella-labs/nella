import test from "node:test";
import assert from "node:assert/strict";
import { MemoryBackend } from "../memory";
import type { RateLimitState } from "../../types";
import { tempDir } from "../../../__tests__/helpers";
import { join } from "path";

function freshState(entityId = "test-key"): RateLimitState {
  const now = Date.now();
  return {
    entityId,
    entityType: "key",
    buckets: {
      minute: { windowStart: now, count: 0, tokens: 0 },
      hour: { windowStart: now, count: 0, tokens: 0 },
      day: { windowStart: now, count: 0, tokens: 0 },
    },
    concurrent: 0,
    updatedAt: now,
  };
}

// =============================================================================
// Basic CRUD
// =============================================================================

test("MemoryBackend: getState returns null for unknown entity", async () => {
  const mem = new MemoryBackend();
  assert.equal(await mem.getState("unknown"), null);
});

test("MemoryBackend: setState and getState round-trip", async () => {
  const mem = new MemoryBackend();
  const state = freshState("k1");
  await mem.setState("k1", state);
  const got = await mem.getState("k1");
  assert.deepEqual(got, state);
});

test("MemoryBackend: deleteState removes entity", async () => {
  const mem = new MemoryBackend();
  await mem.setState("k1", freshState("k1"));
  await mem.deleteState("k1");
  assert.equal(await mem.getState("k1"), null);
});

// =============================================================================
// incrementBucket
// =============================================================================

test("MemoryBackend: incrementBucket creates new count when missing", async () => {
  const mem = new MemoryBackend();
  const result = await mem.incrementBucket("missing", "minute", 5);
  assert.equal(result.newCount, 5);
});

test("MemoryBackend: incrementBucket adds to existing count", async () => {
  const mem = new MemoryBackend();
  const state = freshState("k1");
  state.buckets.minute.count = 10;
  await mem.setState("k1", state);

  const result = await mem.incrementBucket("k1", "minute", 3);
  assert.equal(result.newCount, 13);
});

// =============================================================================
// adjustConcurrent
// =============================================================================

test("MemoryBackend: adjustConcurrent increments", async () => {
  const mem = new MemoryBackend();
  await mem.setState("k1", freshState("k1"));

  const c1 = await mem.adjustConcurrent("k1", 1);
  assert.equal(c1, 1);
  const c2 = await mem.adjustConcurrent("k1", 1);
  assert.equal(c2, 2);
});

test("MemoryBackend: adjustConcurrent decrements (floor 0)", async () => {
  const mem = new MemoryBackend();
  await mem.setState("k1", freshState("k1"));

  const c = await mem.adjustConcurrent("k1", -5);
  assert.equal(c, 0);
});

test("MemoryBackend: adjustConcurrent returns 0 for missing entity", async () => {
  const mem = new MemoryBackend();
  assert.equal(await mem.adjustConcurrent("missing", 1), 0);
});

// =============================================================================
// getAllEntityIds
// =============================================================================

test("MemoryBackend: getAllEntityIds lists all", async () => {
  const mem = new MemoryBackend();
  await mem.setState("a", freshState("a"));
  await mem.setState("b", freshState("b"));

  const ids = await mem.getAllEntityIds();
  assert.ok(ids.includes("a"));
  assert.ok(ids.includes("b"));
  assert.equal(ids.length, 2);
});

// =============================================================================
// isAvailable
// =============================================================================

test("MemoryBackend: isAvailable returns true", () => {
  const mem = new MemoryBackend();
  assert.equal(mem.isAvailable(), true);
});

// =============================================================================
// cleanup
// =============================================================================

test("MemoryBackend: cleanup removes stale entries", async () => {
  const mem = new MemoryBackend();
  const stale = freshState("old");
  stale.updatedAt = Date.now() - 100_000; // 100s ago
  await mem.setState("old", stale);

  const fresh = freshState("new");
  await mem.setState("new", fresh);

  const removed = await mem.cleanup(50_000); // 50s max age
  assert.equal(removed, 1);
  assert.equal(await mem.getState("old"), null);
  assert.ok(await mem.getState("new"));
});

test("MemoryBackend: cleanup keeps entries with active concurrent", async () => {
  const mem = new MemoryBackend();
  const state = freshState("busy");
  state.updatedAt = Date.now() - 100_000;
  state.concurrent = 1;
  await mem.setState("busy", state);

  const removed = await mem.cleanup(50_000);
  assert.equal(removed, 0);
  assert.ok(await mem.getState("busy"));
});

// =============================================================================
// export/import
// =============================================================================

test("MemoryBackend: exportState and importState round-trip", async () => {
  const mem1 = new MemoryBackend();
  await mem1.setState("k1", freshState("k1"));
  await mem1.setState("k2", freshState("k2"));

  const exported = await mem1.exportState();
  assert.equal(exported.size, 2);

  const mem2 = new MemoryBackend();
  await mem2.importState(exported);
  assert.ok(await mem2.getState("k1"));
  assert.ok(await mem2.getState("k2"));
});

// =============================================================================
// Persistence
// =============================================================================

test("MemoryBackend: file persistence save and reload", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const filePath = join(dir, "rate-limit", "state.json");

    const mem1 = new MemoryBackend();
    mem1.initPersistence(filePath);
    await mem1.setState("persistent", freshState("persistent"));
    await mem1.save();

    // New backend loads from disk
    const mem2 = new MemoryBackend();
    mem2.initPersistence(filePath);
    const state = await mem2.getState("persistent");
    assert.ok(state);
    assert.equal(state!.entityId, "persistent");
  } finally {
    await cleanup();
  }
});

// =============================================================================
// destroy
// =============================================================================

test("MemoryBackend: destroy clears state", async () => {
  const mem = new MemoryBackend();
  await mem.setState("k1", freshState("k1"));
  await mem.destroy();
  assert.equal(await mem.getState("k1"), null);
});
