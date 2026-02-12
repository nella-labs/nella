import test from "node:test";
import assert from "node:assert/strict";
import {
  checkFilesNotToModify,
  checkForbiddenPatterns,
  checkAllConstraints,
  getViolatedConstraints,
} from "../constraint-checker";
import type { Constraint } from "../../types";

// =============================================================================
// Helpers
// =============================================================================

function makeConstraint(overrides: Partial<Constraint> = {}): Constraint {
  return {
    id: "c1",
    description: "test constraint",
    rule: "do not modify",
    ...overrides,
  } as Constraint;
}

// =============================================================================
// checkFilesNotToModify
// =============================================================================

test("checkFilesNotToModify: no violation when no forbidden files", () => {
  const c = makeConstraint({ filesNotToModify: [] });
  const result = checkFilesNotToModify(["src/app.ts"], c);
  assert.equal(result.violated, false);
});

test("checkFilesNotToModify: violation on exact match", () => {
  const c = makeConstraint({ filesNotToModify: ["package.json"] });
  const result = checkFilesNotToModify(["package.json", "src/app.ts"], c);
  assert.equal(result.violated, true);
  assert.ok(result.reason?.includes("package.json"));
});

test("checkFilesNotToModify: violation on glob pattern", () => {
  const c = makeConstraint({ filesNotToModify: ["prisma/**"] });
  const result = checkFilesNotToModify(["prisma/schema.prisma"], c);
  assert.equal(result.violated, true);
});

test("checkFilesNotToModify: no violation when files don't match", () => {
  const c = makeConstraint({ filesNotToModify: ["config/**"] });
  const result = checkFilesNotToModify(["src/app.ts"], c);
  assert.equal(result.violated, false);
});

// =============================================================================
// checkForbiddenPatterns
// =============================================================================

test("checkForbiddenPatterns: no violation when no patterns", () => {
  const c = makeConstraint({ forbiddenPatterns: [] });
  const result = checkForbiddenPatterns("any diff content", c);
  assert.equal(result.violated, false);
});

test("checkForbiddenPatterns: violation on match", () => {
  const c = makeConstraint({ forbiddenPatterns: ["console\\.log"] });
  const result = checkForbiddenPatterns("+  console.log('debug')", c);
  assert.equal(result.violated, true);
  assert.ok(result.reason?.includes("console\\.log"));
});

test("checkForbiddenPatterns: case insensitive", () => {
  const c = makeConstraint({ forbiddenPatterns: ["TODO"] });
  const result = checkForbiddenPatterns("+ // todo: fix later", c);
  assert.equal(result.violated, true);
});

test("checkForbiddenPatterns: no violation when pattern absent", () => {
  const c = makeConstraint({ forbiddenPatterns: ["eval\\("] });
  const result = checkForbiddenPatterns("+  const x = 42;", c);
  assert.equal(result.violated, false);
});

// =============================================================================
// checkAllConstraints
// =============================================================================

test("checkAllConstraints: returns results for all constraints", () => {
  const constraints: Constraint[] = [
    makeConstraint({ id: "c1", filesNotToModify: ["a.ts"] }),
    makeConstraint({ id: "c2", forbiddenPatterns: ["eval"] }),
    makeConstraint({ id: "c3" }), // no restrictions
  ];

  const results = checkAllConstraints(["b.ts"], "clean diff", constraints);
  assert.equal(results.length, 3);
  assert.ok(results.every((r) => !r.violated));
});

test("checkAllConstraints: file violation stops before pattern check", () => {
  const constraints: Constraint[] = [
    makeConstraint({
      id: "c1",
      filesNotToModify: ["secret.ts"],
      forbiddenPatterns: ["eval"],
    }),
  ];

  // File violation should be caught even if diff is clean
  const results = checkAllConstraints(["secret.ts"], "no eval here", constraints);
  assert.equal(results.length, 1);
  assert.equal(results[0].violated, true);
  assert.ok(results[0].reason?.includes("secret.ts"));
});

test("checkAllConstraints: pattern violation when files ok", () => {
  const constraints: Constraint[] = [
    makeConstraint({
      id: "c1",
      filesNotToModify: ["config.ts"],
      forbiddenPatterns: ["DROP TABLE"],
    }),
  ];

  const results = checkAllConstraints(["src/app.ts"], "+ DROP TABLE users", constraints);
  assert.equal(results[0].violated, true);
  assert.ok(results[0].reason?.includes("DROP TABLE"));
});

// =============================================================================
// getViolatedConstraints
// =============================================================================

test("getViolatedConstraints: filters violated ids", () => {
  const results = [
    { constraintId: "c1", violated: true, reason: "bad" },
    { constraintId: "c2", violated: false },
    { constraintId: "c3", violated: true, reason: "also bad" },
  ];

  const violated = getViolatedConstraints(results);
  assert.deepEqual(violated, ["c1", "c3"]);
});

test("getViolatedConstraints: empty when none violated", () => {
  const results = [
    { constraintId: "c1", violated: false },
    { constraintId: "c2", violated: false },
  ];

  assert.deepEqual(getViolatedConstraints(results), []);
});
