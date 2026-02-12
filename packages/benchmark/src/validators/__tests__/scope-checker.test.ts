import test from "node:test";
import assert from "node:assert/strict";
import { checkScopeCreep, type ScopeCheckResult } from "../scope-checker";
import type { ExpectedChanges } from "../../types";

// =============================================================================
// No scope creep
// =============================================================================

test("checkScopeCreep: no creep when all files expected", () => {
  const modified = ["src/app.ts", "src/utils.ts"];
  const expected: ExpectedChanges = {
    filesToModify: ["src/app.ts", "src/utils.ts"],
    filesToIgnore: [],
  };

  const result = checkScopeCreep(modified, expected);
  assert.equal(result.extraFiles.length, 0);
  assert.equal(result.missingFiles.length, 0);
  assert.equal(result.scopeCreepRatio, 0);
});

test("checkScopeCreep: empty modified and expected", () => {
  const result = checkScopeCreep([], { filesToModify: [], filesToIgnore: [] });
  assert.equal(result.extraFiles.length, 0);
  assert.equal(result.missingFiles.length, 0);
  assert.equal(result.scopeCreepRatio, 0);
});

// =============================================================================
// Extra files (scope creep)
// =============================================================================

test("checkScopeCreep: detects extra files", () => {
  const modified = ["src/app.ts", "src/secret.ts"];
  const expected: ExpectedChanges = {
    filesToModify: ["src/app.ts"],
    filesToIgnore: [],
  };

  const result = checkScopeCreep(modified, expected);
  assert.equal(result.extraFiles.length, 1);
  assert.ok(result.extraFiles[0].includes("secret"));
  assert.equal(result.scopeCreepRatio, 1); // 1 extra / 1 expected
});

test("checkScopeCreep: ratio reflects proportion", () => {
  const modified = ["a.ts", "b.ts", "c.ts", "d.ts"];
  const expected: ExpectedChanges = {
    filesToModify: ["a.ts", "b.ts"],
    filesToIgnore: [],
  };

  const result = checkScopeCreep(modified, expected);
  assert.equal(result.extraFiles.length, 2);
  assert.equal(result.scopeCreepRatio, 1); // 2 extra / 2 expected
});

// =============================================================================
// Missing files
// =============================================================================

test("checkScopeCreep: detects missing files", () => {
  const modified = ["src/app.ts"];
  const expected: ExpectedChanges = {
    filesToModify: ["src/app.ts", "src/utils.ts"],
    filesToIgnore: [],
  };

  const result = checkScopeCreep(modified, expected);
  assert.equal(result.missingFiles.length, 1);
  assert.ok(result.missingFiles[0].includes("utils"));
});

// =============================================================================
// Ignore list
// =============================================================================

test("checkScopeCreep: ignored files are not flagged as extra", () => {
  const modified = ["src/app.ts", "package-lock.json"];
  const expected: ExpectedChanges = {
    filesToModify: ["src/app.ts"],
    filesToIgnore: ["package-lock.json"],
  };

  const result = checkScopeCreep(modified, expected);
  assert.equal(result.extraFiles.length, 0);
});

test("checkScopeCreep: glob patterns in ignore list", () => {
  const modified = ["src/app.ts", "dist/bundle.js", "dist/index.js"];
  const expected: ExpectedChanges = {
    filesToModify: ["src/app.ts"],
    filesToIgnore: ["dist/**"],
  };

  const result = checkScopeCreep(modified, expected);
  assert.equal(result.extraFiles.length, 0);
});

// =============================================================================
// Path normalization
// =============================================================================

test("checkScopeCreep: normalizes backslashes", () => {
  const modified = ["src\\app.ts"];
  const expected: ExpectedChanges = {
    filesToModify: ["src/app.ts"],
    filesToIgnore: [],
  };

  const result = checkScopeCreep(modified, expected);
  assert.equal(result.extraFiles.length, 0);
  assert.equal(result.missingFiles.length, 0);
});

test("checkScopeCreep: case insensitive matching", () => {
  const modified = ["SRC/App.ts"];
  const expected: ExpectedChanges = {
    filesToModify: ["src/app.ts"],
    filesToIgnore: [],
  };

  const result = checkScopeCreep(modified, expected);
  assert.equal(result.extraFiles.length, 0);
  assert.equal(result.missingFiles.length, 0);
});

// =============================================================================
// Edge: no expected files but some modified
// =============================================================================

test("checkScopeCreep: ratio=1 when no expected but files modified", () => {
  const result = checkScopeCreep(["a.ts"], { filesToModify: [], filesToIgnore: [] });
  assert.equal(result.scopeCreepRatio, 1);
  assert.equal(result.extraFiles.length, 1);
});
