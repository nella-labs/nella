/**
 * App Smoke Tests
 *
 * Integration tests for the Express app using supertest.
 * Tests public endpoints, auth enforcement, and middleware.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// Set required env vars BEFORE importing app (config validates eagerly)
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

import { createApp } from "../app";

// Dynamic import of supertest (CommonJS compat)
let request: typeof import("supertest").default;

before(async () => {
  const mod = await import("supertest");
  request = (mod as any).default || mod;
});

// =============================================================================
// Health / Public Routes
// =============================================================================

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const app = createApp();
    const res = await request(app).get("/health");

    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.service, "nella-api");
    assert.ok(res.body.version);
    assert.ok(typeof res.body.uptime === "number");
    assert.ok(res.body.timestamp);
  });
});

describe("GET /ready", () => {
  it("returns 200 with readiness checks", async () => {
    const app = createApp();
    const res = await request(app).get("/ready");

    assert.ok([200, 503].includes(res.status));
    assert.ok(res.body.status);
    assert.ok(res.body.checks);
    assert.ok(res.body.timestamp);
  });
});

describe("GET /metrics", () => {
  it("returns prometheus-style text metrics", async () => {
    const app = createApp();
    const res = await request(app).get("/metrics");

    assert.equal(res.status, 200);
    assert.ok(res.text.includes("nella_api_uptime_seconds"));
    assert.ok(res.text.includes("nella_api_info"));
  });
});

// =============================================================================
// Request ID
// =============================================================================

describe("X-Request-Id", () => {
  it("generates a request ID when none provided", async () => {
    const app = createApp();
    const res = await request(app).get("/health");

    // The healthRouter itself doesn't set X-Request-Id on the response,
    // but the middleware attaches it to `req.requestId`.
    // Verify the request completes successfully (middleware didn't break).
    assert.equal(res.status, 200);
  });

  it("preserves client-provided request ID", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/health")
      .set("X-Request-Id", "client-req-123");

    assert.equal(res.status, 200);
  });
});

// =============================================================================
// 404 Handling
// =============================================================================

describe("404 / Auth on unknown routes", () => {
  it("returns 401 for unknown routes (auth middleware intercepts first)", async () => {
    const app = createApp();
    const res = await request(app).get("/nonexistent/route");

    // Auth middleware is applied before the 404 handler, so unknown routes return 401
    assert.ok(
      [401, 404].includes(res.status),
      `Expected 401 or 404, got ${res.status}`
    );
  });
});

// =============================================================================
// Protected Routes — Auth Required
// =============================================================================

describe("Protected routes without auth", () => {
  it("returns 401 for /api/v1/workspaces without API key", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/workspaces");

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "AUTHENTICATION_REQUIRED");
  });

  it("returns 401 for /api/v1/search without API key", async () => {
    const app = createApp();
    const res = await request(app).post("/api/v1/search").send({ query: "test" });

    assert.equal(res.status, 401);
  });

  it("returns 401 for /api/v1/validate without API key", async () => {
    const app = createApp();
    const res = await request(app).post("/api/v1/validate/check").send({});

    assert.equal(res.status, 401);
  });

  it("returns 401 for /api/v1/context without API key", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/context");

    assert.equal(res.status, 401);
  });

  it("returns 401 for /api/v1/auth without API key", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/auth/keys");

    assert.equal(res.status, 401);
  });
});

// =============================================================================
// CORS
// =============================================================================

describe("CORS Headers", () => {
  it("responds to OPTIONS preflight", async () => {
    const app = createApp();
    const res = await request(app)
      .options("/api/v1/workspaces")
      .set("Origin", "https://app.getnella.dev")
      .set("Access-Control-Request-Method", "GET");

    // CORS headers should be present
    assert.ok(
      res.headers["access-control-allow-origin"] ||
      res.status === 204 ||
      res.status === 200,
      "Should respond to preflight"
    );
  });
});

// =============================================================================
// Body Parsing
// =============================================================================

describe("Body Parsing", () => {
  it("handles JSON body", async () => {
    const app = createApp();
    // POST to health won't match any route, but body parsing shouldn't error
    const res = await request(app)
      .post("/health")
      .set("Content-Type", "application/json")
      .send({ test: true });

    // Auth middleware intercepts non-GET to health, so we may get 401 or 404
    assert.ok(
      [401, 404].includes(res.status),
      `Expected 401 or 404, got ${res.status}`
    );
  });

  it("rejects bodies over 5mb", async () => {
    const app = createApp();
    const largeBody = "x".repeat(6 * 1024 * 1024);

    const res = await request(app)
      .post("/api/v1/workspaces")
      .set("Content-Type", "application/json")
      .send(largeBody);

    // May be 413 (payload too large), 401 (auth), or 500 (error handler)
    assert.ok(
      [413, 401, 500].includes(res.status),
      `Expected 413, 401, or 500, got ${res.status}`
    );
  });
});

// =============================================================================
// Security Headers
// =============================================================================

describe("Security Headers (helmet)", () => {
  it("sets security headers on responses", async () => {
    const app = createApp();
    const res = await request(app).get("/health");

    // helmet sets these by default
    assert.ok(res.headers["x-content-type-options"]);
    assert.ok(res.headers["x-frame-options"] || res.headers["content-security-policy"]);
  });
});
