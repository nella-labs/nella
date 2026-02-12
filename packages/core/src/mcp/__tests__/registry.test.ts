import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry, createToolRegistry } from "../registry";
import type { McpTool } from "../types";

// =============================================================================
// Helpers
// =============================================================================

function makeTool(name: string, version = "1.0.0"): McpTool {
  return {
    name,
    description: `${name} tool`,
    version,
    category: "search",
    tags: ["test"],
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  };
}

// =============================================================================
// register / get
// =============================================================================

test("ToolRegistry: register and get a tool", () => {
  const reg = new ToolRegistry();
  reg.register(makeTool("nella_search"));
  const tool = reg.get("nella_search");
  assert.equal(tool?.name, "nella_search");
  assert.equal(tool?.version, "1.0.0");
});

test("ToolRegistry: get returns undefined for unregistered tool", () => {
  const reg = new ToolRegistry();
  assert.equal(reg.get("nope"), undefined);
});

test("ToolRegistry: registerAll registers multiple tools", () => {
  const reg = new ToolRegistry();
  reg.registerAll([makeTool("a"), makeTool("b"), makeTool("c")]);
  assert.equal(reg.size, 3);
});

// =============================================================================
// Versioning
// =============================================================================

test("ToolRegistry: get returns latest version by default", () => {
  const reg = new ToolRegistry();
  reg.register(makeTool("nella_search", "1.0.0"));
  reg.register(makeTool("nella_search", "2.0.0"));

  const tool = reg.get("nella_search");
  assert.equal(tool?.version, "2.0.0");
});

test("ToolRegistry: get specific version", () => {
  const reg = new ToolRegistry();
  reg.register(makeTool("nella_search", "1.0.0"));
  reg.register(makeTool("nella_search", "2.0.0"));

  const v1 = reg.get("nella_search", "1.0.0");
  assert.equal(v1?.version, "1.0.0");
});

test("ToolRegistry: getVersions returns sorted versions", () => {
  const reg = new ToolRegistry();
  reg.register(makeTool("t", "1.0.0"));
  reg.register(makeTool("t", "2.1.0"));
  reg.register(makeTool("t", "1.5.0"));

  const versions = reg.getVersions("t");
  assert.deepEqual(versions, ["1.0.0", "1.5.0", "2.1.0"]);
});

// =============================================================================
// resolve
// =============================================================================

test("ToolRegistry: resolve with version string", () => {
  const reg = new ToolRegistry();
  reg.register(makeTool("nella_search", "1.0.0"));
  reg.register(makeTool("nella_search", "2.0.0"));

  const tool = reg.resolve("nella_search@1.0.0");
  assert.equal(tool?.version, "1.0.0");
});

test("ToolRegistry: resolve without version gets latest", () => {
  const reg = new ToolRegistry();
  reg.register(makeTool("nella_search", "1.0.0"));
  reg.register(makeTool("nella_search", "2.0.0"));

  const tool = reg.resolve("nella_search");
  assert.equal(tool?.version, "2.0.0");
});

// =============================================================================
// Deprecation
// =============================================================================

test("ToolRegistry: deprecate marks tool as deprecated", () => {
  const reg = new ToolRegistry();
  reg.register(makeTool("old_tool", "1.0.0"));

  assert.equal(reg.deprecate("old_tool", "1.0.0", "new_tool@1.0.0"), true);
  assert.equal(reg.isDeprecated("old_tool", "1.0.0"), true);
});

test("ToolRegistry: list excludes deprecated by default", () => {
  const reg = new ToolRegistry();
  reg.register(makeTool("active"));
  reg.register(makeTool("old"));
  reg.deprecate("old", "1.0.0");

  const tools = reg.list();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "active");
});

test("ToolRegistry: list includes deprecated when requested", () => {
  const reg = new ToolRegistry();
  reg.register(makeTool("active"));
  reg.register(makeTool("old"));
  reg.deprecate("old", "1.0.0");

  const tools = reg.list({ includeDeprecated: true });
  assert.equal(tools.length, 2);
});

test("ToolRegistry: deprecate returns false for non-existent tool", () => {
  const reg = new ToolRegistry();
  assert.equal(reg.deprecate("nope", "1.0.0"), false);
});

// =============================================================================
// Filtering
// =============================================================================

test("ToolRegistry: list filters by category", () => {
  const reg = new ToolRegistry();
  reg.register({ ...makeTool("s"), category: "search" });
  reg.register({ ...makeTool("v"), category: "verification" as any });

  const results = reg.list({ category: "search" });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "s");
});

test("ToolRegistry: list filters by tags", () => {
  const reg = new ToolRegistry();
  reg.register({ ...makeTool("a"), tags: ["core", "read"] });
  reg.register({ ...makeTool("b"), tags: ["core", "write"] });

  const results = reg.list({ tags: ["core", "write"] });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "b");
});

// =============================================================================
// has / size
// =============================================================================

test("ToolRegistry: has returns true for registered tool", () => {
  const reg = new ToolRegistry();
  reg.register(makeTool("nella_search"));
  assert.equal(reg.has("nella_search"), true);
  assert.equal(reg.has("nella_nope"), false);
});

test("ToolRegistry: size counts unique tool names", () => {
  const reg = new ToolRegistry();
  reg.register(makeTool("a", "1.0.0"));
  reg.register(makeTool("a", "2.0.0"));
  reg.register(makeTool("b", "1.0.0"));
  assert.equal(reg.size, 2);
});

// =============================================================================
// createToolRegistry factory
// =============================================================================

test("createToolRegistry: creates empty registry", () => {
  const reg = createToolRegistry();
  assert.equal(reg.size, 0);
  assert.ok(reg instanceof ToolRegistry);
});
