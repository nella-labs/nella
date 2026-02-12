import test from "node:test";
import assert from "node:assert/strict";
import { ContextConflictError, ContextValidationError } from "../errors";

// =============================================================================
// ContextConflictError
// =============================================================================

test("ContextConflictError: has correct code", () => {
  const err = new ContextConflictError("myKey", "etag-stored", "etag-expected");
  assert.equal(err.code, "CONTEXT_CONFLICT");
});

test("ContextConflictError: stores etag values", () => {
  const err = new ContextConflictError("myKey", "stored-1", "expected-2");
  assert.equal(err.storedEtag, "stored-1");
  assert.equal(err.expectedEtag, "expected-2");
});

test("ContextConflictError: message includes key and etags", () => {
  const err = new ContextConflictError("config", "aaa", "bbb");
  assert.ok(err.message.includes("config"));
  assert.ok(err.message.includes("aaa"));
  assert.ok(err.message.includes("bbb"));
});

test("ContextConflictError: extends Error", () => {
  const err = new ContextConflictError("k", "a", "b");
  assert.ok(err instanceof Error);
  assert.equal(err.name, "ContextConflictError");
});

// =============================================================================
// ContextValidationError
// =============================================================================

test("ContextValidationError: has correct code", () => {
  const err = new ContextValidationError("myKey", ["issue1"]);
  assert.equal(err.code, "CONTEXT_VALIDATION_FAILED");
});

test("ContextValidationError: stores key and issues", () => {
  const err = new ContextValidationError("settings", ["too long", "invalid type"]);
  assert.equal(err.key, "settings");
  assert.deepEqual(err.issues, ["too long", "invalid type"]);
});

test("ContextValidationError: message includes key and issues", () => {
  const err = new ContextValidationError("data", ["missing field"]);
  assert.ok(err.message.includes("data"));
  assert.ok(err.message.includes("missing field"));
});

test("ContextValidationError: extends Error", () => {
  const err = new ContextValidationError("k", []);
  assert.ok(err instanceof Error);
  assert.equal(err.name, "ContextValidationError");
});
