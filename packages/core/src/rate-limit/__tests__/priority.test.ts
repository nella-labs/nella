import test from "node:test";
import assert from "node:assert/strict";
import { PriorityHandler } from "../priority";
import { DEFAULT_RATE_LIMITER_CONFIG, type RateLimiterConfig } from "../types";

function baseConfig(overrides: Partial<RateLimiterConfig> = {}): RateLimiterConfig {
  return { ...DEFAULT_RATE_LIMITER_CONFIG, ...overrides };
}

// =============================================================================
// Disabled
// =============================================================================

test("PriorityHandler: disabled returns base config unchanged", () => {
  const ph = new PriorityHandler({ enabled: false });
  const cfg = baseConfig({ requestsPerMinute: 60 });
  const effective = ph.getEffectiveConfig(cfg, "high");
  assert.equal(effective.requestsPerMinute, 60);
});

test("PriorityHandler: disabled never bypasses", () => {
  const ph = new PriorityHandler({ enabled: false });
  assert.equal(ph.shouldBypass("critical"), false);
});

test("PriorityHandler: enabled property reflects config", () => {
  assert.equal(new PriorityHandler({ enabled: true }).enabled, true);
  assert.equal(new PriorityHandler({ enabled: false }).enabled, false);
});

// =============================================================================
// shouldBypass
// =============================================================================

test("PriorityHandler: critical bypasses when enabled", () => {
  const ph = new PriorityHandler({ enabled: true, criticalBypass: true });
  assert.equal(ph.shouldBypass("critical"), true);
});

test("PriorityHandler: critical does not bypass when criticalBypass false", () => {
  const ph = new PriorityHandler({ enabled: true, criticalBypass: false });
  assert.equal(ph.shouldBypass("critical"), false);
});

test("PriorityHandler: non-critical never bypasses", () => {
  const ph = new PriorityHandler({ enabled: true, criticalBypass: true });
  assert.equal(ph.shouldBypass("low"), false);
  assert.equal(ph.shouldBypass("normal"), false);
  assert.equal(ph.shouldBypass("high"), false);
});

// =============================================================================
// getEffectiveConfig — multipliers
// =============================================================================

test("PriorityHandler: normal priority uses 1x multiplier", () => {
  const ph = new PriorityHandler({ enabled: true });
  const cfg = baseConfig({ requestsPerMinute: 100 });
  const effective = ph.getEffectiveConfig(cfg, "normal");
  assert.equal(effective.requestsPerMinute, 100);
});

test("PriorityHandler: high priority multiplies limits up", () => {
  const ph = new PriorityHandler({
    enabled: true,
    multipliers: { low: 0.5, normal: 1, high: 2, critical: Infinity },
  });
  const cfg = baseConfig({ requestsPerMinute: 100, requestsPerHour: 1000, requestsPerDay: 10000 });
  const effective = ph.getEffectiveConfig(cfg, "high");
  assert.equal(effective.requestsPerMinute, 200);
  assert.equal(effective.requestsPerHour, 2000);
  assert.equal(effective.requestsPerDay, 20000);
});

test("PriorityHandler: low priority multiplies limits down", () => {
  const ph = new PriorityHandler({
    enabled: true,
    multipliers: { low: 0.5, normal: 1, high: 2, critical: Infinity },
  });
  const cfg = baseConfig({ requestsPerMinute: 100 });
  const effective = ph.getEffectiveConfig(cfg, "low");
  assert.equal(effective.requestsPerMinute, 50);
});

test("PriorityHandler: critical (infinite multiplier) sets very high limits", () => {
  const ph = new PriorityHandler({
    enabled: true,
    multipliers: { low: 0.5, normal: 1, high: 2, critical: Infinity },
  });
  const cfg = baseConfig({ requestsPerMinute: 100 });
  const effective = ph.getEffectiveConfig(cfg, "critical");
  assert.equal(effective.requestsPerMinute, Number.MAX_SAFE_INTEGER);
});

test("PriorityHandler: default priority is normal", () => {
  const ph = new PriorityHandler({ enabled: true });
  const cfg = baseConfig({ requestsPerMinute: 60 });
  const e1 = ph.getEffectiveConfig(cfg); // no priority arg
  const e2 = ph.getEffectiveConfig(cfg, "normal");
  assert.equal(e1.requestsPerMinute, e2.requestsPerMinute);
});

// =============================================================================
// setConfig
// =============================================================================

test("PriorityHandler: setConfig updates behavior", () => {
  const ph = new PriorityHandler({ enabled: false });
  assert.equal(ph.shouldBypass("critical"), false);

  ph.setConfig({ enabled: true, criticalBypass: true });
  assert.equal(ph.shouldBypass("critical"), true);
});
