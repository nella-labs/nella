/**
 * MCP Handler Integration Test
 *
 * Tests the full handler pipeline (validation → cache → dispatch)
 * using a real temp workspace.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { McpToolHandler } from "../handler";
import { Workspace } from "../../workspace";
import { WorkspaceRegistry } from "../../workspace/registry";

// =============================================================================
// Helpers
// =============================================================================

async function setup(): Promise<{
  handler: McpToolHandler;
  workspacePath: string;
  cleanup: () => Promise<void>;
}> {
  const tempRoot = await mkdtemp(join(tmpdir(), "nella-mcp-int-"));
  const workspacePath = join(tempRoot, "project");
  const storagePath = join(tempRoot, "storage");

  await mkdir(workspacePath, { recursive: true });
  await mkdir(join(workspacePath, ".nella"), { recursive: true });
  await mkdir(storagePath, { recursive: true });

  // Create a sample file so the workspace has something to index/search
  await writeFile(join(workspacePath, "index.ts"), `export function greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n`);

  const registry = new WorkspaceRegistry({ storagePath });
  registry.register(workspacePath, "test-project");
  const ws = Workspace.fromPath(workspacePath, "test-project", { registry });

  const handler = new McpToolHandler({
    workspace: ws,
    cache: {},
    validateInputs: true,
  });

  return {
    handler,
    workspacePath,
    cleanup: async () => {
      await handler.shutdown();
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

test("Handler: getTools returns all 9 core tools", async () => {
  const { handler, cleanup } = await setup();
  try {
    const tools = handler.getTools();
    // Expect the 9 core tools
    assert.ok(tools.length >= 9, `Expected at least 9 tools, got ${tools.length}`);

    const names = tools.map((t) => t.name);
    assert.ok(names.includes("nella_search"), "Should have nella_search");
    assert.ok(names.includes("nella_verify"), "Should have nella_verify");
    assert.ok(names.includes("nella_index"), "Should have nella_index");
    assert.ok(names.includes("nella_get_context"), "Should have nella_get_context");
    assert.ok(names.includes("nella_set_context"), "Should have nella_set_context");
    assert.ok(names.includes("nella_status"), "Should have nella_status");
    assert.ok(names.includes("nella_explain"), "Should have nella_explain");
    assert.ok(names.includes("nella_docs"), "Should have nella_docs");
    assert.ok(names.includes("nella_history"), "Should have nella_history");
  } finally {
    await cleanup();
  }
});

test("Handler: getTools filters by category", async () => {
  const { handler, cleanup } = await setup();
  try {
    const analysisTools = handler.getTools({ category: "analysis" });
    const names = analysisTools.map((t) => t.name);
    assert.ok(names.includes("nella_explain"), "Should include nella_explain");
    // Search/indexing tools should not be returned
    for (const t of analysisTools) {
      assert.ok(t.category === "analysis", `Expected "analysis", got "${t.category}" for ${t.name}`);
    }
  } finally {
    await cleanup();
  }
});

test("Handler: validation rejects missing required fields", async () => {
  const { handler, cleanup } = await setup();
  try {
    const result = await handler.handleToolCall({
      name: "nella_search",
      arguments: {}, // missing required "query"
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("query") || result.content[0].text.includes("Validation") || result.content[0].text.includes("missing"));
  } finally {
    await cleanup();
  }
});

test("Handler: unknown tool returns error", async () => {
  const { handler, cleanup } = await setup();
  try {
    const result = await handler.handleToolCall({
      name: "nella_nonexistent",
      arguments: {},
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("Unknown") || result.content[0].text.includes("Error"));
  } finally {
    await cleanup();
  }
});

test("Handler: nella_status returns status info", async () => {
  const { handler, cleanup } = await setup();
  try {
    const result = await handler.handleToolCall({
      name: "nella_status",
      arguments: {},
    });
    assert.equal(result.isError, undefined);
    assert.ok(result.content[0].text.length > 0);
    assert.ok(result.content[0].text.includes("status") || result.content[0].text.includes("Status") || result.content[0].text.includes("Nella"));
  } finally {
    await cleanup();
  }
});

test("Handler: cache returns same result on repeated call", async () => {
  const { handler, cleanup } = await setup();
  try {
    // First call
    const result1 = await handler.handleToolCall({
      name: "nella_status",
      arguments: {},
    });

    // Second call should be cached
    const result2 = await handler.handleToolCall({
      name: "nella_status",
      arguments: {},
    });

    // Both should return same content (cached)
    assert.equal(result1.content[0].text, result2.content[0].text);

    // Verify cache stats
    const cacheStats = handler.getCache()?.stats();
    assert.ok(cacheStats);
    assert.ok(cacheStats.hits >= 1, "Should have at least 1 cache hit");
  } finally {
    await cleanup();
  }
});

test("Handler: event handlers receive call lifecycle events", async () => {
  const { handler, cleanup } = await setup();
  try {
    const events: string[] = [];
    handler.onEvent((event) => {
      events.push(event.type);
    });

    await handler.handleToolCall({
      name: "nella_status",
      arguments: {},
    });

    assert.ok(events.includes("tool:call:start"), "Should emit start event");
    assert.ok(events.includes("tool:call:end"), "Should emit end event");
  } finally {
    await cleanup();
  }
});

test("Handler: call history records metadata", async () => {
  const { handler, cleanup } = await setup();
  try {
    await handler.handleToolCall({
      name: "nella_status",
      arguments: {},
    });

    const history = handler.getCallHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].toolName, "nella_status");
    assert.equal(history[0].success, true);
    assert.ok(history[0].duration! > 0);
  } finally {
    await cleanup();
  }
});

test("Handler: nella_history returns call history", async () => {
  const { handler, cleanup } = await setup();
  try {
    // Make a few calls first
    await handler.handleToolCall({ name: "nella_status", arguments: {} });

    const result = await handler.handleToolCall({
      name: "nella_history",
      arguments: { limit: 10 },
    });

    assert.equal(result.isError, undefined);
    // History should contain the status call
    assert.ok(result.content[0].text.includes("nella_status") || result.content[0].text.includes("history"));
  } finally {
    await cleanup();
  }
});

test("Handler: getRegistry returns the tool registry", async () => {
  const { handler, cleanup } = await setup();
  try {
    const registry = handler.getRegistry();
    assert.ok(registry.has("nella_search"));
    assert.equal(registry.size, 9);
  } finally {
    await cleanup();
  }
});

test("Handler: shutdown completes without errors", async () => {
  const { handler, cleanup } = await setup();
  try {
    await handler.shutdown();
    assert.ok(true);
  } finally {
    // cleanup handles rm, but handler shutdown was already called above
    await rm(join(tmpdir()), { recursive: false, force: true }).catch(() => {});
    await cleanup().catch(() => {});
  }
});
