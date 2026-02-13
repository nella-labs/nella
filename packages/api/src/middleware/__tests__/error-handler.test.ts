/**
 * Error Handler Middleware Tests
 *
 * Tests for notFoundHandler and errorHandler.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { notFoundHandler, errorHandler } from "../error-handler";
import { ApiError, ValidationError, NotFoundError } from "../../utils/errors";

// =============================================================================
// Mock helpers
// =============================================================================

function mockReq(overrides: Record<string, unknown> = {}): any {
  return {
    method: "GET",
    path: "/test",
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

// =============================================================================
// notFoundHandler
// =============================================================================

describe("notFoundHandler", () => {
  it("returns 404 with correct error shape", () => {
    const req = mockReq({ method: "GET", path: "/foo/bar" });
    const res = mockRes();

    notFoundHandler(req, res, () => {});

    assert.equal(res._status, 404);
    assert.equal(res._json.error.code, "NOT_FOUND");
    assert.ok(res._json.error.message.includes("GET"));
    assert.ok(res._json.error.message.includes("/foo/bar"));
    assert.equal(res._json.error.requestId, "test-req-id");
  });

  it("includes method and path in message", () => {
    const req = mockReq({ method: "POST", path: "/api/v1/unknown" });
    const res = mockRes();

    notFoundHandler(req, res, () => {});

    assert.ok(res._json.error.message.includes("POST"));
    assert.ok(res._json.error.message.includes("/api/v1/unknown"));
  });

  it("defaults requestId to 'unknown' when missing", () => {
    const req = mockReq({});
    delete req.requestId;
    const res = mockRes();

    notFoundHandler(req, res, () => {});

    assert.equal(res._json.error.requestId, "unknown");
  });
});

// =============================================================================
// errorHandler
// =============================================================================

describe("errorHandler", () => {
  it("handles ApiError with correct status and code", () => {
    const err = new ApiError(422, "UNPROCESSABLE", "Cannot process");
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, () => {});

    assert.equal(res._status, 422);
    assert.equal(res._json.error.code, "UNPROCESSABLE");
    assert.equal(res._json.error.message, "Cannot process");
    assert.equal(res._json.error.requestId, "test-req-id");
  });

  it("includes details in ApiError response", () => {
    const details = [{ field: "name", message: "required" }];
    const err = new ApiError(400, "VALIDATION_ERROR", "Bad input", details);
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, () => {});

    assert.equal(res._status, 400);
    assert.deepEqual(res._json.error.details, details);
  });

  it("handles ValidationError (subclass of ApiError)", () => {
    const err = new ValidationError("Invalid email");
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, () => {});

    assert.equal(res._status, 400);
    assert.equal(res._json.error.code, "VALIDATION_ERROR");
  });

  it("handles NotFoundError", () => {
    const err = new NotFoundError("Workspace", "ws-123");
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, () => {});

    assert.equal(res._status, 404);
    assert.equal(res._json.error.code, "NOT_FOUND");
    assert.ok(res._json.error.message.includes("ws-123"));
  });

  it("handles ZodError", () => {
    const err = Object.assign(new Error("validation"), {
      name: "ZodError",
      issues: [{ path: ["name"], message: "Required" }],
    });
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, () => {});

    assert.equal(res._status, 400);
    assert.equal(res._json.error.code, "VALIDATION_ERROR");
    assert.ok(Array.isArray(res._json.error.details));
  });

  it("handles JSON parse errors", () => {
    const err = Object.assign(new Error("Unexpected token"), {
      type: "entity.parse.failed",
    });
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, () => {});

    assert.equal(res._status, 400);
    assert.equal(res._json.error.code, "INVALID_JSON");
  });

  it("handles unexpected errors with 500", () => {
    const err = new Error("Something broke");
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, () => {});

    assert.equal(res._status, 500);
    assert.equal(res._json.error.code, "INTERNAL_ERROR");
  });

  it("hides error details in production", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const err = new Error("secret internal detail");
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, () => {});

    assert.equal(res._status, 500);
    assert.equal(res._json.error.message, "Internal server error");

    process.env.NODE_ENV = originalEnv;
  });

  it("shows error message in non-production", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const err = new Error("detailed error info");
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, () => {});

    assert.equal(res._status, 500);
    assert.equal(res._json.error.message, "detailed error info");

    process.env.NODE_ENV = originalEnv;
  });
});
