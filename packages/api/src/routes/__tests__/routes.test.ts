/**
 * Protected Routes Integration Tests
 *
 * Tests authentication, scope enforcement, request validation, and error
 * handling for all protected API routes.  Because the route factories
 * instantiate real service objects we cannot inject mocks, so we test:
 *
 *   1. 401 – Missing API key
 *   2. 403 – Insufficient scope (injected user without required scope)
 *   3. 400 – Invalid request body (Zod validation)
 *   4. Error propagation → 500 (services error when called without real backend)
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

import { createApp } from "../../app";
import { workspacesRouter } from "../workspaces";
import { searchRouter } from "../search";
import { validateRouter } from "../validate";
import { contextRouter } from "../context";
import { errorHandler } from "../../middleware/error-handler";

let request: typeof import("supertest").default;

before(async () => {
  const mod = await import("supertest");
  request = (mod as any).default || mod;
});

// ---------------------------------------------------------------------------
// Helper: build a mini-app with injected user (bypasses Supabase auth)
// ---------------------------------------------------------------------------

function buildAppWithUser(
  scopes: string[],
  mountPath: string,
  routerFn: () => express.Router
) {
  const app = express();
  app.use(express.json());

  // inject fake user
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = "test-req";
    req.user = {
      apiKeyId: "key-1",
      userId: "user-1",
      scopes,
      rateLimits: {
        requests_per_minute: 60,
        requests_per_hour: 1000,
        requests_per_day: 10000,
      },
    };
    next();
  });

  app.use(mountPath, routerFn());
  app.use(errorHandler as any);
  return app;
}

// =============================================================================
// Auth Enforcement (full createApp – no API key → 401)
// =============================================================================

describe("Auth enforcement on protected routes", () => {
  const protectedPaths = [
    { method: "get" as const, path: "/api/v1/workspaces" },
    { method: "post" as const, path: "/api/v1/workspaces" },
    { method: "post" as const, path: "/api/v1/search" },
    { method: "post" as const, path: "/api/v1/validate/check" },
    { method: "get" as const, path: "/api/v1/context" },
    { method: "post" as const, path: "/api/v1/auth/keys" },
  ];

  for (const { method, path } of protectedPaths) {
    it(`${method.toUpperCase()} ${path} → 401 without API key`, async () => {
      const app = createApp();
      const res = await request(app)[method](path);
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, "AUTHENTICATION_REQUIRED");
    });
  }
});

// =============================================================================
// Scope Enforcement (mini-app with injected user, missing required scope)
// =============================================================================

describe("Scope enforcement", () => {
  it("workspaces:read scope required for GET /workspaces", async () => {
    const app = buildAppWithUser(["search:read"], "/api/v1/workspaces", workspacesRouter);
    const res = await request(app).get("/api/v1/workspaces");
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "INSUFFICIENT_SCOPE");
  });

  it("workspaces:write scope required for POST /workspaces", async () => {
    const app = buildAppWithUser(["workspaces:read"], "/api/v1/workspaces", workspacesRouter);
    const res = await request(app)
      .post("/api/v1/workspaces")
      .send({ name: "x", path: "/tmp/x" });
    assert.equal(res.status, 403);
  });

  it("search:read scope required for POST /search", async () => {
    const app = buildAppWithUser(["workspaces:read"], "/api/v1/search", searchRouter);
    const res = await request(app)
      .post("/api/v1/search")
      .send({ workspaceId: "ws1", query: "hello" });
    assert.equal(res.status, 403);
  });

  it("validate:run scope required for POST /validate/check", async () => {
    const app = buildAppWithUser(["search:read"], "/api/v1/validate", validateRouter);
    const res = await request(app)
      .post("/api/v1/validate/check")
      .send({ workspaceId: "ws1", taskId: "t1", prompt: "test" });
    assert.equal(res.status, 403);
  });

  it("context:read scope required for GET /context", async () => {
    const app = buildAppWithUser(["search:read"], "/api/v1/context", contextRouter);
    const res = await request(app).get("/api/v1/context");
    assert.equal(res.status, 403);
  });

  it("admin scope grants access to any route", async () => {
    // Admin should pass the scope check; may then fail in service layer → 500
    const app = buildAppWithUser(["admin"], "/api/v1/workspaces", workspacesRouter);
    const res = await request(app).get("/api/v1/workspaces");
    // Should not be 403 — either success or 500 from service
    assert.notEqual(res.status, 403);
  });
});

// =============================================================================
// Request Validation (Zod schema enforcement)
// =============================================================================

describe("Workspace route validation", () => {
  it("POST /workspaces rejects empty body", async () => {
    const app = buildAppWithUser(["workspaces:write"], "/api/v1/workspaces", workspacesRouter);
    const res = await request(app)
      .post("/api/v1/workspaces")
      .send({});

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it("POST /workspaces rejects missing path", async () => {
    const app = buildAppWithUser(["workspaces:write"], "/api/v1/workspaces", workspacesRouter);
    const res = await request(app)
      .post("/api/v1/workspaces")
      .send({ name: "my-workspace" }); // missing path

    assert.equal(res.status, 400);
  });

  it("POST /workspaces rejects empty name", async () => {
    const app = buildAppWithUser(["workspaces:write"], "/api/v1/workspaces", workspacesRouter);
    const res = await request(app)
      .post("/api/v1/workspaces")
      .send({ name: "", path: "/home/user/project" });

    assert.equal(res.status, 400);
  });

  it("PATCH /workspaces/:id rejects invalid name", async () => {
    const app = buildAppWithUser(["workspaces:write"], "/api/v1/workspaces", workspacesRouter);
    const res = await request(app)
      .patch("/api/v1/workspaces/some-id")
      .send({ name: "" }); // empty name should fail min(1)

    assert.equal(res.status, 400);
  });
});

describe("Search route validation", () => {
  it("POST /search rejects empty body", async () => {
    const app = buildAppWithUser(["search:read"], "/api/v1/search", searchRouter);
    const res = await request(app)
      .post("/api/v1/search")
      .send({});

    assert.equal(res.status, 400);
  });

  it("POST /search rejects missing query", async () => {
    const app = buildAppWithUser(["search:read"], "/api/v1/search", searchRouter);
    const res = await request(app)
      .post("/api/v1/search")
      .send({ workspaceId: "ws1" }); // missing query

    assert.equal(res.status, 400);
  });

  it("POST /search/batch rejects empty queries array", async () => {
    const app = buildAppWithUser(["search:read"], "/api/v1/search", searchRouter);
    const res = await request(app)
      .post("/api/v1/search/batch")
      .send({ workspaceId: "ws1", queries: [] });

    assert.equal(res.status, 400);
  });

  it("POST /search/batch rejects more than 20 queries", async () => {
    const app = buildAppWithUser(["search:read"], "/api/v1/search", searchRouter);
    const queries = Array.from({ length: 21 }, (_, i) => ({
      query: `q${i}`,
    }));
    const res = await request(app)
      .post("/api/v1/search/batch")
      .send({ workspaceId: "ws1", queries });

    assert.equal(res.status, 400);
  });

  it("POST /search/verify rejects missing code", async () => {
    const app = buildAppWithUser(["search:read"], "/api/v1/search", searchRouter);
    const res = await request(app)
      .post("/api/v1/search/verify")
      .send({ workspaceId: "ws1" }); // missing code

    assert.equal(res.status, 400);
  });
});

describe("Validate route validation", () => {
  it("POST /validate/check rejects empty body", async () => {
    const app = buildAppWithUser(["validate:run"], "/api/v1/validate", validateRouter);
    const res = await request(app)
      .post("/api/v1/validate/check")
      .send({});

    assert.equal(res.status, 400);
  });

  it("POST /validate/check rejects missing taskId", async () => {
    const app = buildAppWithUser(["validate:run"], "/api/v1/validate", validateRouter);
    const res = await request(app)
      .post("/api/v1/validate/check")
      .send({ workspaceId: "ws1", prompt: "do something" });

    assert.equal(res.status, 400);
  });

  it("POST /validate/validate rejects missing constraints", async () => {
    const app = buildAppWithUser(["validate:run"], "/api/v1/validate", validateRouter);
    const res = await request(app)
      .post("/api/v1/validate/validate")
      .send({ modifiedFiles: ["a.ts"], diff: "diff" });

    assert.equal(res.status, 400);
  });

  it("POST /validate/run rejects missing changes", async () => {
    const app = buildAppWithUser(["validate:run"], "/api/v1/validate", validateRouter);
    const res = await request(app)
      .post("/api/v1/validate/run")
      .send({
        workspaceId: "ws1",
        taskId: "t1",
        taskName: "test",
        prompt: "do something",
      });

    assert.equal(res.status, 400);
  });
});

describe("Context route validation", () => {
  it("POST /context/assumptions rejects empty body", async () => {
    const app = buildAppWithUser(["context:write"], "/api/v1/context", contextRouter);
    const res = await request(app)
      .post("/api/v1/context/assumptions")
      .send({});

    assert.equal(res.status, 400);
  });

  it("POST /context/changes rejects missing files", async () => {
    const app = buildAppWithUser(["context:write"], "/api/v1/context", contextRouter);
    const res = await request(app)
      .post("/api/v1/context/changes")
      .send({ operation: "create", reason: "test" });

    assert.equal(res.status, 400);
  });
});

// =============================================================================
// Error Propagation (services error → 500)
// =============================================================================

describe("Service error propagation", () => {
  it("GET /workspaces/:id returns 404 for non-existent ID", async () => {
    const app = buildAppWithUser(["workspaces:read"], "/api/v1/workspaces", workspacesRouter);
    const res = await request(app).get("/api/v1/workspaces/non-existent-id");

    // Service may return null → 404, or may throw → 500
    assert.ok([404, 500].includes(res.status));
  });

  it("DELETE /workspaces/:id returns 404 for non-existent ID", async () => {
    const app = buildAppWithUser(["workspaces:write"], "/api/v1/workspaces", workspacesRouter);
    const res = await request(app).delete("/api/v1/workspaces/non-existent-id");

    assert.ok([404, 500].includes(res.status));
  });

  it("POST /search with valid body propagates service error", async () => {
    const app = buildAppWithUser(["search:read"], "/api/v1/search", searchRouter);
    const res = await request(app)
      .post("/api/v1/search")
      .send({ workspaceId: "ws1", query: "hello", mode: "hybrid", topK: 10 });

    // Will fail in service layer (no real index) → error handler → 500
    assert.equal(res.status, 500);
  });

  it("POST /validate/validate with valid body handles service result", async () => {
    const app = buildAppWithUser(["validate:run"], "/api/v1/validate", validateRouter);
    const res = await request(app)
      .post("/api/v1/validate/validate")
      .send({
        modifiedFiles: ["src/app.ts"],
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
        constraints: [
          {
            id: "c1",
            description: "Don't modify README",
            rule: "no readme",
            filesNotToModify: ["README.md"],
          },
        ],
      });

    // Either succeeds (200) or service error (500)
    assert.ok([200, 500].includes(res.status));
    if (res.status === 200) {
      assert.ok(res.body.data);
    }
  });
});

// =============================================================================
// Response Format
// =============================================================================

describe("Response format consistency", () => {
  it("error responses have standard shape", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/workspaces");

    assert.equal(res.status, 401);
    assert.ok(res.body.error);
    assert.ok(typeof res.body.error.code === "string");
    assert.ok(typeof res.body.error.message === "string");
    assert.ok(typeof res.body.error.requestId === "string");
  });

  it("validation error has details", async () => {
    const app = buildAppWithUser(["workspaces:write"], "/api/v1/workspaces", workspacesRouter);
    const res = await request(app)
      .post("/api/v1/workspaces")
      .send({});

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
    // validation middleware provides details about which fields failed
    assert.ok(res.body.error.code);
  });
});
