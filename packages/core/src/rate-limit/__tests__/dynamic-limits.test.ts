import test from "node:test";
import assert from "node:assert/strict";
import { DynamicLimitAdjuster } from "../dynamic-limits";
import { DEFAULT_RATE_LIMITER_CONFIG, type RateLimiterConfig } from "../types";

function baseConfig(overrides: Partial<RateLimiterConfig> = {}): RateLimiterConfig {
  return { ...DEFAULT_RATE_LIMITER_CONFIG, ...overrides };
}

// =============================================================================
// Construction / Enabled
// =============================================================================

test("DynamicLimitAdjuster: disabled by default config", () => {
  const adj = new DynamicLimitAdjuster({ enabled: false });
  assert.equal(adj.enabled, false);
  assert.equal(adj.multiplier, 1.0);
  adj.destroy();
});

test("DynamicLimitAdjuster: starts at multiplier 1.0", () => {
  const adj = new DynamicLimitAdjuster({ enabled: true, evaluationInterval: 999999 });
  assert.equal(adj.multiplier, 1.0);
  adj.destroy();
});

// =============================================================================
// getAdjustedConfig
// =============================================================================

test("DynamicLimitAdjuster: disabled returns base config unchanged", () => {
  const adj = new DynamicLimitAdjuster({ enabled: false });
  const cfg = baseConfig({ requestsPerMinute: 100 });
  const adjusted = adj.getAdjustedConfig(cfg);
  assert.equal(adjusted.requestsPerMinute, 100);
  adj.destroy();
});

test("DynamicLimitAdjuster: multiplier 1.0 returns base config unchanged", () => {
  const adj = new DynamicLimitAdjuster({ enabled: true, evaluationInterval: 999999 });
  const cfg = baseConfig({ requestsPerMinute: 100 });
  const adjusted = adj.getAdjustedConfig(cfg);
  assert.equal(adjusted.requestsPerMinute, 100);
  adj.destroy();
});

test("DynamicLimitAdjuster: low multiplier reduces limits", () => {
  const adj = new DynamicLimitAdjuster({ enabled: true, evaluationInterval: 999999, minMultiplier: 0.1, maxMultiplier: 2.0 });
  adj.setMultiplier(0.5);
  const cfg = baseConfig({ requestsPerMinute: 100, requestsPerHour: 1000, requestsPerDay: 10000 });
  const adjusted = adj.getAdjustedConfig(cfg);
  assert.equal(adjusted.requestsPerMinute, 50);
  assert.equal(adjusted.requestsPerHour, 500);
  assert.equal(adjusted.requestsPerDay, 5000);
  adj.destroy();
});

test("DynamicLimitAdjuster: high multiplier increases limits", () => {
  const adj = new DynamicLimitAdjuster({ enabled: true, evaluationInterval: 999999, minMultiplier: 0.1, maxMultiplier: 3.0 });
  adj.setMultiplier(2.0);
  const cfg = baseConfig({ requestsPerMinute: 100 });
  const adjusted = adj.getAdjustedConfig(cfg);
  assert.equal(adjusted.requestsPerMinute, 200);
  adj.destroy();
});

test("DynamicLimitAdjuster: limits never go below 1", () => {
  const adj = new DynamicLimitAdjuster({ enabled: true, evaluationInterval: 999999, minMultiplier: 0.001, maxMultiplier: 2.0 });
  adj.setMultiplier(0.001);
  const cfg = baseConfig({ requestsPerMinute: 100 });
  const adjusted = adj.getAdjustedConfig(cfg);
  assert.ok(adjusted.requestsPerMinute >= 1);
  adj.destroy();
});

// =============================================================================
// setMultiplier — clamping
// =============================================================================

test("DynamicLimitAdjuster: setMultiplier clamps to min", () => {
  const adj = new DynamicLimitAdjuster({ enabled: true, evaluationInterval: 999999, minMultiplier: 0.2, maxMultiplier: 2.0 });
  adj.setMultiplier(0.01);
  assert.equal(adj.multiplier, 0.2);
  adj.destroy();
});

test("DynamicLimitAdjuster: setMultiplier clamps to max", () => {
  const adj = new DynamicLimitAdjuster({ enabled: true, evaluationInterval: 999999, minMultiplier: 0.2, maxMultiplier: 2.0 });
  adj.setMultiplier(10);
  assert.equal(adj.multiplier, 2.0);
  adj.destroy();
});

// =============================================================================
// Events
// =============================================================================

test("DynamicLimitAdjuster: emits event on multiplier change", () => {
  const adj = new DynamicLimitAdjuster({ enabled: true, evaluationInterval: 999999, minMultiplier: 0.1, maxMultiplier: 3.0 });
  const events: unknown[] = [];
  adj.onEvent((e) => events.push(e));

  adj.setMultiplier(1.5);
  assert.equal(events.length, 1);
  assert.equal((events[0] as any).type, "rate:dynamic:adjusted");
  assert.equal((events[0] as any).oldMultiplier, 1.0);
  assert.equal((events[0] as any).newMultiplier, 1.5);
  adj.destroy();
});

test("DynamicLimitAdjuster: no event when multiplier unchanged", () => {
  const adj = new DynamicLimitAdjuster({ enabled: true, evaluationInterval: 999999, minMultiplier: 0.1, maxMultiplier: 3.0 });
  const events: unknown[] = [];
  adj.onEvent((e) => events.push(e));

  adj.setMultiplier(1.0); // same as default
  assert.equal(events.length, 0);
  adj.destroy();
});

// =============================================================================
// setConfig
// =============================================================================

test("DynamicLimitAdjuster: setConfig can enable/disable", () => {
  const adj = new DynamicLimitAdjuster({ enabled: false });
  assert.equal(adj.enabled, false);

  adj.setConfig({ enabled: true, evaluationInterval: 999999 });
  assert.equal(adj.enabled, true);

  adj.setConfig({ enabled: false });
  assert.equal(adj.enabled, false);
  adj.destroy();
});

// =============================================================================
// destroy
// =============================================================================

test("DynamicLimitAdjuster: destroy cleans up timer", () => {
  const adj = new DynamicLimitAdjuster({ enabled: true, evaluationInterval: 100 });
  adj.destroy(); // Should not throw
  assert.ok(true);
});
