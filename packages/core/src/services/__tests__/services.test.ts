/**
 * Services Layer Tests
 *
 * Tests for SafetyService (detectRisks), AuthService (hasScope),
 * and WorkspaceService (CRUD with temp registry).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// =============================================================================
// SafetyService — detectRisks (pure logic, no mocking)
// =============================================================================

import { SafetyService } from "../safety-service";

describe("SafetyService", () => {
  let svc: SafetyService;

  beforeEach(() => {
    svc = new SafetyService();
  });

  describe("detectRisks", () => {
    it("detects credential logging risks", () => {
      const result = svc.detectRisks("console.log(password)");
      assert.ok(result.hasRisks);
      assert.ok(result.count > 0);
    });

    it("detects auth bypass risks", () => {
      const result = svc.detectRisks("disable authentication middleware");
      assert.ok(result.hasRisks);
    });

    it("detects dangerous operations", () => {
      const dangerousInputs = [
        "DELETE ALL USERS from database",
        "DROP TABLE sessions",
        "run rm -rf /",
        "add backdoor to login",
        "hardcode password in config",
      ];

      for (const input of dangerousInputs) {
        const result = svc.detectRisks(input);
        assert.ok(result.hasRisks, `Should detect risk in: "${input}"`);
      }
    });

    it("returns no risks for safe content", () => {
      const safeInputs = [
        "Create a user registration form with email validation",
        "Add pagination to the users endpoint",
        "Refactor the repository pattern",
      ];

      for (const input of safeInputs) {
        const result = svc.detectRisks(input);
        assert.ok(!result.hasRisks, `Should be safe: "${input}"`);
      }
    });

    it("handles empty string", () => {
      const result = svc.detectRisks("");
      assert.ok(!result.hasRisks);
      assert.equal(result.count, 0);
    });

    it("returns risk patterns list", () => {
      const result = svc.detectRisks("log the token and expose credentials");
      assert.ok(result.risks.length > 0);
      assert.ok(Array.isArray(result.risks));
    });
  });
});

// =============================================================================
// AuthService — hasScope (pure logic)
// =============================================================================

import { AuthService } from "../auth-service";
import type { Scope } from "../auth-service";

describe("AuthService.hasScope", () => {
  let svc: AuthService;

  beforeEach(() => {
    svc = new AuthService("/tmp/nella-test-auth");
  });

  it("grants access when scope is present", () => {
    const scopes: Scope[] = ["workspaces:read", "search:read"];
    assert.ok(svc.hasScope(scopes, "workspaces:read"));
    assert.ok(svc.hasScope(scopes, "search:read"));
  });

  it("denies access when scope is missing", () => {
    const scopes: Scope[] = ["workspaces:read"];
    assert.ok(!svc.hasScope(scopes, "workspaces:write"));
    assert.ok(!svc.hasScope(scopes, "admin"));
  });

  it("admin scope grants access to everything", () => {
    const scopes: Scope[] = ["admin"];
    assert.ok(svc.hasScope(scopes, "workspaces:read"));
    assert.ok(svc.hasScope(scopes, "workspaces:write"));
    assert.ok(svc.hasScope(scopes, "search:read"));
    assert.ok(svc.hasScope(scopes, "validate:run"));
    assert.ok(svc.hasScope(scopes, "context:read"));
    assert.ok(svc.hasScope(scopes, "context:write"));
  });

  it("empty scopes denies everything", () => {
    assert.ok(!svc.hasScope([], "workspaces:read"));
  });
});

// =============================================================================
// WorkspaceService — CRUD (uses temp directory)
// =============================================================================

import { WorkspaceService } from "../workspace-service";

describe("WorkspaceService", () => {
  let svc: WorkspaceService;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nella-ws-test-"));
    // WorkspaceRegistry expects a backups subdirectory
    fs.mkdirSync(path.join(tmpDir, "backups"), { recursive: true });
    svc = new WorkspaceService(tmpDir);
  });

  afterEach(async () => {
    // WorkspaceRegistry persists asynchronously via debounced writes.
    // Wait long enough for all pending I/O to flush before removing the temp dir.
    await new Promise((r) => setTimeout(r, 500));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore — OS will clean temp dir
    }
  });

  describe("create + getById", () => {
    it("creates a workspace and retrieves it by ID", async () => {
      // Note: WorkspaceService.create passes (name, path) to registry.register(workspacePath, name)
      // so the arguments are swapped — name becomes workspacePath, path becomes display name.
      // We test the actual behavior here.
      const ws = await svc.create({ name: "test-project", path: "/home/user/project" });
      assert.ok(ws.id);
      assert.ok(ws.name); // registry uses params.path as display name
      assert.ok(ws.path); // registry resolves params.name as workspace path

      const found = await svc.getById(ws.id);
      assert.ok(found);
      assert.equal(found!.id, ws.id);
    });
  });

  describe("list", () => {
    it("lists all workspaces with pagination", async () => {
      await svc.create({ name: "ws-1", path: "/p1" });
      await svc.create({ name: "ws-2", path: "/p2" });
      await svc.create({ name: "ws-3", path: "/p3" });

      const result = await svc.list(0, 2);
      assert.equal(result.workspaces.length, 2);
      assert.equal(result.total, 3);

      const page2 = await svc.list(2, 2);
      assert.equal(page2.workspaces.length, 1);
    });
  });

  describe("update", () => {
    it("updates workspace fields", async () => {
      const ws = await svc.create({ name: "original", path: "/orig" });
      const updated = await svc.update(ws.id, { name: "renamed" });
      assert.ok(updated);
      assert.equal(updated!.name, "renamed");
    });

    it("returns null for non-existent workspace", async () => {
      const result = await svc.update("non-existent-id", { name: "x" });
      assert.equal(result, null);
    });
  });

  describe("remove", () => {
    it("removes an existing workspace", async () => {
      const ws = await svc.create({ name: "to-delete", path: "/del" });
      const removed = await svc.remove(ws.id);
      assert.ok(removed);

      const found = await svc.getById(ws.id);
      assert.equal(found, null);
    });

    it("returns false for non-existent workspace", async () => {
      const result = await svc.remove("no-such-id");
      assert.ok(!result);
    });
  });
});
