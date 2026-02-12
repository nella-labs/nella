import test from "node:test";
import assert from "node:assert/strict";
import { writeArtifacts, createLogEntry, getArtifactDir } from "../artifact-writer";
import type { TaskRun, RunArtifacts, LogEntry } from "../../types";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "nella-test-"));
}

function makeRun(): TaskRun {
  return {
    taskId: "fix-bug",
    agent: "claude",
    nellaEnabled: false,
    timestamp: new Date().toISOString(),
    metrics: {
      btp: true, vi: 1, cvr: 0, sc: 0, rc: null, ttg: 5, ic: 1, da: 0.9,
      tokensUsed: 500, estimatedCost: 0.005,
    },
    validation: {
      testPassed: true, testOutput: "All tests pass",
      lintPassed: true, lintOutput: "",
      compilePassed: null, compileOutput: "",
    },
    passed: true,
    filesModified: ["src/fix.ts"],
    constraintViolations: [],
    refused: false,
    explanation: "Fixed the bug",
  };
}

function makeArtifacts(): RunArtifacts {
  return {
    diffPatch: "--- a/file.ts\n+++ b/file.ts\n- old\n+ new\n",
    logs: [
      createLogEntry("prompt", "Fix the bug"),
      createLogEntry("response", "Done"),
    ],
    commands: ["npm test", "npm run lint"],
    outputPath: "",
  };
}

// =============================================================================
// writeArtifacts
// =============================================================================

test("writeArtifacts: creates all artifact files", () => {
  const dir = tempDir();
  try {
    writeArtifacts(
      { outputDir: dir, agent: "claude", taskId: "fix-bug" },
      makeArtifacts(),
      makeRun()
    );

    const taskDir = join(dir, "claude", "fix-bug");
    assert.ok(existsSync(join(taskDir, "diff.patch")));
    assert.ok(existsSync(join(taskDir, "logs.jsonl")));
    assert.ok(existsSync(join(taskDir, "commands.txt")));
    assert.ok(existsSync(join(taskDir, "metrics.json")));
    assert.ok(existsSync(join(taskDir, "cost.json")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeArtifacts: diff.patch has correct content", () => {
  const dir = tempDir();
  try {
    const artifacts = makeArtifacts();
    writeArtifacts({ outputDir: dir, agent: "a", taskId: "t" }, artifacts, makeRun());

    const content = readFileSync(join(dir, "a", "t", "diff.patch"), "utf-8");
    assert.ok(content.includes("+++ b/file.ts"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeArtifacts: logs.jsonl has parseable entries", () => {
  const dir = tempDir();
  try {
    writeArtifacts({ outputDir: dir, agent: "a", taskId: "t" }, makeArtifacts(), makeRun());

    const content = readFileSync(join(dir, "a", "t", "logs.jsonl"), "utf-8");
    const lines = content.split("\n").filter(Boolean);
    assert.equal(lines.length, 2);
    const first = JSON.parse(lines[0]);
    assert.equal(first.type, "prompt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeArtifacts: commands.txt has all commands", () => {
  const dir = tempDir();
  try {
    writeArtifacts({ outputDir: dir, agent: "a", taskId: "t" }, makeArtifacts(), makeRun());

    const content = readFileSync(join(dir, "a", "t", "commands.txt"), "utf-8");
    assert.ok(content.includes("npm test"));
    assert.ok(content.includes("npm run lint"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeArtifacts: metrics.json is valid JSON", () => {
  const dir = tempDir();
  try {
    writeArtifacts({ outputDir: dir, agent: "a", taskId: "t" }, makeArtifacts(), makeRun());

    const content = readFileSync(join(dir, "a", "t", "metrics.json"), "utf-8");
    const metrics = JSON.parse(content);
    assert.equal(metrics.btp, true);
    assert.equal(metrics.vi, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeArtifacts: writes validation outputs", () => {
  const dir = tempDir();
  try {
    writeArtifacts({ outputDir: dir, agent: "a", taskId: "t" }, makeArtifacts(), makeRun());

    const testOutput = readFileSync(join(dir, "a", "t", "validation", "test.txt"), "utf-8");
    assert.equal(testOutput, "All tests pass");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// =============================================================================
// createLogEntry
// =============================================================================

test("createLogEntry: creates entry with timestamp", () => {
  const entry = createLogEntry("command", "npm test");
  assert.equal(entry.type, "command");
  assert.equal(entry.content, "npm test");
  assert.ok(entry.timestamp);
});

// =============================================================================
// getArtifactDir
// =============================================================================

test("getArtifactDir: returns correct path", () => {
  const dir = getArtifactDir("/output", "claude", "task-1");
  assert.ok(dir.includes("claude"));
  assert.ok(dir.includes("task-1"));
});
