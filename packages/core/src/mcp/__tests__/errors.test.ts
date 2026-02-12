import test from "node:test";
import assert from "node:assert/strict";
import {
  McpError,
  ToolValidationError,
  ToolTimeoutError,
  AuthenticationError,
  RateLimitError,
  ChainDepthError,
  UnknownToolError,
  RetryExhaustedError,
} from "../errors";

// =============================================================================
// McpError (base)
// =============================================================================

test("McpError: stores code and message", () => {
  const err = new McpError("something broke", "TEST_CODE");
  assert.equal(err.message, "something broke");
  assert.equal(err.code, "TEST_CODE");
  assert.equal(err.name, "McpError");
  assert.ok(err instanceof Error);
});

// =============================================================================
// ToolValidationError
// =============================================================================

test("ToolValidationError: summarises field errors", () => {
  const err = new ToolValidationError("nella_search", [
    { field: "query", message: "Required field \"query\" is missing" },
    { field: "maxResults", message: "Expected type \"number\", got \"string\"" },
  ]);
  assert.equal(err.code, "VALIDATION_ERROR");
  assert.equal(err.errors.length, 2);
  assert.ok(err.message.includes("nella_search"));
  assert.ok(err.message.includes("query"));
  assert.ok(err instanceof McpError);
});

// =============================================================================
// ToolTimeoutError
// =============================================================================

test("ToolTimeoutError: exposes toolName and timeoutMs", () => {
  const err = new ToolTimeoutError("nella_index", 30000);
  assert.equal(err.toolName, "nella_index");
  assert.equal(err.timeoutMs, 30000);
  assert.equal(err.code, "TIMEOUT_ERROR");
  assert.ok(err.message.includes("30000"));
});

// =============================================================================
// AuthenticationError
// =============================================================================

test("AuthenticationError: sets AUTH_ERROR code", () => {
  const err = new AuthenticationError("bad token");
  assert.equal(err.code, "AUTH_ERROR");
  assert.equal(err.name, "AuthenticationError");
});

// =============================================================================
// RateLimitError
// =============================================================================

test("RateLimitError: stores retryAfter", () => {
  const err = new RateLimitError("too fast", 5000);
  assert.equal(err.retryAfter, 5000);
  assert.equal(err.code, "RATE_LIMIT_ERROR");
});

test("RateLimitError: retryAfter is optional", () => {
  const err = new RateLimitError("slow down");
  assert.equal(err.retryAfter, undefined);
});

// =============================================================================
// ChainDepthError
// =============================================================================

test("ChainDepthError: stores depth and maxDepth", () => {
  const err = new ChainDepthError(4, 3);
  assert.equal(err.depth, 4);
  assert.equal(err.maxDepth, 3);
  assert.equal(err.code, "CHAIN_DEPTH_ERROR");
  assert.ok(err.message.includes("4"));
  assert.ok(err.message.includes("3"));
});

// =============================================================================
// UnknownToolError
// =============================================================================

test("UnknownToolError: stores toolName", () => {
  const err = new UnknownToolError("nella_foo");
  assert.equal(err.toolName, "nella_foo");
  assert.equal(err.code, "UNKNOWN_TOOL");
  assert.ok(err.message.includes("nella_foo"));
});

// =============================================================================
// RetryExhaustedError
// =============================================================================

test("RetryExhaustedError: stores attempts and lastError", () => {
  const inner = new Error("network blip");
  const err = new RetryExhaustedError(4, inner);
  assert.equal(err.attempts, 4);
  assert.equal(err.lastError, inner);
  assert.equal(err.code, "RETRY_EXHAUSTED");
  assert.ok(err.message.includes("4"));
  assert.ok(err.message.includes("network blip"));
});
