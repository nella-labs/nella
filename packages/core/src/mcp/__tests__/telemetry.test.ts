import test from "node:test";
import assert from "node:assert/strict";
import { TelemetryManager, createTelemetryManager } from "../telemetry";

// =============================================================================
// Initialization (without OTel packages)
// =============================================================================

test("TelemetryManager: initializes gracefully without OTel packages", async () => {
  const tm = new TelemetryManager({ enabled: true });
  // init should not throw even without @opentelemetry packages installed
  await tm.init();
  assert.ok(true);
});

test("TelemetryManager: disabled telemetry skips init", async () => {
  const tm = new TelemetryManager({ enabled: false });
  await tm.init();
  assert.ok(true);
});

// =============================================================================
// No-op span (without OTel)
// =============================================================================

test("TelemetryManager: createToolSpan returns no-op span without OTel", async () => {
  const tm = new TelemetryManager({ enabled: true });
  await tm.init();

  const span = tm.createToolSpan("nella_search", { query: "test" });
  assert.ok(span);

  // No-op span should have setAttribute, recordError, end methods
  assert.equal(typeof span.setAttribute, "function");
  assert.equal(typeof span.recordError, "function");
  assert.equal(typeof span.end, "function");

  // end() should not throw
  span.end();
  assert.ok(true);
});

// =============================================================================
// Metrics recording
// =============================================================================

test("TelemetryManager: recordToolMetrics aggregates call data", async () => {
  const tm = new TelemetryManager({ enabled: true, enableMetrics: true });
  await tm.init();

  const base = { callId: "1", arguments: {}, startTime: Date.now() };
  tm.recordToolMetrics({ ...base, toolName: "nella_search", duration: 100, success: true });
  tm.recordToolMetrics({ ...base, toolName: "nella_search", duration: 200, success: true });
  tm.recordToolMetrics({ ...base, toolName: "nella_search", duration: 50, success: false, error: "fail" });
  tm.recordToolMetrics({ ...base, toolName: "nella_verify", duration: 150, success: true });

  const metrics = tm.getMetrics();
  const search = metrics.get("nella_search");
  assert.ok(search);
  assert.equal(search.toolCallTotal, 3);
  assert.equal(search.toolCallErrors, 1);
  assert.ok(metrics.has("nella_verify"));
});

// =============================================================================
// Metrics summary format
// =============================================================================

test("TelemetryManager: getMetricsSummary returns markdown", async () => {
  const tm = new TelemetryManager({ enabled: true, enableMetrics: true });
  await tm.init();

  const base = { callId: "1", arguments: {}, startTime: Date.now() };
  tm.recordToolMetrics({ ...base, toolName: "nella_search", duration: 100, success: true });

  const summary = tm.getMetricsSummary();
  assert.ok(summary.includes("nella_search"));
  assert.ok(summary.includes("Calls"));
});

test("TelemetryManager: getMetricsSummary returns message when no data", async () => {
  const tm = new TelemetryManager({ enabled: true, enableMetrics: true });
  await tm.init();

  const summary = tm.getMetricsSummary();
  assert.ok(summary.includes("No") || summary.length > 0);
});

// =============================================================================
// shutdown
// =============================================================================

test("TelemetryManager: shutdown does not throw", async () => {
  const tm = new TelemetryManager({ enabled: true });
  await tm.init();
  // shutdown should not throw even without OTel
  await tm.shutdown();
  assert.ok(true);
});

// =============================================================================
// createTelemetryManager factory
// =============================================================================

test("createTelemetryManager: returns initialized instance", async () => {
  const tm = await createTelemetryManager({ enabled: false });
  assert.ok(tm instanceof TelemetryManager);
});
