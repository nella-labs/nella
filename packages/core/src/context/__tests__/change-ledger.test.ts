/**
 * ChangeLedger Tests
 *
 * Tests for change recording, file history, hotspot detection,
 * dependency analysis, impact analysis, and statistics.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionStore } from "../session-store";
import { ChangeLedger } from "../change-ledger";

let tmpDir: string;
let session: SessionStore;
let ledger: ChangeLedger;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nella-cl-test-"));
  session = new SessionStore(tmpDir);
  ledger = new ChangeLedger(session);
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// =============================================================================

describe("ChangeLedger", () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  // ---------------------------------------------------------------------------
  // Recording changes
  // ---------------------------------------------------------------------------

  describe("recordChange", () => {
    it("records a single change", () => {
      const change = ledger.recordChange("run-1", "src/app.ts", "create", "Initial setup");
      assert.ok(change.id);
      assert.equal(change.runId, "run-1");
      assert.equal(change.file, "src/app.ts");
      assert.equal(change.operation, "create");
      assert.equal(change.reason, "Initial setup");
      assert.ok(change.timestamp);
    });

    it("normalizes file paths", () => {
      const change = ledger.recordChange("run-1", "src\\utils\\helper.ts", "modify", "fix");
      assert.ok(change.file.includes("/"));
      assert.ok(!change.file.includes("\\"));
    });

    it("records content hash when content is provided", () => {
      const change = ledger.recordChange("run-1", "src/file.ts", "create", "new file", {
        content: "const x = 1;",
      });
      assert.ok(change.contentHash);
    });
  });

  describe("recordChanges (batch)", () => {
    it("records multiple changes at once", () => {
      const changes = ledger.recordChanges("run-1", [
        { file: "a.ts", operation: "create", reason: "new" },
        { file: "b.ts", operation: "modify", reason: "update" },
        { file: "c.ts", operation: "delete", reason: "cleanup" },
      ]);
      assert.equal(changes.length, 3);
    });
  });

  // ---------------------------------------------------------------------------
  // Querying
  // ---------------------------------------------------------------------------

  describe("getFileHistory", () => {
    it("returns full history for a file", () => {
      ledger.recordChange("run-1", "src/app.ts", "create", "created");
      ledger.recordChange("run-2", "src/app.ts", "modify", "updated");

      const history = ledger.getFileHistory("src/app.ts");
      assert.equal(history.file, "src/app.ts");
      assert.equal(history.changes.length, 2);
      assert.equal(history.currentState, "exists");
      assert.ok(history.lastModifiedAt);
    });

    it("detects deleted files", () => {
      ledger.recordChange("run-1", "old.ts", "create", "created");
      ledger.recordChange("run-2", "old.ts", "delete", "removed");

      const history = ledger.getFileHistory("old.ts");
      assert.equal(history.currentState, "deleted");
    });

    it("returns unknown for untracked files", () => {
      const history = ledger.getFileHistory("unknown.ts");
      assert.equal(history.currentState, "unknown");
      assert.equal(history.changes.length, 0);
    });
  });

  describe("getAllChanges / getRecentChanges", () => {
    it("getAllChanges returns all changes chronologically", () => {
      ledger.recordChange("r1", "a.ts", "create", "1");
      ledger.recordChange("r2", "b.ts", "create", "2");
      ledger.recordChange("r3", "c.ts", "create", "3");

      const all = ledger.getAllChanges();
      assert.equal(all.length, 3);
    });

    it("getRecentChanges respects limit", () => {
      for (let i = 0; i < 10; i++) {
        ledger.recordChange(`r${i}`, `f${i}.ts`, "create", `#${i}`);
      }

      const recent = ledger.getRecentChanges(3);
      assert.ok(recent.length <= 3);
    });
  });

  describe("getRunChanges", () => {
    it("returns changes from a specific run", () => {
      ledger.recordChange("run-1", "a.ts", "create", "1");
      ledger.recordChange("run-1", "b.ts", "modify", "2");
      ledger.recordChange("run-2", "c.ts", "create", "3");

      const runChanges = ledger.getRunChanges("run-1");
      assert.equal(runChanges.length, 2);
    });
  });

  // ---------------------------------------------------------------------------
  // Hotspots
  // ---------------------------------------------------------------------------

  describe("getHotspotFiles", () => {
    it("returns most frequently modified files", () => {
      ledger.recordChange("r1", "hot.ts", "modify", "1");
      ledger.recordChange("r2", "hot.ts", "modify", "2");
      ledger.recordChange("r3", "hot.ts", "modify", "3");
      ledger.recordChange("r4", "cold.ts", "modify", "1");

      const hotspots = ledger.getHotspotFiles(2);
      assert.ok(hotspots.length >= 1);
      assert.equal(hotspots[0].file, "hot.ts");
      assert.equal(hotspots[0].changeCount, 3);
    });
  });

  describe("getModifiedFiles", () => {
    it("returns unique set of modified files", () => {
      ledger.recordChange("r1", "a.ts", "create", "1");
      ledger.recordChange("r2", "a.ts", "modify", "2");
      ledger.recordChange("r3", "b.ts", "create", "3");

      const modified = ledger.getModifiedFiles();
      assert.equal(modified.length, 2);
      assert.ok(modified.includes("a.ts"));
      assert.ok(modified.includes("b.ts"));
    });
  });

  // ---------------------------------------------------------------------------
  // Dependencies & impact analysis
  // ---------------------------------------------------------------------------

  describe("getDependents / getDependencies", () => {
    it("tracks file dependencies", () => {
      ledger.recordChange("r1", "src/routes.ts", "modify", "added route", {
        dependsOn: ["src/service.ts"],
      });

      const dependents = ledger.getDependents("src/service.ts");
      assert.ok(dependents.includes("src/routes.ts"));

      const deps = ledger.getDependencies("src/routes.ts");
      assert.ok(deps.includes("src/service.ts"));
    });
  });

  describe("analyzeImpact", () => {
    it("finds direct and transitive dependents", () => {
      ledger.recordChange("r1", "src/b.ts", "modify", "depends on a", {
        dependsOn: ["src/a.ts"],
      });
      ledger.recordChange("r2", "src/c.ts", "modify", "depends on b", {
        dependsOn: ["src/b.ts"],
      });

      const impact = ledger.analyzeImpact("src/a.ts");
      assert.ok(impact.directDependents.includes("src/b.ts"));
      assert.ok(impact.transitiveDependents.includes("src/c.ts"));
    });
  });

  // ---------------------------------------------------------------------------
  // Search and filtering
  // ---------------------------------------------------------------------------

  describe("searchByReason", () => {
    it("finds changes by reason text", () => {
      ledger.recordChange("r1", "a.ts", "create", "Fix authentication bug");
      ledger.recordChange("r2", "b.ts", "create", "Add validation");

      const results = ledger.searchByReason("authentication");
      assert.equal(results.length, 1);
      assert.equal(results[0].file, "a.ts");
    });
  });

  describe("wasModified / wasDeleted", () => {
    it("wasModified returns true for changed files", () => {
      ledger.recordChange("r1", "src/app.ts", "modify", "update");
      assert.ok(ledger.wasModified("src/app.ts"));
      assert.ok(!ledger.wasModified("other.ts"));
    });

    it("wasDeleted returns true for deleted files", () => {
      ledger.recordChange("r1", "old.ts", "delete", "cleanup");
      assert.ok(ledger.wasDeleted("old.ts"));
    });
  });

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  describe("getStats", () => {
    it("computes change statistics", () => {
      ledger.recordChanges("run-1", [
        { file: "a.ts", operation: "create", reason: "new" },
        { file: "b.ts", operation: "modify", reason: "fix" },
      ]);
      ledger.recordChange("run-2", "a.ts", "modify", "update");

      const stats = ledger.getStats();
      assert.equal(stats.totalChanges, 3);
      assert.equal(stats.uniqueFiles, 2);
      assert.equal(stats.uniqueRuns, 2);
      assert.equal(stats.byOperation.create, 1);
      assert.equal(stats.byOperation.modify, 2);
      assert.ok(stats.avgChangesPerRun === 1.5);
    });
  });

  // ---------------------------------------------------------------------------
  // Timeline & summary
  // ---------------------------------------------------------------------------

  describe("getTimeline", () => {
    it("returns changes grouped by run in chronological order", () => {
      ledger.recordChange("run-1", "a.ts", "create", "first");
      ledger.recordChange("run-2", "b.ts", "create", "second");

      const timeline = ledger.getTimeline();
      assert.ok(timeline.length >= 1);
      assert.ok(timeline[0].runId);
      assert.ok(timeline[0].timestamp);
      assert.ok(timeline[0].changes.length > 0);
    });
  });

  describe("getSummary", () => {
    it("returns a human-readable summary", () => {
      ledger.recordChanges("run-1", [
        { file: "a.ts", operation: "create", reason: "new" },
        { file: "b.ts", operation: "modify", reason: "fix" },
      ]);

      const summary = ledger.getSummary();
      assert.ok(typeof summary === "string");
      assert.ok(summary.includes("2")); // 2 total changes or 2 files
    });
  });
});
