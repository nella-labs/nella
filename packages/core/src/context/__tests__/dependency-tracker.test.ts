/**
 * DependencyTracker Tests
 *
 * Tests for dependency snapshot, comparison, and drift detection.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DependencyTracker } from "../dependency-tracker";

let tmpDir: string;
let tracker: DependencyTracker;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nella-dep-test-"));
  tracker = new DependencyTracker();
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function writePkg(deps: Record<string, string> = {}, devDeps: Record<string, string> = {}, engines?: Record<string, string>) {
  const pkg: Record<string, unknown> = { name: "test-project", version: "1.0.0" };
  if (Object.keys(deps).length > 0) pkg.dependencies = deps;
  if (Object.keys(devDeps).length > 0) pkg.devDependencies = devDeps;
  if (engines) pkg.engines = engines;
  fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify(pkg, null, 2));
}

describe("DependencyTracker", () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  // ===========================================================================
  // takeSnapshot
  // ===========================================================================

  describe("takeSnapshot", () => {
    it("captures package.json hash and packages", () => {
      writePkg({ express: "^4.18.0", lodash: "^4.17.21" });

      const snapshot = tracker.takeSnapshot(tmpDir);

      assert.ok(snapshot.takenAt);
      assert.ok(snapshot.packageJsonHash.length > 0);
      assert.equal(snapshot.lockfileType, "none");
      assert.equal(snapshot.lockfileHash, "");
      assert.equal(Object.keys(snapshot.packages).length, 2);
      assert.equal(snapshot.packages["express"].version, "^4.18.0");
      assert.equal(snapshot.packages["express"].isDev, false);
      assert.equal(snapshot.packages["lodash"].version, "^4.17.21");
    });

    it("captures devDependencies with isDev=true", () => {
      writePkg({}, { vitest: "^1.0.0", typescript: "^5.0.0" });

      const snapshot = tracker.takeSnapshot(tmpDir);

      assert.equal(snapshot.packages["vitest"].isDev, true);
      assert.equal(snapshot.packages["typescript"].isDev, true);
    });

    it("detects npm lockfile", () => {
      writePkg({ express: "^4.18.0" });
      fs.writeFileSync(path.join(tmpDir, "package-lock.json"), "{}");

      const snapshot = tracker.takeSnapshot(tmpDir);

      assert.equal(snapshot.lockfileType, "npm");
      assert.ok(snapshot.lockfileHash.length > 0);
    });

    it("detects pnpm lockfile (highest priority)", () => {
      writePkg();
      fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "lockfileVersion: 9");
      fs.writeFileSync(path.join(tmpDir, "package-lock.json"), "{}");

      const snapshot = tracker.takeSnapshot(tmpDir);

      assert.equal(snapshot.lockfileType, "pnpm");
    });

    it("detects yarn lockfile", () => {
      writePkg();
      fs.writeFileSync(path.join(tmpDir, "yarn.lock"), "# yarn lockfile v1");

      const snapshot = tracker.takeSnapshot(tmpDir);

      assert.equal(snapshot.lockfileType, "yarn");
    });

    it("detects node version from .nvmrc", () => {
      writePkg();
      fs.writeFileSync(path.join(tmpDir, ".nvmrc"), "20.11.0");

      const snapshot = tracker.takeSnapshot(tmpDir);

      assert.equal(snapshot.nodeVersion, "20.11.0");
    });

    it("detects node version from .node-version", () => {
      writePkg();
      fs.writeFileSync(path.join(tmpDir, ".node-version"), "18.19.0");

      const snapshot = tracker.takeSnapshot(tmpDir);

      assert.equal(snapshot.nodeVersion, "18.19.0");
    });

    it("detects node version from package.json engines", () => {
      writePkg({}, {}, { node: ">=18.0.0" });

      const snapshot = tracker.takeSnapshot(tmpDir);

      assert.equal(snapshot.nodeVersion, ">=18.0.0");
    });

    it("handles missing package.json gracefully", () => {
      const snapshot = tracker.takeSnapshot(tmpDir);

      assert.equal(snapshot.packageJsonHash, "");
      assert.equal(Object.keys(snapshot.packages).length, 0);
    });
  });

  // ===========================================================================
  // compareSnapshots
  // ===========================================================================

  describe("compareSnapshots", () => {
    it("detects added packages", () => {
      writePkg({ express: "^4.18.0" });
      const prev = tracker.takeSnapshot(tmpDir);

      writePkg({ express: "^4.18.0", cors: "^2.8.5" });
      const curr = tracker.takeSnapshot(tmpDir);

      const changes = tracker.compareSnapshots(prev, curr);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].type, "added");
      assert.equal(changes[0].package, "cors");
      assert.equal(changes[0].version, "^2.8.5");
    });

    it("detects removed packages", () => {
      writePkg({ express: "^4.18.0", cors: "^2.8.5" });
      const prev = tracker.takeSnapshot(tmpDir);

      writePkg({ express: "^4.18.0" });
      const curr = tracker.takeSnapshot(tmpDir);

      const changes = tracker.compareSnapshots(prev, curr);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].type, "removed");
      assert.equal(changes[0].package, "cors");
      assert.equal(changes[0].previousVersion, "^2.8.5");
    });

    it("detects updated packages", () => {
      writePkg({ express: "^4.18.0" });
      const prev = tracker.takeSnapshot(tmpDir);

      writePkg({ express: "^4.19.0" });
      const curr = tracker.takeSnapshot(tmpDir);

      const changes = tracker.compareSnapshots(prev, curr);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].type, "updated");
      assert.equal(changes[0].package, "express");
      assert.equal(changes[0].previousVersion, "^4.18.0");
      assert.equal(changes[0].version, "^4.19.0");
    });

    it("returns empty array for identical snapshots", () => {
      writePkg({ express: "^4.18.0" });
      const prev = tracker.takeSnapshot(tmpDir);
      const curr = tracker.takeSnapshot(tmpDir);

      const changes = tracker.compareSnapshots(prev, curr);

      assert.equal(changes.length, 0);
    });

    it("detects multiple change types simultaneously", () => {
      writePkg({ express: "^4.18.0", lodash: "^4.17.21", cors: "^2.8.5" });
      const prev = tracker.takeSnapshot(tmpDir);

      writePkg({ express: "^4.19.0", zod: "^3.22.0" });
      const curr = tracker.takeSnapshot(tmpDir);

      const changes = tracker.compareSnapshots(prev, curr);

      const added = changes.filter((c) => c.type === "added");
      const removed = changes.filter((c) => c.type === "removed");
      const updated = changes.filter((c) => c.type === "updated");

      assert.equal(added.length, 1);
      assert.equal(added[0].package, "zod");
      assert.equal(removed.length, 2); // lodash + cors
      assert.equal(updated.length, 1);
      assert.equal(updated[0].package, "express");
    });
  });

  // ===========================================================================
  // getDiff
  // ===========================================================================

  describe("getDiff", () => {
    it("reports hasChanges when packages change", () => {
      writePkg({ express: "^4.18.0" });
      const prev = tracker.takeSnapshot(tmpDir);

      writePkg({ express: "^4.19.0" });
      const curr = tracker.takeSnapshot(tmpDir);

      const diff = tracker.getDiff(prev, curr);

      assert.ok(diff.hasChanges);
      assert.ok(diff.packageJsonChanged);
      assert.equal(diff.changes.length, 1);
    });

    it("reports no changes for identical snapshots", () => {
      writePkg({ express: "^4.18.0" });
      const snapshot = tracker.takeSnapshot(tmpDir);

      const diff = tracker.getDiff(snapshot, snapshot);

      assert.ok(!diff.hasChanges);
      assert.equal(diff.changes.length, 0);
    });

    it("finds affected assumptions", () => {
      writePkg({ express: "^4.18.0" });
      const prev = tracker.takeSnapshot(tmpDir);

      writePkg({ express: "^4.19.0" });
      const curr = tracker.takeSnapshot(tmpDir);

      const assumptions = [
        {
          id: "a1",
          type: "dependency" as const,
          description: "Using express 4.18 for routing",
          relatedFiles: [],
          confidence: 0.9,
          valid: true,
          createdAt: new Date().toISOString(),
        },
        {
          id: "a2",
          type: "behavior" as const,
          description: "Auth middleware works correctly",
          relatedFiles: [],
          confidence: 0.8,
          valid: true,
          createdAt: new Date().toISOString(),
        },
      ];

      const diff = tracker.getDiff(prev, curr, assumptions);

      assert.equal(diff.affectedAssumptions.length, 1);
      assert.equal(diff.affectedAssumptions[0].id, "a1");
    });
  });

  // ===========================================================================
  // hasChanged
  // ===========================================================================

  describe("hasChanged", () => {
    it("returns false when nothing changed", () => {
      writePkg({ express: "^4.18.0" });
      const snapshot = tracker.takeSnapshot(tmpDir);

      assert.ok(!tracker.hasChanged(tmpDir, snapshot));
    });

    it("returns true when package.json changes", () => {
      writePkg({ express: "^4.18.0" });
      const snapshot = tracker.takeSnapshot(tmpDir);

      writePkg({ express: "^4.19.0" });

      assert.ok(tracker.hasChanged(tmpDir, snapshot));
    });

    it("returns true when lockfile changes", () => {
      writePkg({ express: "^4.18.0" });
      fs.writeFileSync(path.join(tmpDir, "package-lock.json"), '{"lockfileVersion": 3}');
      const snapshot = tracker.takeSnapshot(tmpDir);

      fs.writeFileSync(path.join(tmpDir, "package-lock.json"), '{"lockfileVersion": 3, "updated": true}');

      assert.ok(tracker.hasChanged(tmpDir, snapshot));
    });
  });

  // ===========================================================================
  // listDependencies, hasPackage, getPackageVersion
  // ===========================================================================

  describe("dependency queries", () => {
    it("lists all dependencies", () => {
      writePkg({ express: "^4.18.0" }, { vitest: "^1.0.0" });

      const deps = tracker.listDependencies(tmpDir);

      assert.equal(deps.length, 2);
      const express = deps.find((d) => d.name === "express");
      const vitest = deps.find((d) => d.name === "vitest");
      assert.ok(express);
      assert.equal(express!.isDev, false);
      assert.ok(vitest);
      assert.equal(vitest!.isDev, true);
    });

    it("hasPackage returns true for existing package", () => {
      writePkg({ express: "^4.18.0" });

      assert.ok(tracker.hasPackage(tmpDir, "express"));
      assert.ok(!tracker.hasPackage(tmpDir, "nonexistent"));
    });

    it("getPackageVersion returns version or null", () => {
      writePkg({ express: "^4.18.0" });

      assert.equal(tracker.getPackageVersion(tmpDir, "express"), "^4.18.0");
      assert.equal(tracker.getPackageVersion(tmpDir, "nonexistent"), null);
    });
  });

  // ===========================================================================
  // summarizeChanges
  // ===========================================================================

  describe("summarizeChanges", () => {
    it("returns no changes message for empty array", () => {
      const summary = tracker.summarizeChanges([]);
      assert.ok(summary.includes("No dependency changes"));
    });

    it("summarizes added packages", () => {
      const summary = tracker.summarizeChanges([
        { type: "added", package: "cors", version: "^2.8.5", isDev: false },
      ]);
      assert.ok(summary.includes("Added"));
      assert.ok(summary.includes("cors@^2.8.5"));
    });

    it("summarizes removed packages", () => {
      const summary = tracker.summarizeChanges([
        { type: "removed", package: "lodash", previousVersion: "^4.17.0", isDev: false },
      ]);
      assert.ok(summary.includes("Removed"));
      assert.ok(summary.includes("lodash"));
    });

    it("summarizes updated packages", () => {
      const summary = tracker.summarizeChanges([
        { type: "updated", package: "express", version: "^4.19.0", previousVersion: "^4.18.0", isDev: false },
      ]);
      assert.ok(summary.includes("Updated"));
      assert.ok(summary.includes("express"));
      assert.ok(summary.includes("^4.18.0"));
      assert.ok(summary.includes("^4.19.0"));
    });
  });
});
