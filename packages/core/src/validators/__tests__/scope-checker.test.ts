import test from "node:test";
import assert from "node:assert/strict";
import { checkScope } from "../scope-checker";
import type { ExpectedChanges } from "../../types";

// =============================================================================
// Helpers
// =============================================================================

function expected(
  overrides: Partial<ExpectedChanges> = {}
): ExpectedChanges {
  return {
    filesToModify: [],
    filesToIgnore: [],
    ...overrides,
  };
}

// =============================================================================
// Basic Scope Checks
// =============================================================================

test("checkScope: no scope creep when modified matches expected", () => {
  const result = checkScope(
    ["src/app.ts", "src/utils.ts"],
    expected({ filesToModify: ["src/app.ts", "src/utils.ts"] })
  );
  assert.deepEqual(result.extraFiles, []);
  assert.deepEqual(result.missingFiles, []);
  assert.equal(result.scopeCreepRatio, 0);
});

test("checkScope: detects extra files outside scope", () => {
  const result = checkScope(
    ["src/app.ts", "src/secret.ts"],
    expected({ filesToModify: ["src/app.ts"] })
  );
  assert.deepEqual(result.extraFiles, ["src/secret.ts"]);
  assert.equal(result.scopeCreepRatio, 1); // 1 extra / 1 expected
});

test("checkScope: detects missing expected files", () => {
  const result = checkScope(
    ["src/app.ts"],
    expected({ filesToModify: ["src/app.ts", "src/helper.ts"] })
  );
  assert.deepEqual(result.missingFiles, ["src/helper.ts"]);
});

test("checkScope: both extra and missing", () => {
  const result = checkScope(
    ["src/rogue.ts"],
    expected({ filesToModify: ["src/expected.ts"] })
  );
  assert.deepEqual(result.extraFiles, ["src/rogue.ts"]);
  assert.deepEqual(result.missingFiles, ["src/expected.ts"]);
  assert.equal(result.scopeCreepRatio, 1);
});

// =============================================================================
// Ignore List
// =============================================================================

test("checkScope: ignored files are not counted as extra", () => {
  const result = checkScope(
    ["src/app.ts", "package-lock.json"],
    expected({
      filesToModify: ["src/app.ts"],
      filesToIgnore: ["package-lock.json"],
    })
  );
  assert.deepEqual(result.extraFiles, []);
  assert.equal(result.scopeCreepRatio, 0);
});

test("checkScope: ignore list supports glob patterns", () => {
  const result = checkScope(
    ["src/app.ts", "dist/bundle.js", "dist/styles.css"],
    expected({
      filesToModify: ["src/app.ts"],
      filesToIgnore: ["dist/**"],
    })
  );
  assert.deepEqual(result.extraFiles, []);
});

// =============================================================================
// Glob Matching for Expected Files
// =============================================================================

test("checkScope: expected files support glob patterns", () => {
  const result = checkScope(
    ["src/models/user.ts", "src/models/post.ts"],
    expected({ filesToModify: ["src/models/**"] })
  );
  assert.deepEqual(result.extraFiles, []);
  // The glob "src/models/**" is the expected pattern; files match it.
  // missingFiles checks if the glob pattern itself had matches.
  // Since actual files match the glob, it should not report missing.
});

// =============================================================================
// Edge Cases
// =============================================================================

test("checkScope: empty modified files - all expected are missing", () => {
  const result = checkScope(
    [],
    expected({ filesToModify: ["src/app.ts"] })
  );
  assert.deepEqual(result.missingFiles, ["src/app.ts"]);
  assert.deepEqual(result.extraFiles, []);
  assert.equal(result.scopeCreepRatio, 0); // 0 extra / 1 expected = 0
});

test("checkScope: empty expected - any file triggers scope creep", () => {
  const result = checkScope(
    ["src/rogue.ts"],
    expected({ filesToModify: [] })
  );
  assert.deepEqual(result.extraFiles, ["src/rogue.ts"]);
  assert.equal(result.scopeCreepRatio, 1); // >0 extras with 0 expected
});

test("checkScope: empty everything", () => {
  const result = checkScope([], expected());
  assert.deepEqual(result.extraFiles, []);
  assert.deepEqual(result.missingFiles, []);
  assert.equal(result.scopeCreepRatio, 0);
});

test("checkScope: backslash paths normalized", () => {
  const result = checkScope(
    ["src\\models\\user.ts"],
    expected({ filesToModify: ["src/models/user.ts"] })
  );
  assert.deepEqual(result.extraFiles, []);
  assert.deepEqual(result.missingFiles, []);
});

test("checkScope: scope creep ratio scales with number of extras", () => {
  const result = checkScope(
    ["src/app.ts", "extra1.ts", "extra2.ts", "extra3.ts"],
    expected({ filesToModify: ["src/app.ts"] })
  );
  assert.equal(result.extraFiles.length, 3);
  assert.equal(result.scopeCreepRatio, 3); // 3 extra / 1 expected
});
