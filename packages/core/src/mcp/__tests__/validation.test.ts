import test from "node:test";
import assert from "node:assert/strict";
import { validateToolInput, assertValidToolInput } from "../validation";
import { ToolValidationError } from "../errors";
import type { McpTool } from "../types";

// =============================================================================
// Helpers
// =============================================================================

function makeTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    name: "test_tool",
    description: "A test tool",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "search query",
        },
        maxResults: {
          type: "number",
          description: "max results",
        },
        verbose: {
          type: "boolean",
          description: "verbose flag",
        },
        tags: {
          type: "array",
          description: "tags",
          items: { type: "string" },
        },
      },
      required: ["query"],
    },
    ...overrides,
  };
}

// =============================================================================
// validateToolInput
// =============================================================================

test("validateToolInput: valid input returns valid=true", () => {
  const tool = makeTool();
  const result = validateToolInput(tool, { query: "hello" });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validateToolInput: missing required field", () => {
  const tool = makeTool();
  const result = validateToolInput(tool, {});
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].field, "query");
  assert.ok(result.errors[0].message.includes("missing"));
});

test("validateToolInput: wrong type", () => {
  const tool = makeTool();
  const result = validateToolInput(tool, { query: "hi", maxResults: "abc" });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].field, "maxResults");
});

test("validateToolInput: number coercion from string", () => {
  const tool = makeTool();
  const result = validateToolInput(tool, { query: "hi", maxResults: "10" });
  assert.equal(result.valid, true);
});

test("validateToolInput: boolean coercion from string", () => {
  const tool = makeTool();
  const result = validateToolInput(tool, { query: "hi", verbose: "true" });
  assert.equal(result.valid, true);
});

test("validateToolInput: invalid boolean string fails", () => {
  const tool = makeTool();
  const result = validateToolInput(tool, { query: "hi", verbose: "yes" });
  assert.equal(result.valid, false);
});

test("validateToolInput: enum enforcement", () => {
  const tool = makeTool({
    inputSchema: {
      type: "object" as const,
      properties: {
        mode: {
          type: "string",
          description: "mode",
          enum: ["brief", "detailed"],
        },
      },
      required: ["mode"],
    },
  });
  const ok = validateToolInput(tool, { mode: "brief" });
  assert.equal(ok.valid, true);

  const bad = validateToolInput(tool, { mode: "verbose" });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors[0].message.includes("brief"));
});

test("validateToolInput: array item type checking", () => {
  const tool = makeTool();
  const result = validateToolInput(tool, { query: "hi", tags: ["a", 123] });
  assert.equal(result.valid, false);
  assert.ok(result.errors[0].field.includes("tags[1]"));
});

test("validateToolInput: extra fields are allowed", () => {
  const tool = makeTool();
  const result = validateToolInput(tool, { query: "hi", unknownField: "ok" });
  assert.equal(result.valid, true);
});

test("validateToolInput: null required field counts as missing", () => {
  const tool = makeTool();
  const result = validateToolInput(tool, { query: null });
  assert.equal(result.valid, false);
});

// =============================================================================
// assertValidToolInput
// =============================================================================

test("assertValidToolInput: does not throw for valid input", () => {
  const tool = makeTool();
  assert.doesNotThrow(() => assertValidToolInput(tool, { query: "ok" }));
});

test("assertValidToolInput: throws ToolValidationError for invalid input", () => {
  const tool = makeTool();
  assert.throws(
    () => assertValidToolInput(tool, {}),
    (err: unknown) => err instanceof ToolValidationError,
  );
});
