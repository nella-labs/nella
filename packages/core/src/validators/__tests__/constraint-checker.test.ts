import test from "node:test";
import assert from "node:assert/strict";
import {
  checkFilesNotToModify,
  checkForbiddenPatterns,
  checkConstraint,
  checkConstraints,
  getViolatedConstraints,
  countViolations,
} from "../constraint-checker";
import type { Constraint, ConstraintResult } from "../../types";

// =============================================================================
// Helpers
// =============================================================================

function constraint(
  overrides: Partial<Constraint> & { id?: string } = {}
): Constraint {
  return {
    id: overrides.id ?? "c1",
    description: "test constraint",
    rule: "test rule",
    ...overrides,
  };
}

// =============================================================================
// checkFilesNotToModify
// =============================================================================

test("checkFilesNotToModify: passes when no files match", () => {
  const c = constraint({ filesNotToModify: ["*.lock"] });
  const result = checkFilesNotToModify(["src/index.ts"], c);
  assert.equal(result.passed, true);
});

test("checkFilesNotToModify: fails when file matches glob", () => {
  const c = constraint({ filesNotToModify: ["*.lock"] });
  const result = checkFilesNotToModify(["pnpm-lock.yaml", "package-lock.json"], c);
  // *.lock won't match pnpm-lock.yaml (it has .yaml extension), but let's use a matching case
  const c2 = constraint({ filesNotToModify: ["**/*.lock.yaml"] });
  // Actually let's test exact match patterns
  const c3 = constraint({ filesNotToModify: ["package.json"] });
  const r3 = checkFilesNotToModify(["package.json", "src/app.ts"], c3);
  assert.equal(r3.passed, false);
  assert.ok(r3.violationDetails?.includes("package.json"));
});

test("checkFilesNotToModify: glob ** matches nested paths", () => {
  const c = constraint({ filesNotToModify: ["**/migrations/**"] });
  const result = checkFilesNotToModify(
    ["db/migrations/001.sql", "src/app.ts"],
    c
  );
  assert.equal(result.passed, false);
  assert.ok(result.violationDetails?.includes("migrations"));
});

test("checkFilesNotToModify: passes with empty patterns list", () => {
  const c = constraint({ filesNotToModify: [] });
  const result = checkFilesNotToModify(["anything.ts"], c);
  assert.equal(result.passed, true);
});

test("checkFilesNotToModify: passes with undefined filesNotToModify", () => {
  const c = constraint({ filesNotToModify: undefined });
  const result = checkFilesNotToModify(["anything.ts"], c);
  assert.equal(result.passed, true);
});

test("checkFilesNotToModify: backslash paths normalized", () => {
  const c = constraint({ filesNotToModify: ["src/**/*.ts"] });
  const result = checkFilesNotToModify(["src\\utils\\helper.ts"], c);
  assert.equal(result.passed, false);
});

test("checkFilesNotToModify: case-insensitive matching", () => {
  const c = constraint({ filesNotToModify: ["README.md"] });
  const result = checkFilesNotToModify(["readme.md"], c);
  assert.equal(result.passed, false);
});

// =============================================================================
// checkForbiddenPatterns
// =============================================================================

test("checkForbiddenPatterns: passes when no pattern matches", () => {
  const c = constraint({ forbiddenPatterns: ["console\\.log"] });
  const result = checkForbiddenPatterns("const x = 1;", c);
  assert.equal(result.passed, true);
});

test("checkForbiddenPatterns: fails when regex matches diff", () => {
  const c = constraint({ forbiddenPatterns: ["console\\.log"] });
  const result = checkForbiddenPatterns("console.log('debug');", c);
  assert.equal(result.passed, false);
  assert.ok(result.violationDetails?.includes("console\\.log"));
});

test("checkForbiddenPatterns: case-insensitive matching", () => {
  const c = constraint({ forbiddenPatterns: ["TODO"] });
  const result = checkForbiddenPatterns("// todo: fix this", c);
  assert.equal(result.passed, false);
});

