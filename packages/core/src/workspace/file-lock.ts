/**
 * File Lock Utility
 *
 * Cross-process file locking to prevent race conditions
 * when multiple nella instances modify the registry.
 */

import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Types
// =============================================================================

export interface LockOptions {
  /** Timeout in ms to acquire lock (default: 5000) */
  timeout?: number;
  /** Retry interval in ms (default: 100) */
  retryInterval?: number;
  /** Stale lock timeout in ms (default: 30000) */
  staleTimeout?: number;
}

export interface LockInfo {
  pid: number;
  hostname: string;
  timestamp: number;
}

// =============================================================================
// File Lock Class
// =============================================================================

export class FileLock {
  private lockPath: string;
  private locked = false;
  private lockInfo: LockInfo | null = null;

  constructor(filePath: string) {
    this.lockPath = `${filePath}.lock`;
  }

  /**
   * Acquire exclusive lock on file
   */
  async acquire(options: LockOptions = {}): Promise<boolean> {
    const timeout = options.timeout ?? 5000;
    const retryInterval = options.retryInterval ?? 100;
    const staleTimeout = options.staleTimeout ?? 30000;

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // Check for stale lock
      if (await this.isLockStale(staleTimeout)) {
        await this.forceRelease();
      }

      // Try to acquire
      if (await this.tryAcquire()) {
        return true;
      }

      // Wait before retry
      await this.sleep(retryInterval);
    }

    return false;
  }

  /**
   * Try to acquire lock without waiting
   */
  private async tryAcquire(): Promise<boolean> {
    try {
      // Use exclusive create (O_EXCL) to ensure atomicity
      const lockInfo: LockInfo = {
        pid: process.pid,
        hostname: require("os").hostname(),
        timestamp: Date.now(),
      };

      fs.writeFileSync(this.lockPath, JSON.stringify(lockInfo), {
        flag: "wx", // Fail if exists
      });

      this.locked = true;
      this.lockInfo = lockInfo;
      return true;
    } catch (error) {
      // EEXIST means lock file already exists
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Check if current lock is stale (process died)
   */
  private async isLockStale(staleTimeout: number): Promise<boolean> {
    try {
      if (!fs.existsSync(this.lockPath)) {
        return false;
      }

      const content = fs.readFileSync(this.lockPath, "utf-8");
      const lockInfo = JSON.parse(content) as LockInfo;

      // Check if lock is too old
      if (Date.now() - lockInfo.timestamp > staleTimeout) {
        return true;
      }

      // Check if process is still running (only works on same machine)
      if (lockInfo.hostname === require("os").hostname()) {
        try {
          // process.kill(pid, 0) doesn't kill but checks if process exists
          process.kill(lockInfo.pid, 0);
          return false; // Process is running
        } catch {
          return true; // Process is dead
        }
      }

      return false;
    } catch {
      return true; // Corrupted lock file
    }
  }

  /**
   * Release lock
   */
  async release(): Promise<void> {
    if (!this.locked) {
      return;
    }

    try {
      // Verify we own the lock
      if (fs.existsSync(this.lockPath)) {
        const content = fs.readFileSync(this.lockPath, "utf-8");
        const lockInfo = JSON.parse(content) as LockInfo;

        if (lockInfo.pid === process.pid) {
          fs.unlinkSync(this.lockPath);
        }
      }
    } catch {
      // Ignore errors during release
    }

    this.locked = false;
    this.lockInfo = null;
  }

  /**
   * Force release lock (use with caution)
   */
  async forceRelease(): Promise<void> {
    try {
      if (fs.existsSync(this.lockPath)) {
        fs.unlinkSync(this.lockPath);
      }
    } catch {
      // Ignore
    }
    this.locked = false;
    this.lockInfo = null;
  }

  /**
   * Check if file is locked
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Get current lock info
   */
  getLockInfo(): LockInfo | null {
    if (!fs.existsSync(this.lockPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(this.lockPath, "utf-8");
      return JSON.parse(content) as LockInfo;
    } catch {
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Execute a function with file lock
 */
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T> | T,
  options?: LockOptions
): Promise<T> {
  const lock = new FileLock(filePath);

  const acquired = await lock.acquire(options);
  if (!acquired) {
    throw new Error(`Failed to acquire lock for: ${filePath}`);
  }

  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/**
 * Create a lock file for a path
 */
export function createFileLock(filePath: string): FileLock {
  return new FileLock(filePath);
}
