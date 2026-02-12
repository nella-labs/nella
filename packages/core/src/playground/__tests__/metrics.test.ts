import test from "node:test";
import assert from "node:assert/strict";
import { createPlaygroundMetrics } from "../metrics";

test("createPlaygroundMetrics returns all expected metric objects", () => {
  const m = createPlaygroundMetrics();
  assert.ok(m.toolCallsTotal);
  assert.ok(m.toolDurationSeconds);
  assert.ok(m.wsConnectionsActive);
  assert.ok(m.sessionsActive);
  assert.ok(m.tokensTotal);
  assert.ok(m.costTotal);
  assert.ok(m.indexingDurationSeconds);
  assert.ok(m.errorsTotal);
  assert.ok(m.wsMessagesTotal);
  assert.ok(m.uptimeSeconds);
  assert.ok(m.registry);
});

test("counter increments and reads correctly", () => {
  const m = createPlaygroundMetrics();
  m.toolCallsTotal.inc({ tool: "nella_check", status: "success" });
  m.toolCallsTotal.inc({ tool: "nella_check", status: "success" });
  m.toolCallsTotal.inc({ tool: "nella_check", status: "error" });

  assert.equal(m.toolCallsTotal.get({ tool: "nella_check", status: "success" }), 2);
  assert.equal(m.toolCallsTotal.get({ tool: "nella_check", status: "error" }), 1);
});

test("gauge set/inc/dec works correctly", () => {
  const m = createPlaygroundMetrics();
  m.wsConnectionsActive.set(5);
  assert.equal(m.wsConnectionsActive.get(), 5);

  m.wsConnectionsActive.inc();
  assert.equal(m.wsConnectionsActive.get(), 6);

  m.wsConnectionsActive.dec();
  assert.equal(m.wsConnectionsActive.get(), 5);
});

test("histogram observe and get works correctly", () => {
  const m = createPlaygroundMetrics();
  m.toolDurationSeconds.observe(0.05, { tool: "nella_check" });
  m.toolDurationSeconds.observe(1.5, { tool: "nella_check" });

  const data = m.toolDurationSeconds.get({ tool: "nella_check" });
  assert.equal(data.count, 2);
  assert.equal(data.sum, 1.55);
});

test("registry.serialize produces Prometheus text format", () => {
  const m = createPlaygroundMetrics();
  m.toolCallsTotal.inc({ tool: "test", status: "ok" });
  m.uptimeSeconds.set(42.5);

  const text = m.registry.serialize();
  assert.ok(text.includes("# HELP playground_tool_calls_total"));
  assert.ok(text.includes("# TYPE playground_tool_calls_total counter"));
  assert.ok(text.includes('playground_tool_calls_total{status="ok",tool="test"} 1'));
  assert.ok(text.includes("playground_uptime_seconds 42.5"));
});

test("registry.reset clears all metrics", () => {
  const m = createPlaygroundMetrics();
  m.toolCallsTotal.inc({ tool: "x", status: "ok" }, 10);
  m.wsConnectionsActive.set(3);

  m.registry.reset();
  assert.equal(m.toolCallsTotal.get({ tool: "x", status: "ok" }), 0);
  assert.equal(m.wsConnectionsActive.get(), 0);
});
