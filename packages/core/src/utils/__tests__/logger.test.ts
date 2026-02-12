import test from "node:test";
import assert from "node:assert/strict";
import { RunLogger, generateRunId } from "../logger";
import { tempDir } from "../../__tests__/helpers";
import { readFileSync, mkdirSync } from "fs";
import { join } from "path";

// =============================================================================
// generateRunId (pure)
// =============================================================================

test("generateRunId: returns string in expected format", () => {
  const id = generateRunId();
  // Format: YYYY-MM-DD_HHMMSS_XXXX
  assert.ok(id.length > 10, "should be a non-trivial string");
  assert.ok(id.includes("_"), "should contain underscores");
  // Should start with a date-like pattern
  assert.ok(/^\d{4}-\d{2}-\d{2}_/.test(id), `unexpected format: ${id}`);
});

test("generateRunId: each call produces unique ID", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 50; i++) {
    ids.add(generateRunId());
  }
  // With randomness, all 50 should be unique
  assert.equal(ids.size, 50);
});

// =============================================================================
// RunLogger Construction
// =============================================================================

test("RunLogger: can be constructed with a directory", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const runDir = join(dir, "run-001");
    mkdirSync(runDir, { recursive: true });
    const logger = new RunLogger(runDir);
    assert.ok(logger);
  } finally {
    await cleanup();
  }
});

// =============================================================================
// Logging
// =============================================================================

test("RunLogger: log writes JSONL entry to file", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const runDir = join(dir, "run-001");
    mkdirSync(runDir, { recursive: true });
    const logger = new RunLogger(runDir);

    logger.log("plan", { files: ["a.ts"], summary: "do stuff" });

    const content = readFileSync(join(runDir, "logs.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    assert.equal(lines.length, 1);

    const entry = JSON.parse(lines[0]);
    assert.equal(entry.type, "plan");
    assert.ok(entry.ts);
    assert.deepEqual(entry.data.files, ["a.ts"]);
  } finally {
    await cleanup();
  }
});

test("RunLogger: multiple logs append to file", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const runDir = join(dir, "run-002");
    mkdirSync(runDir, { recursive: true });
    const logger = new RunLogger(runDir);

    logger.log("plan", { x: 1 });
    logger.log("validation", { x: 2 });
    logger.log("error", { x: 3 });

    const content = readFileSync(join(runDir, "logs.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    assert.equal(lines.length, 3);
  } finally {
    await cleanup();
  }
});

// =============================================================================
// Convenience Methods
// =============================================================================

test("RunLogger: logPlan writes plan entry", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const runDir = join(dir, "run");
    mkdirSync(runDir, { recursive: true });
    const logger = new RunLogger(runDir);

    logger.logPlan(["src/app.ts"], "implement feature X");

    const entries = logger.getEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, "plan");
    assert.deepEqual(entries[0].data.files, ["src/app.ts"]);
    assert.equal(entries[0].data.summary, "implement feature X");
  } finally {
    await cleanup();
  }
});

test("RunLogger: logRefusal writes refusal entry", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const runDir = join(dir, "run");
    mkdirSync(runDir, { recursive: true });
    const logger = new RunLogger(runDir);

    logger.logRefusal("risky operation", ["drop table"]);

    const entries = logger.getEntries();
    assert.equal(entries[0].type, "refusal");
    assert.equal(entries[0].data.reason, "risky operation");
  } finally {
    await cleanup();
  }
});

test("RunLogger: logConstraintCheck writes constraint_check entry", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const runDir = join(dir, "run");
    mkdirSync(runDir, { recursive: true });
    const logger = new RunLogger(runDir);

    logger.logConstraintCheck("c1", true, "all good");

    const entries = logger.getEntries();
    assert.equal(entries[0].type, "constraint_check");
    assert.equal(entries[0].data.id, "c1");
    assert.equal(entries[0].data.passed, true);
  } finally {
    await cleanup();
  }
});

test("RunLogger: logValidation writes validation entry", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const runDir = join(dir, "run");
    mkdirSync(runDir, { recursive: true });
    const logger = new RunLogger(runDir);

    logger.logValidation("test", true, 0);

    const entries = logger.getEntries();
    assert.equal(entries[0].type, "validation");
    assert.equal(entries[0].data.type, "test");
    assert.equal(entries[0].data.passed, true);
  } finally {
    await cleanup();
  }
});

test("RunLogger: logScopeCheck writes scope_check entry", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const runDir = join(dir, "run");
    mkdirSync(runDir, { recursive: true });
    const logger = new RunLogger(runDir);

    logger.logScopeCheck(["rogue.ts"], ["missing.ts"], 0.5);

    const entries = logger.getEntries();
    assert.equal(entries[0].type, "scope_check");
    assert.deepEqual(entries[0].data.extraFiles, ["rogue.ts"]);
  } finally {
    await cleanup();
  }
});

test("RunLogger: logMetrics writes metrics entry", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const runDir = join(dir, "run");
    mkdirSync(runDir, { recursive: true });
    const logger = new RunLogger(runDir);

    logger.logMetrics({ score: 0.95, duration: 1000 });

    const entries = logger.getEntries();
    assert.equal(entries[0].type, "metrics");
    assert.equal(entries[0].data.score, 0.95);
  } finally {
    await cleanup();
  }
});

test("RunLogger: logError writes error entry", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const runDir = join(dir, "run");
    mkdirSync(runDir, { recursive: true });
    const logger = new RunLogger(runDir);

    logger.logError("something went wrong");

    const entries = logger.getEntries();
    assert.equal(entries[0].type, "error");
    assert.equal(entries[0].data.error, "something went wrong");
  } finally {
    await cleanup();
  }
});

// =============================================================================
// getEntries
// =============================================================================

test("RunLogger: getEntries returns copies of all entries", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const runDir = join(dir, "run");
    mkdirSync(runDir, { recursive: true });
    const logger = new RunLogger(runDir);

    logger.log("plan", { a: 1 });
    logger.log("error", { b: 2 });

    const entries = logger.getEntries();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].type, "plan");
    assert.equal(entries[1].type, "error");
  } finally {
    await cleanup();
  }
});

test("RunLogger: getEntries returns empty for new logger", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const runDir = join(dir, "run");
    mkdirSync(runDir, { recursive: true });
    const logger = new RunLogger(runDir);
    assert.deepEqual(logger.getEntries(), []);
  } finally {
    await cleanup();
  }
});
