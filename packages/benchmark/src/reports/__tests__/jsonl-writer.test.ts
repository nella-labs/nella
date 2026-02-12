import test from "node:test";
import assert from "node:assert/strict";
import { appendResult, readResults, clearResults } from "../jsonl-writer";
import type { TaskRun, Metrics, ValidationResults } from "../../types";
import { mkdtempSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "nella-test-"));
}

function makeRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    taskId: "task-1",
    agent: "claude",
    nellaEnabled: false,
    timestamp: new Date().toISOString(),
    metrics: {
      btp: true, vi: 1, cvr: 0, sc: 0, rc: null, ttg: 5, ic: 1, da: 1,
      tokensUsed: 1000, estimatedCost: 0.01,
    },
    validation: {
      testPassed: true, testOutput: "ok",
      lintPassed: true, lintOutput: "",
      compilePassed: true, compileOutput: "",
    },
    passed: true,
    filesModified: ["src/app.ts"],
    constraintViolations: [],
    refused: false,
    explanation: "done",
    ...overrides,
  };
}

// =============================================================================
// appendResult
// =============================================================================

test("appendResult: creates file and writes JSONL", () => {
  const dir = tempDir();
  try {
    appendResult(dir, makeRun());
    assert.ok(existsSync(join(dir, "results.jsonl")));

    const runs = readResults(dir);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].taskId, "task-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("appendResult: appends to existing file", () => {
  const dir = tempDir();
  try {
    appendResult(dir, makeRun({ taskId: "t1" }));
    appendResult(dir, makeRun({ taskId: "t2" }));
    appendResult(dir, makeRun({ taskId: "t3" }));

    const runs = readResults(dir);
    assert.equal(runs.length, 3);
    assert.equal(runs[0].taskId, "t1");
    assert.equal(runs[2].taskId, "t3");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("appendResult: creates output dir if missing", () => {
  const dir = join(tempDir(), "nested", "output");
  try {
    appendResult(dir, makeRun());
    assert.ok(existsSync(join(dir, "results.jsonl")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// =============================================================================
// readResults
// =============================================================================

test("readResults: returns empty array when no file", () => {
  const dir = tempDir();
  try {
    assert.deepEqual(readResults(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readResults: parses JSONL correctly", () => {
  const dir = tempDir();
  try {
    const run = makeRun({ agent: "gpt-4" });
    appendResult(dir, run);

    const results = readResults(dir);
    assert.equal(results[0].agent, "gpt-4");
    assert.equal(results[0].metrics.btp, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// =============================================================================
// clearResults
// =============================================================================

test("clearResults: removes results file", () => {
  const dir = tempDir();
  try {
    appendResult(dir, makeRun());
    assert.ok(existsSync(join(dir, "results.jsonl")));

    clearResults(dir);
    assert.equal(existsSync(join(dir, "results.jsonl")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clearResults: no error when file doesn't exist", () => {
  const dir = tempDir();
  try {
    clearResults(dir); // Should not throw
    assert.ok(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
