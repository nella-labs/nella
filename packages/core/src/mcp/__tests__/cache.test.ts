import test from "node:test";
import assert from "node:assert/strict";
import { ToolResultCache } from "../cache";
import type { McpToolResult } from "../types";

// =============================================================================
// Helpers
// =============================================================================

function makeResult(text: string, isError = false): McpToolResult {
  return {
    content: [{ type: "text", text }],
    isError,
    metadata: { durationMs: 10, timestamp: new Date().toISOString(), toolName: "test", toolVersion: "1.0.0" },
  };
}

// =============================================================================
// Basic get/set
// =============================================================================

test("ToolResultCache: returns cached result on second call", () => {
  const cache = new ToolResultCache();
  const result = makeResult("search results");
  cache.set("nella_search", { query: "hello" }, result);

  const cached = cache.get("nella_search", { query: "hello" });
  assert.deepEqual(cached, result);
});

test("ToolResultCache: cache miss for different args", () => {
  const cache = new ToolResultCache();
  cache.set("nella_search", { query: "hello" }, makeResult("r1"));

  const cached = cache.get("nella_search", { query: "world" });
  assert.equal(cached, undefined);
});

test("ToolResultCache: cache miss for different tool name", () => {
  const cache = new ToolResultCache();
  cache.set("nella_search", { query: "hello" }, makeResult("r1"));

  const cached = cache.get("nella_verify", { query: "hello" });
  assert.equal(cached, undefined);
});

// =============================================================================
// Cacheability
// =============================================================================

test("ToolResultCache: does not cache mutating tools", () => {
  const cache = new ToolResultCache();
  cache.set("nella_index", { path: "." }, makeResult("indexed"));

  const cached = cache.get("nella_index", { path: "." });
  assert.equal(cached, undefined);
});

test("ToolResultCache: does not cache error results", () => {
  const cache = new ToolResultCache();
  cache.set("nella_search", { query: "err" }, makeResult("error", true));

  const cached = cache.get("nella_search", { query: "err" });
  assert.equal(cached, undefined);
});

test("ToolResultCache: isCacheable true for read-only tools", () => {
  const cache = new ToolResultCache();
  assert.equal(cache.isCacheable("nella_search"), true);
  assert.equal(cache.isCacheable("nella_verify"), true);
  assert.equal(cache.isCacheable("nella_status"), true);
  assert.equal(cache.isCacheable("nella_explain"), true);
  assert.equal(cache.isCacheable("nella_docs"), true);
  assert.equal(cache.isCacheable("nella_history"), true);
});

test("ToolResultCache: isCacheable false for mutating tools", () => {
  const cache = new ToolResultCache();
  assert.equal(cache.isCacheable("nella_index"), false);
  assert.equal(cache.isCacheable("nella_set_context"), false);
});

// =============================================================================
// Invalidation
// =============================================================================

test("ToolResultCache: nella_index invalidates search/verify/explain/docs", () => {
  const cache = new ToolResultCache();
  cache.set("nella_search", { query: "a" }, makeResult("search"));
  cache.set("nella_verify", { code: "x" }, makeResult("verify"));
  cache.set("nella_explain", { code: "y" }, makeResult("explain"));
  cache.set("nella_docs", { query: "z" }, makeResult("docs"));
  cache.set("nella_get_context", { key: "k" }, makeResult("context")); // should NOT be invalidated

  cache.invalidate("nella_index");

  assert.equal(cache.get("nella_search", { query: "a" }), undefined);
  assert.equal(cache.get("nella_verify", { code: "x" }), undefined);
  assert.equal(cache.get("nella_explain", { code: "y" }), undefined);
  assert.equal(cache.get("nella_docs", { query: "z" }), undefined);
  // context should survive
  assert.ok(cache.get("nella_get_context", { key: "k" }) !== undefined);
});

test("ToolResultCache: nella_set_context invalidates context/status", () => {
  const cache = new ToolResultCache();
  cache.set("nella_get_context", { key: "k" }, makeResult("ctx"));
  cache.set("nella_search", { query: "a" }, makeResult("search")); // should survive

  cache.invalidate("nella_set_context");

  assert.equal(cache.get("nella_get_context", { key: "k" }), undefined);
  // search should survive
  assert.ok(cache.get("nella_search", { query: "a" }) !== undefined);
});

// =============================================================================
// Stats
// =============================================================================

test("ToolResultCache: stats track hits and misses", () => {
  const cache = new ToolResultCache();
  cache.set("nella_search", { query: "a" }, makeResult("r"));

  cache.get("nella_search", { query: "a" }); // hit
  cache.get("nella_search", { query: "b" }); // miss
  cache.get("nella_search", { query: "a" }); // hit

  const stats = cache.stats();
  assert.equal(stats.hits, 2);
  assert.equal(stats.misses, 1);
  assert.ok(stats.hitRate > 0.6);
});

// =============================================================================
// Clear
// =============================================================================

test("ToolResultCache: clear removes all entries and resets stats", async () => {
  const cache = new ToolResultCache();
  cache.set("nella_search", { query: "a" }, makeResult("r"));
  cache.get("nella_search", { query: "a" }); // hit

  await cache.clear();

  assert.equal(cache.get("nella_search", { query: "a" }), undefined);
  const stats = cache.stats();
  assert.equal(stats.hits, 0);
  assert.equal(stats.misses, 1); // the get after clear counts as a miss
  assert.equal(stats.size, 0);
});

// =============================================================================
// Key determinism — arg order doesn't matter
// =============================================================================

test("ToolResultCache: arg order does not affect cache key", () => {
  const cache = new ToolResultCache();
  const result = makeResult("found");
  cache.set("nella_search", { query: "hello", maxResults: 10 }, result);

  const cached = cache.get("nella_search", { maxResults: 10, query: "hello" });
  assert.deepEqual(cached, result);
});
