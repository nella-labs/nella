/**
 * Shared test helpers for @usenella/core
 *
 * Provides temp directories, workspace scaffolding, and common mocks
 * used across all test files.
 */

import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// =============================================================================
// Temp Directory Helpers
// =============================================================================

/**
 * Create a temporary directory with automatic cleanup.
 * Returns [dirPath, cleanup].
 */
export async function tempDir(
  prefix = "nella-test-"
): Promise<[string, () => Promise<void>]> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true });
  };
  return [dir, cleanup];
}

/**
 * Create a temp directory with a .nella/ workspace structure inside it.
 * Returns [workspacePath, cleanup].
 */
export async function tempWorkspace(): Promise<
  [string, () => Promise<void>]
> {
  const [dir, cleanup] = await tempDir("nella-ws-test-");
  await mkdir(join(dir, ".nella"), { recursive: true });
  return [dir, cleanup];
}

/**
 * Write a file inside a workspace, creating parent dirs as needed.
 */
export async function writeWorkspaceFile(
  workspacePath: string,
  relativePath: string,
  content: string
): Promise<void> {
  const abs = join(workspacePath, relativePath);
  const { dir } = await import("path").then((p) => ({
    dir: p.dirname(abs),
  }));
  await mkdir(dir, { recursive: true });
  await writeFile(abs, content, "utf-8");
}

// =============================================================================
// Timing Helpers
// =============================================================================

/**
 * Wait for a given number of milliseconds.
 */
export function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Assertion Helpers
// =============================================================================

/**
 * Assert that an async function throws with a message matching `pattern`.
 */
export async function assertThrows(
  fn: () => Promise<unknown>,
  pattern?: RegExp | string
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (err: unknown) {
    threw = true;
    if (pattern) {
      const msg = err instanceof Error ? err.message : String(err);
      const matches =
        typeof pattern === "string" ? msg.includes(pattern) : pattern.test(msg);
      if (!matches) {
        throw new Error(
          `Expected error matching ${pattern}, got: "${msg}"`
        );
      }
    }
  }
  if (!threw) {
    throw new Error("Expected function to throw, but it did not");
  }
}
