import test from "node:test";
import assert from "node:assert/strict";
import { LRUCache, createLRUCache } from "../lru-cache";
import { tick } from "../../__tests__/helpers";

// =============================================================================
// Basic Operations
// =============================================================================

test("LRUCache: get/set basic round-trip", () => {
  const cache = new LRUCache<string>({ maxSize: 3 });
  cache.set("a", "1");
  assert.equal(cache.get("a"), "1");
});

test("LRUCache: get returns undefined for missing key", () => {
  const cache = new LRUCache<number>({ maxSize: 3 });
  assert.equal(cache.get("missing"), undefined);
});

test("LRUCache: has returns true for existing key", () => {
  const cache = new LRUCache<string>({ maxSize: 3 });
  cache.set("x", "val");
  assert.equal(cache.has("x"), true);
});

test("LRUCache: has returns false for missing key", () => {
  const cache = new LRUCache<string>({ maxSize: 3 });
  assert.equal(cache.has("x"), false);
});

test("LRUCache: set overwrites existing key", () => {
  const cache = new LRUCache<string>({ maxSize: 3 });
  cache.set("a", "first");
  cache.set("a", "second");
  assert.equal(cache.get("a"), "second");
  assert.equal(cache.size, 1);
});

test("LRUCache: delete removes a key", async () => {
  const cache = new LRUCache<string>({ maxSize: 3 });
  cache.set("a", "1");
  const deleted = await cache.delete("a");
  assert.equal(deleted, true);
  assert.equal(cache.has("a"), false);
  assert.equal(cache.size, 0);
});

test("LRUCache: delete returns false for missing key", async () => {
  const cache = new LRUCache<string>({ maxSize: 3 });
  const deleted = await cache.delete("nope");
  assert.equal(deleted, false);
});

test("LRUCache: clear removes all entries", async () => {
  const cache = new LRUCache<string>({ maxSize: 5 });
  cache.set("a", "1");
  cache.set("b", "2");
  cache.set("c", "3");
  await cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.get("a"), undefined);
});

test("LRUCache: keys and values return contents", () => {
  const cache = new LRUCache<number>({ maxSize: 5 });
  cache.set("x", 10);
  cache.set("y", 20);
  assert.deepEqual(cache.keys(), ["x", "y"]);
  assert.deepEqual(cache.values(), [10, 20]);
});

// =============================================================================
// LRU Eviction
// =============================================================================

test("LRUCache: evicts least recently used when at capacity", () => {
  const cache = new LRUCache<string>({ maxSize: 2 });
  cache.set("a", "1");
  cache.set("b", "2");
  // 'a' is LRU, adding 'c' should evict it
  cache.set("c", "3");
  assert.equal(cache.has("a"), false, "a should be evicted");
  assert.equal(cache.get("b"), "2");
  assert.equal(cache.get("c"), "3");
  assert.equal(cache.size, 2);
});

test("LRUCache: accessing a key promotes it (not evicted next)", () => {
  const cache = new LRUCache<string>({ maxSize: 2 });
  cache.set("a", "1");
  cache.set("b", "2");
  // Access 'a' to promote it; now 'b' is LRU
  cache.get("a");
  cache.set("c", "3");
  assert.equal(cache.has("b"), false, "b should be evicted");
  assert.equal(cache.get("a"), "1");
  assert.equal(cache.get("c"), "3");
});

test("LRUCache: set same key promotes it", () => {
  const cache = new LRUCache<string>({ maxSize: 2 });
  cache.set("a", "1");
  cache.set("b", "2");
  // Re-set 'a' promotes it; 'b' is now LRU
  cache.set("a", "updated");
  cache.set("c", "3");
  assert.equal(cache.has("b"), false, "b should be evicted");
  assert.equal(cache.get("a"), "updated");
});

test("LRUCache: maxSize 1 always keeps only latest", () => {
  const cache = new LRUCache<string>({ maxSize: 1 });
  cache.set("a", "1");
  cache.set("b", "2");
  assert.equal(cache.size, 1);
  assert.equal(cache.has("a"), false);
  assert.equal(cache.get("b"), "2");
});

