/**
 * Authentication Middleware Tests
 *
 * Tests for apiKeyAuth and requireScope middleware.
 * Mocks Supabase for isolated unit testing.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// =============================================================================
// Mock helpers
// =============================================================================

function mockReq(overrides: Record<string, unknown> = {}): any {
  return {
    headers: {},
    requestId: "test-req-id",
    user: undefined,
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
// Supabase mock setup
// =============================================================================

let mockSupabaseData: any = null;
let mockSupabaseError: any = null;

// We need to mock the Supabase module BEFORE importing auth.ts.
// The auth module uses lazy require(), so we intercept Module._resolveFilename.
const Module = require("module");
const originalResolve = Module._resolveFilename;

// Track if we've set up the mock
let supabaseMocked = false;

function setupSupabaseMock() {
  if (supabaseMocked) return;

  const fakeModule = {
    createClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: mockSupabaseData,
              error: mockSupabaseError,
            }),
          }),
        }),
      }),
    }),
  };

  // Override require for @supabase/supabase-js
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function (id: string) {
    if (id === "@supabase/supabase-js") {
      return fakeModule;
    }
    return originalRequire.apply(this, arguments);
  };

  supabaseMocked = true;
}

// =============================================================================
// Tests
// =============================================================================

// Set env vars before import
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

setupSupabaseMock();

// Need to clear the cached supabase client before importing
// The module caches it in a module-level variable
let apiKeyAuth: any;
let requireScope: any;

// Dynamic import to ensure mocks are in place
beforeEach(async () => {
  // Reset mock data
  mockSupabaseData = {
    id: "key-123",
    user_id: "user-456",
    name: "Test Key",
    key_prefix: "nla_test",
    rate_limits: { requests_per_minute: 60, requests_per_hour: 1000, requests_per_day: 10000 },
    expires_at: null,
    revoked_at: null,
    scopes: ["workspaces:read", "search:read"],
  };
  mockSupabaseError = null;

  if (!apiKeyAuth) {
    const mod = await import("../auth");
    apiKeyAuth = mod.apiKeyAuth;
    requireScope = mod.requireScope;
  }
});

describe("apiKeyAuth", () => {
  it("returns 401 when no API key provided", async () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();
    const next = mockNext();

    await apiKeyAuth(req, res, next.fn);

    assert.ok(!next.called);
    assert.equal(res._status, 401);
    assert.equal(res._json.error.code, "AUTHENTICATION_REQUIRED");
  });

  it("extracts key from Authorization: Bearer header", async () => {
    const req = mockReq({
      headers: { authorization: "Bearer nla_test_key_123" },
    });
    const res = mockRes();
    const next = mockNext();

    await apiKeyAuth(req, res, next.fn);

    assert.ok(next.called, "next() should be called for valid key");
    assert.ok(req.user, "req.user should be populated");
    assert.equal(req.user.apiKeyId, "key-123");
    assert.equal(req.user.userId, "user-456");
  });

  it("extracts key from X-API-Key header", async () => {
    const req = mockReq({
      headers: { "x-api-key": "nla_test_key_123" },
    });
    const res = mockRes();
    const next = mockNext();

    await apiKeyAuth(req, res, next.fn);

    assert.ok(next.called);
    assert.ok(req.user);
  });

  it("returns 401 for invalid/unknown key", async () => {
    mockSupabaseData = null;
    mockSupabaseError = { message: "not found" };

    const req = mockReq({
      headers: { authorization: "Bearer nla_invalid_key" },
    });
    const res = mockRes();
    const next = mockNext();

    await apiKeyAuth(req, res, next.fn);

    assert.ok(!next.called);
    assert.equal(res._status, 401);
    assert.equal(res._json.error.code, "INVALID_API_KEY");
  });

  it("returns 401 for revoked key", async () => {
    mockSupabaseData = {
      ...mockSupabaseData,
      revoked_at: "2025-01-01T00:00:00Z",
    };

    const req = mockReq({
      headers: { authorization: "Bearer nla_revoked_key" },
    });
    const res = mockRes();
    const next = mockNext();

    await apiKeyAuth(req, res, next.fn);

    assert.ok(!next.called);
    assert.equal(res._status, 401);
    assert.equal(res._json.error.code, "API_KEY_REVOKED");
  });

  it("returns 401 for expired key", async () => {
    mockSupabaseData = {
      ...mockSupabaseData,
      revoked_at: null,
      expires_at: "2020-01-01T00:00:00Z", // far in the past
    };

    const req = mockReq({
      headers: { authorization: "Bearer nla_expired_key" },
    });
    const res = mockRes();
    const next = mockNext();

    await apiKeyAuth(req, res, next.fn);

    assert.ok(!next.called);
    assert.equal(res._status, 401);
    assert.equal(res._json.error.code, "API_KEY_EXPIRED");
  });

  it("populates req.user with correct scopes", async () => {
    mockSupabaseData = {
      ...mockSupabaseData,
      scopes: ["admin", "workspaces:write"],
    };

    const req = mockReq({
      headers: { authorization: "Bearer nla_admin_key" },
    });
    const res = mockRes();
    const next = mockNext();

    await apiKeyAuth(req, res, next.fn);

    assert.ok(next.called);
    assert.deepEqual(req.user.scopes, ["admin", "workspaces:write"]);
  });

  it("uses default scopes when none specified", async () => {
    mockSupabaseData = {
      ...mockSupabaseData,
      scopes: null,
    };

    const req = mockReq({
      headers: { authorization: "Bearer nla_default_key" },
    });
    const res = mockRes();
    const next = mockNext();

    await apiKeyAuth(req, res, next.fn);

    assert.ok(next.called);
    assert.deepEqual(req.user.scopes, [
      "workspaces:read", "search:read", "validate:run", "context:read",
    ]);
  });

  it("uses default rate limits when none specified", async () => {
    mockSupabaseData = {
      ...mockSupabaseData,
      rate_limits: null,
    };

    const req = mockReq({
      headers: { authorization: "Bearer nla_no_limits_key" },
    });
    const res = mockRes();
    const next = mockNext();

    await apiKeyAuth(req, res, next.fn);

    assert.ok(next.called);
    assert.equal(req.user.rateLimits.requests_per_minute, 60);
    assert.equal(req.user.rateLimits.requests_per_hour, 1000);
    assert.equal(req.user.rateLimits.requests_per_day, 10000);
  });

  it("does not extract non-nella Bearer tokens", async () => {
    const req = mockReq({
      headers: { authorization: "Bearer some_other_token" },
    });
    const res = mockRes();
    const next = mockNext();

    await apiKeyAuth(req, res, next.fn);

    assert.ok(!next.called);
    assert.equal(res._status, 401);
    assert.equal(res._json.error.code, "AUTHENTICATION_REQUIRED");
  });
});

// =============================================================================
// requireScope
// =============================================================================

describe("requireScope", () => {
  it("calls next() when user has the required scope", () => {
    const req = mockReq({
      user: { apiKeyId: "k1", userId: "u1", scopes: ["workspaces:read"], rateLimits: {} },
    });
    const res = mockRes();
    const next = mockNext();

    requireScope("workspaces:read")(req, res, next.fn);

    assert.ok(next.called);
  });

  it("calls next() when user has admin scope", () => {
    const req = mockReq({
      user: { apiKeyId: "k1", userId: "u1", scopes: ["admin"], rateLimits: {} },
    });
    const res = mockRes();
    const next = mockNext();

    requireScope("workspaces:write")(req, res, next.fn);

    assert.ok(next.called, "admin scope should bypass any specific scope check");
  });

  it("returns 403 when user lacks the required scope", () => {
    const req = mockReq({
      user: { apiKeyId: "k1", userId: "u1", scopes: ["search:read"], rateLimits: {} },
    });
    const res = mockRes();
    const next = mockNext();

    requireScope("workspaces:write")(req, res, next.fn);

    assert.ok(!next.called);
    assert.equal(res._status, 403);
    assert.equal(res._json.error.code, "INSUFFICIENT_SCOPE");
  });

  it("returns 401 when no user is attached", () => {
    const req = mockReq({ user: undefined });
    const res = mockRes();
    const next = mockNext();

    requireScope("workspaces:read")(req, res, next.fn);

    assert.ok(!next.called);
    assert.equal(res._status, 401);
    assert.equal(res._json.error.code, "AUTHENTICATION_REQUIRED");
  });
});
