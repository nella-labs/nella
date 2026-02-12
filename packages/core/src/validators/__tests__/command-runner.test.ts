import test from "node:test";
import assert from "node:assert/strict";
import {
  runCommand,
  runValidation,
  getValidationErrors,
  calculateValidationIntegrity,
} from "../command-runner";
import type { ValidationResult, CommandResult } from "../../types";
import { tempDir, writeWorkspaceFile } from "../../__tests__/helpers";

// =============================================================================
// getValidationErrors (pure)
// =============================================================================

test("getValidationErrors: returns empty string when all pass", () => {
  const result: ValidationResult = {
    test: { command: "echo ok", success: true, output: "ok", exitCode: 0, durationMs: 10 },
    lint: { command: "echo ok", success: true, output: "ok", exitCode: 0, durationMs: 10 },
    compile: null,
    allPassed: true,
  };
  assert.equal(getValidationErrors(result), "");
});

test("getValidationErrors: returns test failure", () => {
  const result: ValidationResult = {
    test: { command: "jest", success: false, output: "FAIL src/app.test.ts", exitCode: 1, durationMs: 100 },
    lint: null,
    compile: null,
    allPassed: false,
  };
  const errors = getValidationErrors(result);
  assert.ok(errors.includes("Test failed"));
  assert.ok(errors.includes("FAIL src/app.test.ts"));
});

test("getValidationErrors: returns lint failure", () => {
  const result: ValidationResult = {
    test: null,
    lint: { command: "eslint", success: false, output: "2 errors", exitCode: 1, durationMs: 50 },
    compile: null,
    allPassed: false,
  };
  const errors = getValidationErrors(result);
  assert.ok(errors.includes("Lint failed"));
  assert.ok(errors.includes("2 errors"));
});

test("getValidationErrors: returns compile failure", () => {
  const result: ValidationResult = {
    test: null,
    lint: null,
    compile: { command: "tsc", success: false, output: "TS2345: error", exitCode: 1, durationMs: 200 },
    allPassed: false,
  };
  const errors = getValidationErrors(result);
  assert.ok(errors.includes("Compile failed"));
});

test("getValidationErrors: multiple failures concatenated", () => {
  const result: ValidationResult = {
    test: { command: "jest", success: false, output: "test fail", exitCode: 1, durationMs: 50 },
    lint: { command: "eslint", success: false, output: "lint fail", exitCode: 1, durationMs: 50 },
    compile: null,
    allPassed: false,
  };
  const errors = getValidationErrors(result);
  assert.ok(errors.includes("Test failed"));
  assert.ok(errors.includes("Lint failed"));
});

test("getValidationErrors: all null results returns empty", () => {
  const result: ValidationResult = {
    test: null,
    lint: null,
    compile: null,
    allPassed: true,
  };
  assert.equal(getValidationErrors(result), "");
});

// =============================================================================
// calculateValidationIntegrity (pure)
// =============================================================================

test("calculateValidationIntegrity: all pass returns 1", () => {
  const result: ValidationResult = {
    test: { command: "echo", success: true, output: "", exitCode: 0, durationMs: 1 },
    lint: { command: "echo", success: true, output: "", exitCode: 0, durationMs: 1 },
    compile: { command: "echo", success: true, output: "", exitCode: 0, durationMs: 1 },
    allPassed: true,
  };
  assert.equal(calculateValidationIntegrity(result), 1);
});

test("calculateValidationIntegrity: all fail returns 0", () => {
  const result: ValidationResult = {
    test: { command: "echo", success: false, output: "", exitCode: 1, durationMs: 1 },
    lint: { command: "echo", success: false, output: "", exitCode: 1, durationMs: 1 },
    compile: { command: "echo", success: false, output: "", exitCode: 1, durationMs: 1 },
    allPassed: false,
  };
  assert.equal(calculateValidationIntegrity(result), 0);
});

test("calculateValidationIntegrity: partial pass", () => {
  const result: ValidationResult = {
    test: { command: "echo", success: true, output: "", exitCode: 0, durationMs: 1 },
    lint: { command: "echo", success: false, output: "", exitCode: 1, durationMs: 1 },
    compile: null,
    allPassed: false,
  };
  assert.equal(calculateValidationIntegrity(result), 0.5);
});

test("calculateValidationIntegrity: all null returns 1 (no checks = valid)", () => {
  const result: ValidationResult = {
    test: null,
    lint: null,
    compile: null,
    allPassed: true,
  };
  assert.equal(calculateValidationIntegrity(result), 1);
});

test("calculateValidationIntegrity: 1 of 3 pass returns 1/3", () => {
  const result: ValidationResult = {
    test: { command: "echo", success: true, output: "", exitCode: 0, durationMs: 1 },
    lint: { command: "echo", success: false, output: "", exitCode: 1, durationMs: 1 },
    compile: { command: "echo", success: false, output: "", exitCode: 1, durationMs: 1 },
    allPassed: false,
  };
  const integrity = calculateValidationIntegrity(result);
  assert.ok(Math.abs(integrity - 1 / 3) < 0.001);
});

// =============================================================================
// runCommand (executes real commands — minimal tests)
// =============================================================================

test("runCommand: captures successful command output", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const result = runCommand("echo hello", dir);
    assert.equal(result.success, true);
    assert.equal(result.exitCode, 0);
    assert.ok(result.output.includes("hello"));
    assert.ok(result.durationMs >= 0);
    assert.equal(result.command, "echo hello");
  } finally {
    await cleanup();
  }
});

test("runCommand: captures failed command", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const result = runCommand("exit 1", dir);
    assert.equal(result.success, false);
    assert.equal(result.exitCode, 1);
  } finally {
    await cleanup();
  }
});

// =============================================================================
// runValidation (integration-style)
// =============================================================================

test("runValidation: runs all configured commands", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const result = runValidation(
      { test: "echo test-ok", lint: "echo lint-ok" },
      dir
    );
    assert.equal(result.allPassed, true);
    assert.ok(result.test?.success);
    assert.ok(result.lint?.success);
    assert.equal(result.compile, null);
  } finally {
    await cleanup();
  }
});

test("runValidation: allPassed false when one fails", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const result = runValidation(
      { test: "echo ok", lint: "exit 1" },
      dir
    );
    assert.equal(result.allPassed, false);
    assert.ok(result.test?.success);
    assert.equal(result.lint?.success, false);
  } finally {
    await cleanup();
  }
});

test("runValidation: empty config runs nothing and passes", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const result = runValidation({}, dir);
    assert.equal(result.allPassed, true);
    assert.equal(result.test, null);
    assert.equal(result.lint, null);
    assert.equal(result.compile, null);
  } finally {
    await cleanup();
  }
});