test("checkForbiddenPatterns: invalid regex falls back to literal match", () => {
  const c = constraint({ forbiddenPatterns: ["[invalid(regex"] });
  // It should fall back to literal substring match
  const result = checkForbiddenPatterns("this has [invalid(regex in it", c);
  assert.equal(result.passed, false);
});

test("checkForbiddenPatterns: invalid regex with no literal match passes", () => {
  const c = constraint({ forbiddenPatterns: ["[invalid(regex"] });
  const result = checkForbiddenPatterns("clean code here", c);
  assert.equal(result.passed, true);
});

test("checkForbiddenPatterns: empty patterns list passes", () => {
  const c = constraint({ forbiddenPatterns: [] });
  const result = checkForbiddenPatterns("anything goes", c);
  assert.equal(result.passed, true);
});

test("checkForbiddenPatterns: empty diff passes", () => {
  const c = constraint({ forbiddenPatterns: ["something"] });
  const result = checkForbiddenPatterns("", c);
  assert.equal(result.passed, true);
});

// =============================================================================
// checkConstraint
// =============================================================================

test("checkConstraint: passes when both file and pattern checks pass", () => {
  const c = constraint({
    filesNotToModify: ["*.lock"],
    forbiddenPatterns: ["eval\\("],
  });
  const result = checkConstraint(["src/app.ts"], "const x = 1;", c);
  assert.equal(result.passed, true);
});

test("checkConstraint: fails on file violation even if patterns pass", () => {
  const c = constraint({
    filesNotToModify: ["src/app.ts"],
    forbiddenPatterns: ["eval\\("],
  });
  const result = checkConstraint(["src/app.ts"], "const x = 1;", c);
  assert.equal(result.passed, false);
});

test("checkConstraint: fails on pattern violation even if files pass", () => {
  const c = constraint({
    filesNotToModify: ["*.lock"],
    forbiddenPatterns: ["eval\\("],
  });
  const result = checkConstraint(["src/app.ts"], "eval('dangerous')", c);
  assert.equal(result.passed, false);
});

test("checkConstraint: passes with no constraints set", () => {
  const c = constraint({});
  const result = checkConstraint(["src/app.ts"], "any diff", c);
  assert.equal(result.passed, true);
});

// =============================================================================
// checkConstraints
// =============================================================================

test("checkConstraints: returns result per constraint", () => {
  const constraints = [
    constraint({ id: "c1", filesNotToModify: ["*.lock"] }),
    constraint({ id: "c2", forbiddenPatterns: ["eval\\("] }),
  ];
  const results = checkConstraints(["src/app.ts"], "const x = 1;", constraints);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, "c1");
  assert.equal(results[1].id, "c2");
  assert.equal(results[0].passed, true);
  assert.equal(results[1].passed, true);
});

test("checkConstraints: empty constraints array returns empty results", () => {
  const results = checkConstraints(["file.ts"], "diff", []);
  assert.deepEqual(results, []);
});

// =============================================================================
// getViolatedConstraints
// =============================================================================

test("getViolatedConstraints: filters only violations", () => {
  const results: ConstraintResult[] = [
    { id: "c1", passed: true },
    { id: "c2", passed: false, violationDetails: "bad" },
    { id: "c3", passed: true },
    { id: "c4", passed: false, violationDetails: "also bad" },
  ];
  assert.deepEqual(getViolatedConstraints(results), ["c2", "c4"]);
});

test("getViolatedConstraints: returns empty for all passing", () => {
  const results: ConstraintResult[] = [
    { id: "c1", passed: true },
    { id: "c2", passed: true },
  ];
  assert.deepEqual(getViolatedConstraints(results), []);
});

// =============================================================================
// countViolations
// =============================================================================

test("countViolations: counts correctly", () => {
  const results: ConstraintResult[] = [
    { id: "c1", passed: true },
    { id: "c2", passed: false },
    { id: "c3", passed: false },
    { id: "c4", passed: true },
  ];
  assert.equal(countViolations(results), 2);
});

test("countViolations: zero when all pass", () => {
  const results: ConstraintResult[] = [{ id: "c1", passed: true }];
  assert.equal(countViolations(results), 0);
});

test("countViolations: empty array returns 0", () => {
  assert.equal(countViolations([]), 0);
});
