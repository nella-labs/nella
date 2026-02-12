import test from "node:test";
import assert from "node:assert/strict";
import { createAuthMiddleware } from "../middleware/auth";

test("auth middleware validateToken rejects empty token", async () => {
  const auth = createAuthMiddleware({});
  const result = await auth.validateToken("");
  assert.equal(result.valid, false);
  assert.equal(result.error, "No token provided");
  auth.destroy();
});

test("auth middleware validateToken rejects non-nella_ prefix", async () => {
  const auth = createAuthMiddleware({});
  const result = await auth.validateToken("sk_test_abc123");
  assert.equal(result.valid, false);
  assert.equal(result.error, "Invalid key format");
  auth.destroy();
});

test("auth middleware dev mode accepts nella_ prefix without Supabase", async () => {
  const auth = createAuthMiddleware({});
  const result = await auth.validateToken("nella_test_key_12345");
  assert.equal(result.valid, true);
  assert.equal(result.userId, "dev");
  auth.destroy();
});

test("auth middleware caches results", async () => {
  const auth = createAuthMiddleware({ cacheTtl: 10_000 });

  const r1 = await auth.validateToken("nella_cached_key");
  assert.equal(r1.valid, true);

  // Second call should hit cache
  const r2 = await auth.validateToken("nella_cached_key");
  assert.equal(r2.valid, true);
  assert.equal(r2.userId, "dev");

  auth.destroy();
});

test("express middleware allows public paths without auth", (_, done) => {
  const auth = createAuthMiddleware({});
  const req = { path: "/health", headers: {}, query: {} };
  const res = { status: () => res, json: () => {} };
  let called = false;

  auth.expressMiddleware(req, res, () => {
    called = true;
  });

  // next() should be called synchronously for public paths
  assert.ok(called);
  auth.destroy();
  done();
});

test("express middleware rejects /api/* without token", (_, done) => {
  const auth = createAuthMiddleware({});
  const req = { path: "/api/tools", headers: {}, query: {} };
  let statusCode = 0;
  const res = {
    status: (code: number) => { statusCode = code; return res; },
    json: (body: any) => {
      assert.equal(statusCode, 401);
      assert.equal(body.error, "Authentication required");
      auth.destroy();
      done();
    },
  };

  auth.expressMiddleware(req, res, () => {
    assert.fail("next() should not be called");
  });
});
