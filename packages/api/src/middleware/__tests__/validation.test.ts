/**
 * Validation Middleware Tests
 *
 * Tests for validateBody, validateQuery, and validateParams middleware.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { validateBody, validateQuery, validateParams } from "../validation";

// =============================================================================
// Mock helpers
// =============================================================================

function mockReq(overrides: Record<string, unknown> = {}): any {
  return {
    body: {},
    query: {},
    params: {},
    requestId: "test-req-id",
    ...overrides,
  };
}

function mockRes(): any {
  const res: any = {
    _status: 0,
    _json: null,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: unknown) {
      res._json = data;
      return res;
    },
  };
  return res;
}

function mockNext(): { fn: () => void; called: boolean } {
  const tracker = { called: false, fn: () => { tracker.called = true; } };
  return tracker;
}

// =============================================================================
// validateBody
// =============================================================================

describe("validateBody", () => {
  const schema = z.object({
    name: z.string().min(1),
    count: z.number().int().positive(),
  });

  it("calls next() when body matches schema", () => {
    const req = mockReq({ body: { name: "hello", count: 5 } });
    const res = mockRes();
    const next = mockNext();

    validateBody(schema)(req, res, next.fn);

    assert.ok(next.called, "next() should be called");
    assert.equal(res._status, 0, "should not set status");
    assert.equal(req.body.name, "hello");
    assert.equal(req.body.count, 5);
  });

  it("returns 400 when body is missing required fields", () => {
    const req = mockReq({ body: {} });
    const res = mockRes();
    const next = mockNext();

    validateBody(schema)(req, res, next.fn);

    assert.ok(!next.called, "next() should NOT be called");
    assert.equal(res._status, 400);
    assert.equal(res._json.error.code, "VALIDATION_ERROR");
    assert.equal(res._json.error.message, "Request body validation failed");
    assert.ok(Array.isArray(res._json.error.details));
    assert.ok(res._json.error.details.length > 0);
  });

  it("returns 400 when body has wrong types", () => {
    const req = mockReq({ body: { name: "hello", count: "not-a-number" } });
    const res = mockRes();
    const next = mockNext();

    validateBody(schema)(req, res, next.fn);

    assert.ok(!next.called);
    assert.equal(res._status, 400);
    assert.equal(res._json.error.code, "VALIDATION_ERROR");
  });

  it("replaces req.body with parsed data (coercion)", () => {
    const coerceSchema = z.object({
      enabled: z.coerce.boolean(),
    });

    const req = mockReq({ body: { enabled: "true" } });
    const res = mockRes();
    const next = mockNext();

    validateBody(coerceSchema)(req, res, next.fn);

    assert.ok(next.called);
    assert.equal(req.body.enabled, true);
  });

  it("strips unknown fields with strict schema", () => {
    const strictSchema = z.object({ name: z.string() }).strict();

    const req = mockReq({ body: { name: "hello", extra: "field" } });
    const res = mockRes();
    const next = mockNext();

    validateBody(strictSchema)(req, res, next.fn);

    assert.ok(!next.called);
    assert.equal(res._status, 400);
  });

  it("includes requestId in error response", () => {
    const req = mockReq({ body: {}, requestId: "req-abc-123" });
    const res = mockRes();
    const next = mockNext();

    validateBody(schema)(req, res, next.fn);

    assert.equal(res._json.error.requestId, "req-abc-123");
  });
});

// =============================================================================
// validateQuery
// =============================================================================

describe("validateQuery", () => {
  const schema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });

  it("calls next() with valid query params", () => {
    const req = mockReq({ query: { page: "2", limit: "50" } });
    const res = mockRes();
    const next = mockNext();

    validateQuery(schema)(req, res, next.fn);

    assert.ok(next.called);
    assert.equal(req.query.page, 2);
    assert.equal(req.query.limit, 50);
  });

  it("applies defaults for missing optional params", () => {
    const req = mockReq({ query: {} });
    const res = mockRes();
    const next = mockNext();

    validateQuery(schema)(req, res, next.fn);

    assert.ok(next.called);
    assert.equal(req.query.page, 1);
    assert.equal(req.query.limit, 20);
  });

  it("returns 400 for invalid query params", () => {
    const req = mockReq({ query: { page: "abc" } });
    const res = mockRes();
    const next = mockNext();

    validateQuery(schema)(req, res, next.fn);

    assert.ok(!next.called);
    assert.equal(res._status, 400);
    assert.equal(res._json.error.code, "VALIDATION_ERROR");
    assert.equal(res._json.error.message, "Query parameter validation failed");
  });

  it("returns 400 when limit exceeds max", () => {
    const req = mockReq({ query: { limit: "999" } });
    const res = mockRes();
    const next = mockNext();

    validateQuery(schema)(req, res, next.fn);

    assert.ok(!next.called);
    assert.equal(res._status, 400);
  });
});

// =============================================================================
// validateParams
// =============================================================================

describe("validateParams", () => {
  const schema = z.object({
    id: z.string().uuid(),
  });

  it("calls next() with valid UUID param", () => {
    const req = mockReq({ params: { id: "550e8400-e29b-41d4-a716-446655440000" } });
    const res = mockRes();
    const next = mockNext();

    validateParams(schema)(req, res, next.fn);

    assert.ok(next.called);
    assert.equal(req.params.id, "550e8400-e29b-41d4-a716-446655440000");
  });

  it("returns 400 for invalid UUID param", () => {
    const req = mockReq({ params: { id: "not-a-uuid" } });
    const res = mockRes();
    const next = mockNext();

    validateParams(schema)(req, res, next.fn);

    assert.ok(!next.called);
    assert.equal(res._status, 400);
    assert.equal(res._json.error.code, "VALIDATION_ERROR");
    assert.equal(res._json.error.message, "URL parameter validation failed");
  });

  it("returns 400 when param is missing", () => {
    const req = mockReq({ params: {} });
    const res = mockRes();
    const next = mockNext();

    validateParams(schema)(req, res, next.fn);

    assert.ok(!next.called);
    assert.equal(res._status, 400);
  });
});