// =============================================================================
// TTL Expiry
// =============================================================================

test("LRUCache: expired entry returns undefined on get", async () => {
  const cache = new LRUCache<string>({ maxSize: 5, ttl: 50 });
  cache.set("temp", "value");
  assert.equal(cache.get("temp"), "value");
  await tick(80);
  assert.equal(cache.get("temp"), undefined, "should be expired");
});

test("LRUCache: expired entry returns false on has", async () => {
  const cache = new LRUCache<string>({ maxSize: 5, ttl: 50 });
  cache.set("temp", "value");
  await tick(80);
  assert.equal(cache.has("temp"), false);
});

test("LRUCache: non-expired entry is still accessible", async () => {
  const cache = new LRUCache<string>({ maxSize: 5, ttl: 500 });
  cache.set("alive", "yes");
  await tick(20);
  assert.equal(cache.get("alive"), "yes");
});

test("LRUCache: cleanup removes all expired entries", async () => {
  const cache = new LRUCache<string>({ maxSize: 10, ttl: 50 });
  cache.set("a", "1");
  cache.set("b", "2");
  await tick(80);
  cache.set("c", "3"); // fresh entry
  const cleaned = cache.cleanup();
  assert.equal(cleaned, 2);
  assert.equal(cache.has("a"), false);
  assert.equal(cache.has("b"), false);
  assert.equal(cache.get("c"), "3");
});

test("LRUCache: cleanup with no TTL returns 0", () => {
  const cache = new LRUCache<string>({ maxSize: 5 });
  cache.set("a", "1");
  assert.equal(cache.cleanup(), 0);
});

// =============================================================================
// onEvict Callback
// =============================================================================

test("LRUCache: onEvict fires on eviction", () => {
  const evicted: Array<[string, string]> = [];
  const cache = new LRUCache<string>({
    maxSize: 2,
    onEvict: (key, value) => {
      evicted.push([key, value]);
    },
  });
  cache.set("a", "1");
  cache.set("b", "2");
  cache.set("c", "3"); // evicts 'a'
  assert.equal(evicted.length, 1);
  assert.deepEqual(evicted[0], ["a", "1"]);
});

test("LRUCache: onEvict fires on delete", async () => {
  const evicted: string[] = [];
  const cache = new LRUCache<string>({
    maxSize: 5,
    onEvict: (key) => {
      evicted.push(key);
    },
  });
  cache.set("x", "val");
  await cache.delete("x");
  assert.deepEqual(evicted, ["x"]);
});

test("LRUCache: onEvict fires for all entries on clear", async () => {
  const evicted: string[] = [];
  const cache = new LRUCache<string>({
    maxSize: 5,
    onEvict: (key) => {
      evicted.push(key);
    },
  });
  cache.set("a", "1");
  cache.set("b", "2");
  await cache.clear();
  assert.deepEqual(evicted.sort(), ["a", "b"]);
});

// =============================================================================
// Stats
// =============================================================================

test("LRUCache: stats returns correct info", () => {
  const cache = new LRUCache<string>({ maxSize: 10 });
  cache.set("first", "1");
  cache.set("second", "2");
  const stats = cache.stats();
  assert.equal(stats.size, 2);
  assert.equal(stats.maxSize, 10);
  assert.equal(stats.oldestKey, "first");
  assert.equal(stats.newestKey, "second");
});

test("LRUCache: stats on empty cache", () => {
  const cache = new LRUCache<string>({ maxSize: 5 });
  const stats = cache.stats();
  assert.equal(stats.size, 0);
  assert.equal(stats.oldestKey, null);
  assert.equal(stats.newestKey, null);
});

// =============================================================================
// Factory
// =============================================================================

test("createLRUCache factory works", () => {
  const cache = createLRUCache<number>({ maxSize: 3 });
  cache.set("n", 42);
  assert.equal(cache.get("n"), 42);
});
