/**
 * Rate Limit Middleware Tests
 *
 * Tests for createRateLimitMiddleware with in-memory fallback.
 * No Redis needed — tests the fallback path.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRateLimitMiddleware } from "../rate-limit";

// Ensure no Redis is available for tests (force in-memory fallback)
delete process.env.REDIS_URL;

// =============================================================================
// Mock helpers
// =============================================================================

function mockReq(overrides: Record<string, unknown> = {}): any {
  return {
    user: {
      apiKeyId: "test-key-1",
      userId: "user-1",
      scopes: ["workspaces:read"],
      rateLimits: {
        requests_per_minute: 5,
        requests_per_hour: 100,
        requests_per_day: 1000,
      },
    },
    requestId: "test-req-id",
    ...overrides,
  };
}

function mockRes(): any {
  const res: any = {
    _status: 0,
    _json: null,
    _headers: {} as Record<string, string>,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: unknown) {
      res._json = data;
      return res;
    },
    set(key: string, value: string) {
      res._headers[key] = value;
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
// Tests
// =============================================================================

describe("createRateLimitMiddleware", () => {
  it("creates a middleware function", () => {
    const middleware = createRateLimitMiddleware();
    assert.equal(typeof middleware, "function");
  });

  it("passes through when no user is attached", async () => {
    const middleware = createRateLimitMiddleware();
    const req = mockReq({ user: undefined });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next.fn);

    assert.ok(next.called);
  });

  it("sets rate limit headers on response", async () => {
    const middleware = createRateLimitMiddleware();
    const req = mockReq({
      user: {
        apiKeyId: "header-test-key",
        userId: "u1",
        scopes: [],
        rateLimits: { requests_per_minute: 60, requests_per_hour: 1000, requests_per_day: 10000 },
      },
    });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next.fn);

    assert.ok(next.called);
    assert.ok(res._headers["X-RateLimit-Limit"]);
    assert.ok(res._headers["X-RateLimit-Remaining"]);
    assert.ok(res._headers["X-RateLimit-Reset"]);
    assert.equal(res._headers["X-RateLimit-Limit"], "60");
  });

  it("decrements remaining count on repeated requests", async () => {
    const middleware = createRateLimitMiddleware();
    const userId = `decrement-test-${Date.now()}`;

    // First request
    const req1 = mockReq({
      user: {
        apiKeyId: userId,
        userId: "u1",
        scopes: [],
        rateLimits: { requests_per_minute: 10, requests_per_hour: 1000, requests_per_day: 10000 },
      },
    });
    const res1 = mockRes();
    const next1 = mockNext();
    await middleware(req1, res1, next1.fn);

    // Second request
    const req2 = mockReq({
      user: {
        apiKeyId: userId,
        userId: "u1",
        scopes: [],
        rateLimits: { requests_per_minute: 10, requests_per_hour: 1000, requests_per_day: 10000 },
      },
    });
    const res2 = mockRes();
    const next2 = mockNext();
    await middleware(req2, res2, next2.fn);

    const remaining1 = parseInt(res1._headers["X-RateLimit-Remaining"]);
    const remaining2 = parseInt(res2._headers["X-RateLimit-Remaining"]);

    assert.ok(remaining2 < remaining1, "Remaining should decrease");
  });

  it("returns 429 when limit is exceeded", async () => {
    const middleware = createRateLimitMiddleware();
    const userId = `exceeded-test-${Date.now()}`;

    // Exceed the limit (set to 2 requests per minute)
    for (let i = 0; i < 3; i++) {
      const req = mockReq({
        user: {
          apiKeyId: userId,
          userId: "u1",
          scopes: [],
          rateLimits: { requests_per_minute: 2, requests_per_hour: 1000, requests_per_day: 10000 },
        },
      });
      const res = mockRes();
      const next = mockNext();

      await middleware(req, res, next.fn);

      if (i < 2) {
        assert.ok(next.called, `Request ${i + 1} should pass`);
      } else {
        // Third request should be rate limited
        assert.ok(!next.called, "Third request should be blocked");
        assert.equal(res._status, 429);
        assert.equal(res._json.error.code, "RATE_LIMIT_EXCEEDED");
        assert.ok(res._headers["Retry-After"]);
      }
    }
  });

  it("uses different counters for different API keys", async () => {
    const middleware = createRateLimitMiddleware();
    const ts = Date.now();

    const req1 = mockReq({
      user: {
        apiKeyId: `key-a-${ts}`,
        userId: "u1",
        scopes: [],
        rateLimits: { requests_per_minute: 5, requests_per_hour: 1000, requests_per_day: 10000 },
      },
    });
    const res1 = mockRes();
    const next1 = mockNext();
    await middleware(req1, res1, next1.fn);

    const req2 = mockReq({
      user: {
        apiKeyId: `key-b-${ts}`,
        userId: "u2",
        scopes: [],
        rateLimits: { requests_per_minute: 5, requests_per_hour: 1000, requests_per_day: 10000 },
      },
    });
    const res2 = mockRes();
    const next2 = mockNext();
    await middleware(req2, res2, next2.fn);

    // Both should pass and have full remaining count
    assert.ok(next1.called);
    assert.ok(next2.called);
    assert.equal(res1._headers["X-RateLimit-Remaining"], "4");
    assert.equal(res2._headers["X-RateLimit-Remaining"], "4");
  });
});
