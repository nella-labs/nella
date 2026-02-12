import test from "node:test";
import assert from "node:assert/strict";
import { sha256, isBinaryBuffer, splitBuffer, encodePathForObject, rebuildFromChunks } from "../delta";

// =============================================================================
// sha256
// =============================================================================

test("sha256: produces consistent hex hash", () => {
  const hash = sha256("hello");
  assert.equal(hash, sha256("hello"));
  assert.equal(hash.length, 64); // 256-bit hex
});

test("sha256: different inputs produce different hashes", () => {
  assert.notEqual(sha256("a"), sha256("b"));
});

test("sha256: works with Buffer input", () => {
  const hash = sha256(Buffer.from("hello"));
  assert.equal(hash, sha256("hello"));
});

// =============================================================================
// isBinaryBuffer
// =============================================================================

test("isBinaryBuffer: text content is not binary", () => {
  assert.equal(isBinaryBuffer(Buffer.from("hello world")), false);
});

test("isBinaryBuffer: buffer with null byte is binary", () => {
  const buf = Buffer.from([0x48, 0x65, 0x00, 0x6c]); // "He\0l"
  assert.equal(isBinaryBuffer(buf), true);
});

test("isBinaryBuffer: empty buffer is not binary", () => {
  assert.equal(isBinaryBuffer(Buffer.alloc(0)), false);
});

test("isBinaryBuffer: pure null bytes is binary", () => {
  assert.equal(isBinaryBuffer(Buffer.alloc(100, 0)), true);
});

test("isBinaryBuffer: UTF-8 text is not binary", () => {
  assert.equal(isBinaryBuffer(Buffer.from("こんにちは")), false);
});

// =============================================================================
// splitBuffer
// =============================================================================

test("splitBuffer: splits into correct chunk sizes", () => {
  const buf = Buffer.from("abcdefghij"); // 10 bytes
  const chunks = splitBuffer(buf, 3);

  assert.equal(chunks.length, 4); // 3+3+3+1
  assert.equal(chunks[0].toString(), "abc");
  assert.equal(chunks[1].toString(), "def");
  assert.equal(chunks[2].toString(), "ghi");
  assert.equal(chunks[3].toString(), "j");
});

test("splitBuffer: single chunk when smaller than chunkSize", () => {
  const buf = Buffer.from("hello");
  const chunks = splitBuffer(buf, 100);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].toString(), "hello");
});

test("splitBuffer: empty buffer returns single empty chunk", () => {
  const chunks = splitBuffer(Buffer.alloc(0), 100);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 0);
});

test("splitBuffer: exact multiple of chunkSize", () => {
  const buf = Buffer.from("abcdef"); // 6 bytes
  const chunks = splitBuffer(buf, 3);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].toString(), "abc");
  assert.equal(chunks[1].toString(), "def");
});

// =============================================================================
// encodePathForObject
// =============================================================================

test("encodePathForObject: encodes special characters", () => {
  const encoded = encodePathForObject("src/path with spaces/file.ts");
  assert.ok(encoded.includes("%20") || encoded.includes("+"));
  assert.ok(!encoded.includes(" "));
});

test("encodePathForObject: encodes slashes", () => {
  const encoded = encodePathForObject("src/deep/path.ts");
  assert.ok(encoded.includes("%2F"));
});

test("encodePathForObject: plain filename stays similar", () => {
  const encoded = encodePathForObject("file.ts");
  assert.equal(encoded, "file.ts");
});

// =============================================================================
// rebuildFromChunks
// =============================================================================

test("rebuildFromChunks: reconstructs original buffer", () => {
  const original = Buffer.from("hello world this is test data");
  const chunks = splitBuffer(original, 10);
  const rebuilt = rebuildFromChunks(chunks);
  assert.deepEqual(rebuilt, original);
});

test("rebuildFromChunks: empty chunks returns empty buffer", () => {
  const rebuilt = rebuildFromChunks([]);
  assert.equal(rebuilt.length, 0);
});
