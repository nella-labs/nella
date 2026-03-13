/**
 * Context MCP Tool Handler Tests
 *
 * Tests for nella_get_context, nella_add_assumption,
 * nella_check_assumptions, nella_check_dependencies.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ContextManager } from "@usenella/core";
import { handleContextTool } from "../context";
import type { ServerContext } from "../../server";

let tmpDir: string;
let ctx: ServerContext;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nella-ctx-tool-test-"));
  fs.mkdirSync(path.join(tmpDir, ".nella"), { recursive: true });
  // Create a package.json so dependency tracking works
  fs.writeFileSync(
    path.join(tmpDir, "package.json"),
    JSON.stringify({ name: "test", dependencies: { express: "^4.18.0" } })
  );
  const contextManager = new ContextManager(tmpDir);
  ctx = { workspacePath: tmpDir, contextManager };
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0].text;
}

describe("Context Tool Handlers", () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  // ===========================================================================
  // nella_get_context
  // ===========================================================================

  describe("nella_get_context", () => {
    it("returns session context with markdown formatting", async () => {
      const result = await handleContextTool("nella_get_context", {}, ctx);

      assert.ok(result);
      const text = getText(result!);
      assert.ok(text.includes("## Session Context"));
      assert.ok(text.includes("Session ID"));
      assert.ok(text.includes("### Statistics"));
    });

    it("respects changesLimit parameter", async () => {
      const result = await handleContextTool("nella_get_context", { changesLimit: 5 }, ctx);

      assert.ok(result);
      const text = getText(result!);
      assert.ok(text.includes("## Session Context"));
    });

    it("includes assumptions when present", async () => {
      // Add an assumption first
      ctx.contextManager.assumptions.addAssumption(
        "User model has email field",
        ["src/user.ts"],
        "interface",
        0.9
      );

      const result = await handleContextTool("nella_get_context", {}, ctx);

      const text = getText(result!);
      assert.ok(text.includes("Active Assumptions"));
      assert.ok(text.includes("User model has email field"));
    });
  });

  // ===========================================================================
  // nella_add_assumption
  // ===========================================================================

  describe("nella_add_assumption", () => {
    it("records an assumption and returns confirmation", async () => {
      const result = await handleContextTool("nella_add_assumption", {
        type: "interface",
        description: "User model has id and name fields",
        relatedFiles: ["src/types.ts"],
        confidence: 0.9,
      }, ctx);

      assert.ok(result);
      const text = getText(result!);
      assert.ok(text.includes("Assumption Recorded"));
      assert.ok(text.includes("User model has id and name fields"));
      assert.ok(text.includes("interface"));
      assert.ok(text.includes("90%"));
    });

    it("uses default confidence of 0.8", async () => {
      const result = await handleContextTool("nella_add_assumption", {
        type: "behavior",
        description: "Auth middleware validates JWT",
      }, ctx);

      assert.ok(result);
      const text = getText(result!);
      assert.ok(text.includes("80%"));
    });

    it("persists the assumption to session", async () => {
      await handleContextTool("nella_add_assumption", {
        type: "dependency",
        description: "Using express 4.x",
      }, ctx);

      const valid = ctx.contextManager.assumptions.getValidAssumptions();
      assert.equal(valid.length, 1);
      assert.equal(valid[0].description, "Using express 4.x");
    });
  });

  // ===========================================================================
  // nella_check_assumptions
  // ===========================================================================

  describe("nella_check_assumptions", () => {
    it("returns empty state when no assumptions exist", async () => {
      const result = await handleContextTool("nella_check_assumptions", {}, ctx);

      assert.ok(result);
      const text = getText(result!);
      assert.ok(text.includes("No assumptions recorded yet"));
      assert.equal(result!.isError, false);
    });

    it("lists valid assumptions", async () => {
      ctx.contextManager.assumptions.addAssumption("DB uses PostgreSQL", [], "config", 0.95);
      ctx.contextManager.assumptions.addAssumption("API uses REST", [], "behavior", 0.8);

      const result = await handleContextTool("nella_check_assumptions", {}, ctx);

      const text = getText(result!);
      assert.ok(text.includes("Valid: 2"));
      assert.ok(text.includes("DB uses PostgreSQL"));
      assert.ok(text.includes("API uses REST"));
    });

    it("sets isError when assumptions are invalidated", async () => {
      const assumption = ctx.contextManager.assumptions.addAssumption(
        "Config is static",
        ["config.ts"],
        "config",
        0.8
      );
      ctx.contextManager.assumptions.invalidate(assumption.id, "test", "Config changed");

      const result = await handleContextTool("nella_check_assumptions", {}, ctx);

      assert.ok(result);
      assert.equal(result!.isError, true);
      const text = getText(result!);
      assert.ok(text.includes("Invalidated"));
      assert.ok(text.includes("Config is static"));
    });
  });

  // ===========================================================================
  // nella_check_dependencies
  // ===========================================================================

  describe("nella_check_dependencies", () => {
    it("returns null/no-change on first call (creates initial snapshot)", async () => {
      const result = await handleContextTool("nella_check_dependencies", {}, ctx);

      assert.ok(result);
      const text = getText(result!);
      assert.ok(text.includes("No dependency changes") || text.includes("No previous snapshot"));
    });

    it("detects dependency changes on second call", async () => {
      // First call: take initial snapshot
      await handleContextTool("nella_check_dependencies", {}, ctx);

      // Modify package.json
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test",
          dependencies: { express: "^4.18.0", cors: "^2.8.5" },
        })
      );

      // Second call: detect changes
      const result = await handleContextTool("nella_check_dependencies", {}, ctx);

      assert.ok(result);
      const text = getText(result!);
      assert.ok(text.includes("Dependencies have changed") || text.includes("cors"));
      assert.equal(result!.isError, true);
    });

    it("reports no changes when nothing changed between calls", async () => {
      // First call
      await handleContextTool("nella_check_dependencies", {}, ctx);

      // Second call, same package.json
      const result = await handleContextTool("nella_check_dependencies", {}, ctx);

      assert.ok(result);
      const text = getText(result!);
      assert.ok(text.includes("No dependency changes"));
    });
  });

  // ===========================================================================
  // Dispatch
  // ===========================================================================

  describe("dispatch", () => {
    it("returns null for unknown tool names", async () => {
      const result = await handleContextTool("nella_nonexistent", {}, ctx);
      assert.equal(result, null);
    });
  });
});
