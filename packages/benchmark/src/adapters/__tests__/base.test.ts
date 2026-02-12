import test from "node:test";
import assert from "node:assert/strict";
import { AgentAdapter, type AgentAdapterOptions, type AgentAdapterResult } from "../base";

// Concrete subclass that exposes protected parseResponse for testing
class TestAdapter extends AgentAdapter {
  constructor() {
    super("test-key", "test-model");
  }

  async call(_options: AgentAdapterOptions): Promise<AgentAdapterResult> {
    throw new Error("Not implemented");
  }

  // Expose protected method for testing
  public testParseResponse(raw: string) {
    return this["parseResponse"](raw);
  }
}

// =============================================================================
// getModel
// =============================================================================

test("AgentAdapter: getModel returns model name", () => {
  const adapter = new TestAdapter();
  assert.equal(adapter.getModel(), "test-model");
});

// =============================================================================
// parseResponse: JSON in code block
// =============================================================================

test("parseResponse: parses JSON from code block", () => {
  const raw = '```json\n{"action":"edit","files":[{"path":"a.ts","operation":"modify","content":"new"}],"explanation":"done"}\n```';
  const result = new TestAdapter().testParseResponse(raw);
  assert.equal(result.action, "edit");
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].path, "a.ts");
  assert.equal(result.explanation, "done");
});

// =============================================================================
// parseResponse: raw JSON
// =============================================================================

test("parseResponse: parses raw JSON string", () => {
  const raw = '{"action":"refuse","files":[],"explanation":"not safe","reason":"security"}';
  const result = new TestAdapter().testParseResponse(raw);
  assert.equal(result.action, "refuse");
  assert.equal(result.files.length, 0);
  assert.equal(result.reason, "security");
});

// =============================================================================
// parseResponse: refusal detection
// =============================================================================

test("parseResponse: detects refusal from natural language", () => {
  const raw = "I can't do that because it would expose sensitive data.";
  const result = new TestAdapter().testParseResponse(raw);
  assert.equal(result.action, "refuse");
  assert.equal(result.files.length, 0);
});

test("parseResponse: detects refusal with credentials keyword", () => {
  const result = new TestAdapter().testParseResponse(
    "This request involves credentials and I shouldn't proceed."
  );
  assert.equal(result.action, "refuse");
});

test("parseResponse: detects refusal with security risk", () => {
  const result = new TestAdapter().testParseResponse(
    "Doing this represents a security risk to the application."
  );
  assert.equal(result.action, "refuse");
});

// =============================================================================
// parseResponse: invalid JSON without refusal
// =============================================================================

test("parseResponse: throws on unparseable non-refusal text", () => {
  assert.throws(
    () => new TestAdapter().testParseResponse("Here is the updated code for you."),
    /Failed to parse agent response/
  );
});

// =============================================================================
// validateAgentResponse (tested indirectly via parseResponse)
// =============================================================================

test("parseResponse: rejects non-object response", () => {
  assert.throws(
    () => new TestAdapter().testParseResponse('"just a string"'),
    /Failed to parse agent response/
  );
});

test("parseResponse: rejects invalid action", () => {
  assert.throws(
    () => new TestAdapter().testParseResponse('{"action":"delete","files":[],"explanation":"x"}'),
    /Failed to parse agent response/
  );
});

test("parseResponse: rejects non-array files", () => {
  assert.throws(
    () => new TestAdapter().testParseResponse('{"action":"edit","files":"none","explanation":"x"}'),
    /Failed to parse agent response/
  );
});

test("parseResponse: defaults missing file fields", () => {
  const raw = '{"action":"edit","files":[{}],"explanation":"x"}';
  const result = new TestAdapter().testParseResponse(raw);
  assert.equal(result.files[0].path, "");
  assert.equal(result.files[0].operation, "modify");
  assert.equal(result.files[0].content, "");
});

test("parseResponse: defaults missing explanation", () => {
  const raw = '{"action":"edit","files":[]}';
  const result = new TestAdapter().testParseResponse(raw);
  assert.equal(result.explanation, "");
});

// =============================================================================
// parseResponse: multiple files
// =============================================================================

test("parseResponse: handles multiple files", () => {
  const raw = JSON.stringify({
    action: "edit",
    files: [
      { path: "a.ts", operation: "create", content: "// new" },
      { path: "b.ts", operation: "delete", content: "" },
    ],
    explanation: "multi-file edit",
  });

  const result = new TestAdapter().testParseResponse(raw);
  assert.equal(result.files.length, 2);
  assert.equal(result.files[0].operation, "create");
  assert.equal(result.files[1].operation, "delete");
});
