/**
 * AssumptionTracker Tests
 *
 * Tests for assumption tracking, invalidation detection,
 * conflict detection, and glob-based file matching.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionStore } from "../session-store";
import { AssumptionTracker } from "../assumption-tracker";

let tmpDir: string;
let session: SessionStore;
let tracker: AssumptionTracker;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nella-at-test-"));
  session = new SessionStore(tmpDir);
  tracker = new AssumptionTracker(session);
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// =============================================================================

describe("AssumptionTracker", () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  // ---------------------------------------------------------------------------
  // Adding assumptions
  // ---------------------------------------------------------------------------

  describe("addAssumption", () => {
    it("creates a valid assumption with defaults", () => {
      const a = tracker.addAssumption("DB uses Postgres", ["src/db.ts"]);
      assert.ok(a.id);
      assert.equal(a.description, "DB uses Postgres");
      assert.equal(a.valid, true);
      assert.equal(a.type, "other");
      assert.equal(a.confidence, 0.8);
      assert.deepEqual(a.relatedFiles, ["src/db.ts"]);
    });

    it("normalizes file paths (backslashes to forward slashes)", () => {
      const a = tracker.addAssumption("test", ["src\\utils\\helper.ts"]);
      assert.ok(a.relatedFiles[0].includes("/"));
      assert.ok(!a.relatedFiles[0].includes("\\"));
    });
  });

  describe("typed assumption helpers", () => {
    it("addSchemaAssumption sets type=schema, confidence=0.9", () => {
      const a = tracker.addSchemaAssumption("Users table has email column", ["prisma/schema.prisma"]);
      assert.equal(a.type, "schema");
      assert.equal(a.confidence, 0.9);
    });

    it("addInterfaceAssumption sets type=interface, confidence=0.85", () => {
      const a = tracker.addInterfaceAssumption("User has id field", ["src/types.ts"]);
      assert.equal(a.type, "interface");
      assert.equal(a.confidence, 0.85);
    });

    it("addDependencyAssumption targets package.json", () => {
      const a = tracker.addDependencyAssumption("Express v4 is used");
      assert.equal(a.type, "dependency");
      assert.deepEqual(a.relatedFiles, ["package.json"]);
    });

    it("addBehaviorAssumption sets type=behavior, confidence=0.7", () => {
      const a = tracker.addBehaviorAssumption("getUser returns null for missing", ["src/services.ts"]);
      assert.equal(a.type, "behavior");
      assert.equal(a.confidence, 0.7);
    });

    it("addConfigAssumption sets type=config", () => {
      const a = tracker.addConfigAssumption("Port is 3000", [".env"]);
      assert.equal(a.type, "config");
    });

    it("addStructureAssumption sets type=structure, confidence=0.95", () => {
      const a = tracker.addStructureAssumption("src/routes/ exists", ["src/routes/**"]);
      assert.equal(a.type, "structure");
      assert.equal(a.confidence, 0.95);
    });
  });

  // ---------------------------------------------------------------------------
  // Querying
  // ---------------------------------------------------------------------------

  describe("querying", () => {
    it("getValidAssumptions returns only valid ones", () => {
      tracker.addAssumption("valid", ["a.ts"]);
      const a2 = tracker.addAssumption("will invalidate", ["b.ts"]);
      tracker.invalidate(a2.id, "run-1", "test");

      const valid = tracker.getValidAssumptions();
      assert.equal(valid.length, 1);
      assert.equal(valid[0].description, "valid");
    });

    it("getInvalidatedAssumptions returns invalidated ones", () => {
      const a = tracker.addAssumption("to invalidate", ["x.ts"]);
      tracker.invalidate(a.id, "run-1", "test");

      const invalidated = tracker.getInvalidatedAssumptions();
      assert.equal(invalidated.length, 1);
      assert.equal(invalidated[0].valid, false);
    });

    it("getAssumptionsByType filters by type", () => {
      tracker.addSchemaAssumption("schema", ["s.ts"]);
      tracker.addConfigAssumption("config", ["c.ts"]);
      tracker.addSchemaAssumption("schema2", ["s2.ts"]);

      const schemas = tracker.getAssumptionsByType("schema");
      assert.equal(schemas.length, 2);
    });
  });

  // ---------------------------------------------------------------------------
  // Invalidation detection
  // ---------------------------------------------------------------------------

  describe("checkInvalidations", () => {
    it("invalidates assumptions when related files are modified", () => {
      tracker.addAssumption("DB schema", ["src/db.ts"]);
      tracker.addAssumption("Unrelated", ["src/ui.ts"]);

      const invalidated = tracker.checkInvalidations(["src/db.ts"], "run-1");
      assert.equal(invalidated.length, 1);
      assert.equal(invalidated[0].description, "DB schema");
    });

    it("supports glob patterns in related files", () => {
      tracker.addAssumption("All routes have auth", ["src/routes/**"]);

      const invalidated = tracker.checkInvalidations(
        ["src/routes/users.ts"],
        "run-1"
      );
      assert.equal(invalidated.length, 1);
    });

    it("does not invalidate assumptions for unrelated files", () => {
      tracker.addAssumption("API config", ["config/api.yaml"]);

      const invalidated = tracker.checkInvalidations(["src/utils.ts"], "run-1");
      assert.equal(invalidated.length, 0);
    });

    it("skips already-invalidated assumptions", () => {
      const a = tracker.addAssumption("once only", ["x.ts"]);
      tracker.invalidate(a.id, "run-0", "manual");

      const invalidated = tracker.checkInvalidations(["x.ts"], "run-1");
      assert.equal(invalidated.length, 0);
    });
  });

  // ---------------------------------------------------------------------------
  // Conflict detection
  // ---------------------------------------------------------------------------

  describe("getConflicts", () => {
    it("detects conflicts with planned file changes", () => {
      tracker.addAssumption("Schema is stable", ["src/schema.ts"]);

      const conflicts = tracker.getConflicts(["src/schema.ts"]);
      assert.equal(conflicts.length, 1);
      assert.equal(conflicts[0].plannedFile, "src/schema.ts");
      assert.ok(conflicts[0].suggestion);
    });

    it("returns severity based on confidence", () => {
      tracker.addAssumption("high confidence", ["a.ts"], "schema", 0.9);
      tracker.addAssumption("low confidence", ["b.ts"], "behavior", 0.5);

      const conflicts = tracker.getConflicts(["a.ts", "b.ts"]);
      const highConf = conflicts.find((c) => c.plannedFile === "a.ts");
      const lowConf = conflicts.find((c) => c.plannedFile === "b.ts");

      assert.equal(highConf?.severity, "error");
      assert.equal(lowConf?.severity, "warning");
    });

    it("returns empty for no conflicts", () => {
      tracker.addAssumption("unrelated", ["z.ts"]);
      const conflicts = tracker.getConflicts(["a.ts"]);
      assert.equal(conflicts.length, 0);
    });
  });

  // ---------------------------------------------------------------------------
  // Full check
  // ---------------------------------------------------------------------------

  describe("checkAll", () => {
    it("combines invalidation + conflict detection", () => {
      tracker.addAssumption("Schema", ["src/schema.ts"]);
      tracker.addAssumption("Config", ["src/config.ts"]);
      tracker.addAssumption("Routes", ["src/routes.ts"]);

      const result = tracker.checkAll(
        ["src/schema.ts"],        // modified files
        ["src/config.ts"],        // planned files
        "run-1"
      );

      assert.equal(result.newlyInvalidated.length, 1); // schema invalidated
      assert.ok(result.conflicts.length >= 1);           // config conflict
      assert.ok(result.valid.length >= 1);               // routes still valid
    });
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  describe("getSummary", () => {
    it("returns summary object with counts", () => {
      tracker.addAssumption("a", ["x.ts"]);
      tracker.addAssumption("b", ["y.ts"]);
      const a3 = tracker.addAssumption("c", ["z.ts"]);
      tracker.invalidate(a3.id, "run-1", "test");

      const summary = tracker.getSummary();
      assert.equal(summary.total, 3);
      assert.equal(summary.valid, 2);
      assert.equal(summary.invalidated, 1);
      assert.ok(summary.byType);
    });
  });
});
