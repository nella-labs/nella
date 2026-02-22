/**
 * Health Route Tests
 *
 * Thorough tests for /health, /ready, /metrics endpoints.
 * These are public (no auth) and have no service dependencies.
 */

import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

import { createApp } from "../../app";

let request: typeof import("supertest").default;

before(async () => {
  const mod = await import("supertest");
  request = (mod as any).default || mod;
});

// =============================================================================
// GET /health
// =============================================================================

describe("GET /health", () => {
  it("returns 200 with correct shape", async () => {
    const app = createApp();
    const res = await request(app).get("/health");

    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.service, "nella-api");
    assert.ok(typeof res.body.version === "string");
    assert.ok(typeof res.body.uptime === "number");
    assert.ok(res.body.timestamp);
    // timestamp should be valid ISO 8601
    assert.ok(!isNaN(Date.parse(res.body.timestamp)));
  });

  it("uptime is non-negative", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    assert.ok(res.body.uptime >= 0);
  });

  it("does not require authentication", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    // Should succeed without any Authorization header
    assert.equal(res.status, 200);
  });

  it("returns JSON content-type", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    assert.ok(res.headers["content-type"]?.includes("application/json"));
  });
});

// =============================================================================
// GET /ready
// =============================================================================

describe("GET /ready", () => {
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const savedRedis = process.env.REDIS_URL;

  afterEach(() => {
    // Restore env vars
    process.env.SUPABASE_URL = savedUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
    if (savedRedis !== undefined) {
      process.env.REDIS_URL = savedRedis;
    } else {
      delete process.env.REDIS_URL;
    }
  });

  it("returns readiness with checks object", async () => {
    const app = createApp();
    const res = await request(app).get("/ready");

    assert.ok([200, 503].includes(res.status));
    assert.ok(["ready", "degraded"].includes(res.body.status));
    assert.ok(typeof res.body.checks === "object");
    assert.ok(res.body.timestamp);
    assert.ok(res.body.version);
  });

  it("reports supabase status when env vars are set", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

    const app = createApp();
    const res = await request(app).get("/ready");

    // In test env, Supabase URL is fake so actual query may fail
    assert.ok(["ok", "error"].includes(res.body.checks.supabase));
  });

  it("reports supabase as missing_config when URL absent", async () => {
    delete process.env.SUPABASE_URL;

    const app = createApp();
    const res = await request(app).get("/ready");

    assert.equal(res.body.checks.supabase, "missing_config");
  });

  it("reports redis status", async () => {
    const app = createApp();
    const res = await request(app).get("/ready");

    // In test env without REDIS_URL: not_configured
    // With REDIS_URL but no server: unreachable
    assert.ok(
      ["ok", "not_configured", "unreachable", "error"].includes(res.body.checks.redis)
    );
  });

  it("returns 200 when all checks are ok", async () => {
    const app = createApp();
    const res = await request(app).get("/ready");

    const allOk = Object.values(res.body.checks).every(
      (v) => v === "ok"
    );
    if (allOk) {
      assert.equal(res.status, 200);
    }
  });

  it("does not require authentication", async () => {
    const app = createApp();
    const res = await request(app).get("/ready");
    assert.ok([200, 503].includes(res.status));
  });

  it("supports deep mode", async () => {
    const app = createApp();
    const res = await request(app).get("/ready?deep=true");

    assert.ok([200, 503].includes(res.status));
    assert.equal(res.body.mode, "deep");
    assert.ok(typeof res.body.checks === "object");
    // Deep mode should include auth_service check
    assert.ok("auth_service" in res.body.checks);
  });
});

// =============================================================================
// GET /metrics
// =============================================================================

describe("GET /metrics", () => {
  it("returns prometheus text format", async () => {
    const app = createApp();
    const res = await request(app).get("/metrics");

    assert.equal(res.status, 200);
    assert.ok(
      res.headers["content-type"]?.includes("text/plain") ||
        res.headers["content-type"]?.includes("text/plain; charset=utf-8")
    );
  });

  it("contains uptime metric", async () => {
    const app = createApp();
    const res = await request(app).get("/metrics");

    assert.ok(res.text.includes("nella_api_uptime_seconds"));
  });

  it("contains version info", async () => {
    const app = createApp();
    const res = await request(app).get("/metrics");

    assert.ok(res.text.includes("nella_api_info"));
    assert.ok(res.text.includes("version"));
  });

  it("does not require authentication", async () => {
    const app = createApp();
    const res = await request(app).get("/metrics");
    assert.equal(res.status, 200);
  });
});
