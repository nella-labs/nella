import test from "node:test";
import assert from "node:assert/strict";
import { FileLock, withFileLock, createFileLock } from "../file-lock";
import { tempDir } from "../../__tests__/helpers";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";

// =============================================================================
// Basic Acquire / Release
// =============================================================================

test("FileLock: acquire and release creates/removes lock file", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const filePath = join(dir, "registry.json");
    writeFileSync(filePath, "{}");
    const lock = new FileLock(filePath);

    const acquired = await lock.acquire({ timeout: 2000 });
    assert.equal(acquired, true);
    assert.equal(lock.isLocked(), true);
    assert.ok(existsSync(`${filePath}.lock`));

    await lock.release();
    assert.equal(lock.isLocked(), false);
    assert.equal(existsSync(`${filePath}.lock`), false);
  } finally {
    await cleanup();
  }
});

test("FileLock: release when not locked is a no-op", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const lock = new FileLock(join(dir, "test.json"));
    await lock.release(); // Should not throw
    assert.equal(lock.isLocked(), false);
  } finally {
    await cleanup();
  }
});

test("FileLock: second acquire fails when lock is held", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const filePath = join(dir, "data.json");
    writeFileSync(filePath, "{}");

    const lock1 = new FileLock(filePath);
    const lock2 = new FileLock(filePath);

    const acquired1 = await lock1.acquire({ timeout: 2000 });
    assert.equal(acquired1, true);

    // lock2 should time out quickly
    const acquired2 = await lock2.acquire({ timeout: 300, retryInterval: 50 });
    assert.equal(acquired2, false);

    await lock1.release();
  } finally {
    await cleanup();
  }
});

test("FileLock: second acquire succeeds after first release", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const filePath = join(dir, "data.json");
    writeFileSync(filePath, "{}");

    const lock1 = new FileLock(filePath);
    const lock2 = new FileLock(filePath);

    await lock1.acquire({ timeout: 2000 });
    await lock1.release();

    const acquired = await lock2.acquire({ timeout: 2000 });
    assert.equal(acquired, true);
    await lock2.release();
  } finally {
    await cleanup();
  }
});

// =============================================================================
// Stale Lock Detection
// =============================================================================

test("FileLock: detects and reclaims stale lock", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const filePath = join(dir, "data.json");
    writeFileSync(filePath, "{}");

    // Write a fake stale lock (old timestamp, non-existent PID)
    const staleLockInfo = {
      pid: 999999999, // Very unlikely to exist
      hostname: require("os").hostname(),
      timestamp: Date.now() - 60000, // 60s ago
    };
    writeFileSync(`${filePath}.lock`, JSON.stringify(staleLockInfo));

    const lock = new FileLock(filePath);
    const acquired = await lock.acquire({
      timeout: 2000,
      staleTimeout: 5000, // 5s stale threshold
    });
    assert.equal(acquired, true);
    await lock.release();
  } finally {
    await cleanup();
  }
});

// =============================================================================
// Force Release
// =============================================================================

test("FileLock: forceRelease removes lock unconditionally", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const filePath = join(dir, "data.json");
    writeFileSync(filePath, "{}");

    // Write any lock file
    writeFileSync(`${filePath}.lock`, JSON.stringify({ pid: 1, hostname: "x", timestamp: Date.now() }));

    const lock = new FileLock(filePath);
    await lock.forceRelease();
    assert.equal(existsSync(`${filePath}.lock`), false);
  } finally {
    await cleanup();
  }
});

// =============================================================================
// getLockInfo
// =============================================================================

test("FileLock: getLockInfo returns lock info when locked", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const filePath = join(dir, "data.json");
    writeFileSync(filePath, "{}");

    const lock = new FileLock(filePath);
    assert.equal(lock.getLockInfo(), null);

    await lock.acquire({ timeout: 2000 });
    const info = lock.getLockInfo();
    assert.ok(info);
    assert.equal(info!.pid, process.pid);
    assert.ok(info!.timestamp > 0);

    await lock.release();
  } finally {
    await cleanup();
  }
});

// =============================================================================
// withFileLock utility
// =============================================================================

test("withFileLock: executes fn while holding lock", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const filePath = join(dir, "data.json");
    writeFileSync(filePath, "{}");

    const result = await withFileLock(filePath, () => {
      assert.ok(existsSync(`${filePath}.lock`));
      return 42;
    });

    assert.equal(result, 42);
    assert.equal(existsSync(`${filePath}.lock`), false, "lock released after fn");
  } finally {
    await cleanup();
  }
});

test("withFileLock: releases lock even if fn throws", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const filePath = join(dir, "data.json");
    writeFileSync(filePath, "{}");

    await assert.rejects(
      () =>
        withFileLock(filePath, () => {
          throw new Error("oops");
        }),
      { message: "oops" }
    );
    assert.equal(existsSync(`${filePath}.lock`), false, "lock released after error");
  } finally {
    await cleanup();
  }
});

test("withFileLock: throws when lock cannot be acquired", async () => {
  const [dir, cleanup] = await tempDir();
  try {
    const filePath = join(dir, "data.json");
    writeFileSync(filePath, "{}");

    // Hold the lock
    const holder = new FileLock(filePath);
    await holder.acquire({ timeout: 2000 });

    await assert.rejects(
      () =>
        withFileLock(
          filePath,
          () => "should not run",
          { timeout: 200, retryInterval: 50 }
        ),
      /Failed to acquire lock/
    );

    await holder.release();
  } finally {
    await cleanup();
  }
});

// =============================================================================
// Factory
// =============================================================================

test("createFileLock: creates a FileLock instance", () => {
  const lock = createFileLock("/tmp/test.json");
  assert.ok(lock instanceof FileLock);
});
