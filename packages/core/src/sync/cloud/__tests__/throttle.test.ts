import test from "node:test";
import assert from "node:assert/strict";
import { BandwidthThrottle } from "../throttle";

// =============================================================================
// Construction
// =============================================================================

test("BandwidthThrottle: unlimited when no limit set", async () => {
  const t = new BandwidthThrottle();
  // Should return immediately (no throttle)
  const start = Date.now();
  await t.consume(1_000_000);
  assert.ok(Date.now() - start < 50);
});

test("BandwidthThrottle: unlimited when limit is 0", async () => {
  const t = new BandwidthThrottle(0);
  const start = Date.now();
  await t.consume(1_000_000);
  assert.ok(Date.now() - start < 50);
});

test("BandwidthThrottle: unlimited when limit is negative", async () => {
  const t = new BandwidthThrottle(-10);
  const start = Date.now();
  await t.consume(1_000_000);
  assert.ok(Date.now() - start < 50);
});

// =============================================================================
// Under-limit (no throttle)
// =============================================================================

test("BandwidthThrottle: no delay within limit", async () => {
  const t = new BandwidthThrottle(100); // 100 KBps = 102400 bytes/sec
  const start = Date.now();
  await t.consume(50_000); // Well under limit
  assert.ok(Date.now() - start < 50);
});

test("BandwidthThrottle: no delay for 0 bytes", async () => {
  const t = new BandwidthThrottle(10);
  const start = Date.now();
  await t.consume(0);
  assert.ok(Date.now() - start < 50);
});

test("BandwidthThrottle: no delay for negative bytes", async () => {
  const t = new BandwidthThrottle(10);
  const start = Date.now();
  await t.consume(-100);
  assert.ok(Date.now() - start < 50);
});

// =============================================================================
// Over-limit (throttle)
// =============================================================================

test("BandwidthThrottle: delays when over limit", async () => {
  const t = new BandwidthThrottle(1); // 1 KBps = 1024 bytes/sec
  const start = Date.now();
  // Consume well over the 1024 bytes/sec limit
  await t.consume(3072); // 3x over limit → should sleep ~2s
  const elapsed = Date.now() - start;
  // Allow some tolerance, but should be at least 1s
  assert.ok(elapsed >= 500, `expected >=500ms delay, got ${elapsed}ms`);
});

// =============================================================================
// Window reset
// =============================================================================

test("BandwidthThrottle: resets window after 1 second", async () => {
  const t = new BandwidthThrottle(100); // 100 KBps
  await t.consume(50_000); // Under limit

  // Wait for window to reset
  await new Promise((r) => setTimeout(r, 1100));

  const start = Date.now();
  await t.consume(50_000); // Should be under limit again
  assert.ok(Date.now() - start < 50);
});
