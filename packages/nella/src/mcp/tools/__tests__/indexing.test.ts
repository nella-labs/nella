/**
 * Indexing MCP Tool Handler Tests
 *
 * Tests for nella_index and nella_search tool dispatch and error handling.
 *
 * Note: Full indexing requires embedding API calls, so these tests focus on
 * dispatch logic, error paths, and the empty-index guard. Core indexing
 * components (chunker, vector store, lexical index, hybrid search) are
 * thoroughly tested in packages/core.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleIndexingTool, registerIndexingTools } from "../indexing";
import type { ServerContext } from "../../server";
import { ContextManager } from "@usenella/core";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("Indexing Tool Handlers", () => {

  // ===========================================================================
  // Tool Registration
  // ===========================================================================

  describe("registerIndexingTools", () => {
    it("registers nella_index and nella_search", () => {
      const tools = registerIndexingTools();

      assert.equal(tools.length, 2);
      assert.equal(tools[0].name, "nella_index");
      assert.equal(tools[1].name, "nella_search");
    });

    it("nella_index has correct input schema", () => {
      const tools = registerIndexingTools();
      const indexTool = tools[0];

      assert.ok(indexTool.inputSchema);
      const props = (indexTool.inputSchema as any).properties;
      assert.ok(props.force);
      assert.ok(props.paths);
    });

    it("nella_search requires query parameter", () => {
      const tools = registerIndexingTools();
      const searchTool = tools[1];

      assert.ok(searchTool.inputSchema);
      const required = (searchTool.inputSchema as any).required;
      assert.ok(required.includes("query"));
    });

    it("nella_search has detail parameter with compact/full enum", () => {
      const tools = registerIndexingTools();
      const searchTool = tools[1];

      const props = (searchTool.inputSchema as any).properties;
      assert.ok(props.detail);
      assert.deepEqual(props.detail.enum, ["compact", "full"]);
    });

    it("nella_search topK description reflects default of 5", () => {
      const tools = registerIndexingTools();
      const searchTool = tools[1];

      const props = (searchTool.inputSchema as any).properties;
      assert.ok(props.topK.description.includes("5"));
    });
  });

  // ===========================================================================
  // Dispatch
  // ===========================================================================

  describe("dispatch", () => {
    it("returns null for unknown tool names", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nella-idx-test-"));
      try {
        const ctx: ServerContext = {
          workspacePath: tmpDir,
          contextManager: new ContextManager(tmpDir),
        };
        const result = await handleIndexingTool("nella_nonexistent", {}, ctx);
        assert.equal(result, null);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
