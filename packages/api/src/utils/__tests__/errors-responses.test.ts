/**
 * API Utilities Tests
 *
 * Tests for custom error classes, response helpers, and pagination.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  ValidationError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalError,
} from "../errors";
import { sendSuccess, sendCreated, sendNoContent, sendError } from "../responses";

// =============================================================================
// Error Classes
// =============================================================================

describe("ApiError", () => {
  it("creates error with status, code, and message", () => {
    const err = new ApiError(400, "BAD_REQUEST", "Invalid input");
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, "BAD_REQUEST");
    assert.equal(err.message, "Invalid input");
    assert.equal(err.name, "ApiError");
    assert.ok(err instanceof Error);
  });

  it("includes optional details", () => {
    const details = { field: "email" };
    const err = new ApiError(400, "VALIDATION", "bad", details);
    assert.deepEqual(err.details, details);
  });
});

describe("ValidationError", () => {
  it("uses 400 status and VALIDATION_ERROR code", () => {
    const err = new ValidationError("bad input");
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, "VALIDATION_ERROR");
    assert.ok(err instanceof ApiError);
  });
});

describe("AuthenticationError", () => {
  it("uses 401 status with default message", () => {
    const err = new AuthenticationError();
    assert.equal(err.statusCode, 401);
    assert.equal(err.code, "AUTHENTICATION_ERROR");
    assert.ok(err.message.includes("authentication"));
  });
});

describe("ForbiddenError", () => {
  it("uses 403 status", () => {
    const err = new ForbiddenError();
    assert.equal(err.statusCode, 403);
    assert.equal(err.code, "FORBIDDEN");
  });
});

describe("NotFoundError", () => {
  it("formats message with resource and id", () => {
    const err = new NotFoundError("Workspace", "ws-123");
    assert.equal(err.statusCode, 404);
    assert.ok(err.message.includes("Workspace"));
    assert.ok(err.message.includes("ws-123"));
  });

  it("formats message without id", () => {
    const err = new NotFoundError("User");
    assert.ok(err.message.includes("User"));
    assert.ok(!err.message.includes("undefined"));
  });
});

describe("ConflictError", () => {
  it("uses 409 status", () => {
    const err = new ConflictError("Already exists");
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, "CONFLICT");
  });
});

describe("RateLimitError", () => {
  it("uses 429 status and stores retryAfter", () => {
    const err = new RateLimitError(30);
    assert.equal(err.statusCode, 429);
    assert.equal(err.code, "RATE_LIMIT_EXCEEDED");
    assert.equal(err.retryAfter, 30);
  });
});

describe("InternalError", () => {
  it("uses 500 status with default message", () => {
    const err = new InternalError();
    assert.equal(err.statusCode, 500);
    assert.equal(err.code, "INTERNAL_ERROR");
    assert.equal(err.message, "Internal server error");
  });
});

// =============================================================================
// Response Helpers
// =============================================================================

function mockRes(): any {
  const res: any = {
    _status: 0,
    _json: null,
    _ended: false,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: unknown) {
      res._json = data;
      return res;
    },
    end() {
      res._ended = true;
      return res;
    },
  };
  return res;
}

function mockReq(requestId = "test-id"): any {
  return { requestId };
}

describe("sendSuccess", () => {
  it("sends 200 with data wrapper", () => {
    const res = mockRes();
    sendSuccess(res, { id: 1, name: "test" });

    assert.equal(res._status, 200);
    assert.deepEqual(res._json.data, { id: 1, name: "test" });
    assert.equal(res._json.meta, undefined);
  });

  it("includes meta when provided", () => {
    const res = mockRes();
    sendSuccess(res, [1, 2], { total: 100, page: 1 });

    assert.equal(res._status, 200);
    assert.deepEqual(res._json.data, [1, 2]);
    assert.deepEqual(res._json.meta, { total: 100, page: 1 });
  });

  it("supports custom status code", () => {
    const res = mockRes();
    sendSuccess(res, null, undefined, 202);
    assert.equal(res._status, 202);
  });
});

describe("sendCreated", () => {
  it("sends 201 with data", () => {
    const res = mockRes();
    sendCreated(res, { id: "new-1" });

    assert.equal(res._status, 201);
    assert.deepEqual(res._json.data, { id: "new-1" });
  });
});

describe("sendNoContent", () => {
  it("sends 204 with no body", () => {
    const res = mockRes();
    sendNoContent(res);

    assert.equal(res._status, 204);
    assert.ok(res._ended);
  });
});

describe("sendError", () => {
  it("sends error with correct shape", () => {
    const res = mockRes();
    const req = mockReq("req-456");

    sendError(res, req, 400, "VALIDATION_ERROR", "Bad input");

    assert.equal(res._status, 400);
    assert.equal(res._json.error.code, "VALIDATION_ERROR");
    assert.equal(res._json.error.message, "Bad input");
    assert.equal(res._json.error.requestId, "req-456");
    assert.equal(res._json.error.details, undefined);
  });

  it("includes details when provided", () => {
    const res = mockRes();
    const req = mockReq();

    sendError(res, req, 422, "INVALID", "oops", [{ field: "x" }]);

    assert.deepEqual(res._json.error.details, [{ field: "x" }]);
  });

  it("defaults requestId to 'unknown'", () => {
    const res = mockRes();
    const req = { requestId: undefined } as any;

    sendError(res, req, 500, "ERR", "fail");

    assert.equal(res._json.error.requestId, "unknown");
  });
});
