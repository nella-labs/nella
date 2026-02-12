import test from "node:test";
import assert from "node:assert/strict";
import { buildConflict, type BuildConflictInput } from "../conflicts";

// =============================================================================
// buildConflict — Conflict Record
// =============================================================================

test("buildConflict: returns conflict with unique id", () => {
  const input: BuildConflictInput = {
    path: "src/app.ts",
    localHash: "aaa",
    remoteHash: "bbb",
    textDiffMaxBytes: 10_000,
  };

  const conflict = buildConflict(input);
  assert.ok(conflict.id);
  assert.equal(conflict.path, "src/app.ts");
  assert.equal(conflict.localHash, "aaa");
  assert.equal(conflict.remoteHash, "bbb");
  assert.ok(conflict.createdAt);
});

test("buildConflict: each call produces a unique id", () => {
  const input: BuildConflictInput = { path: "a.ts", textDiffMaxBytes: 10_000 };
  const c1 = buildConflict(input);
  const c2 = buildConflict(input);
  assert.notEqual(c1.id, c2.id);
});

// =============================================================================
// Preview (toPreview)
// =============================================================================

test("buildConflict: includes local/remote preview when buffers provided", () => {
  const input: BuildConflictInput = {
    path: "a.ts",
    localBuffer: Buffer.from("hello local"),
    remoteBuffer: Buffer.from("hello remote"),
    textDiffMaxBytes: 10_000,
  };

  const c = buildConflict(input);
  assert.equal(c.localPreview, "hello local");
  assert.equal(c.remotePreview, "hello remote");
});

test("buildConflict: truncates preview beyond 1200 chars", () => {
  const long = "x".repeat(2000);
  const input: BuildConflictInput = {
    path: "a.ts",
    localBuffer: Buffer.from(long),
    textDiffMaxBytes: 10_000,
  };

  const c = buildConflict(input);
  assert.ok(c.localPreview!.length < 1300);
  assert.ok(c.localPreview!.endsWith("..."));
});

test("buildConflict: no preview when buffer is empty", () => {
  const input: BuildConflictInput = {
    path: "a.ts",
    localBuffer: Buffer.alloc(0),
    textDiffMaxBytes: 10_000,
  };

  const c = buildConflict(input);
  assert.equal(c.localPreview, undefined);
});

test("buildConflict: no preview when buffer omitted", () => {
  const input: BuildConflictInput = {
    path: "a.ts",
    textDiffMaxBytes: 10_000,
  };

  const c = buildConflict(input);
  assert.equal(c.localPreview, undefined);
  assert.equal(c.remotePreview, undefined);
});

// =============================================================================
// Unified Diff
// =============================================================================

test("buildConflict: includes unified diff for text files", () => {
  const input: BuildConflictInput = {
    path: "src/file.ts",
    localBuffer: Buffer.from("line1\nline2\n"),
    remoteBuffer: Buffer.from("line1\nchanged\n"),
    textDiffMaxBytes: 10_000,
  };

  const c = buildConflict(input);
  assert.ok(c.unifiedDiff);
  assert.ok(c.unifiedDiff!.includes("--- a/src/file.ts"));
  assert.ok(c.unifiedDiff!.includes("+++ b/src/file.ts"));
  assert.ok(c.unifiedDiff!.includes("-line2"));
  assert.ok(c.unifiedDiff!.includes("+changed"));
});

test("buildConflict: identical content produces no diff markers", () => {
  const content = "same\ncontent\n";
  const input: BuildConflictInput = {
    path: "a.ts",
    localBuffer: Buffer.from(content),
    remoteBuffer: Buffer.from(content),
    textDiffMaxBytes: 10_000,
  };

  const c = buildConflict(input);
  assert.ok(c.unifiedDiff);
  // No +/- markers (only context lines)
  const lines = c.unifiedDiff!.split("\n");
  const diffLines = lines.filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("---") && !l.startsWith("+++"));
  assert.equal(diffLines.length, 0);
});

test("buildConflict: no diff when files too large", () => {
  const big = "x".repeat(20_000);
  const input: BuildConflictInput = {
    path: "a.ts",
    localBuffer: Buffer.from(big),
    remoteBuffer: Buffer.from(big + "extra"),
    textDiffMaxBytes: 10_000, // below 20k
  };

  const c = buildConflict(input);
  assert.equal(c.unifiedDiff, undefined);
});

test("buildConflict: no diff when one buffer missing", () => {
  const input: BuildConflictInput = {
    path: "a.ts",
    localBuffer: Buffer.from("hello"),
    textDiffMaxBytes: 10_000,
  };

  const c = buildConflict(input);
  assert.equal(c.unifiedDiff, undefined);
});
