/**
 * Git Utilities
 *
 * Shell-based git operations for branch detection, diff computation,
 * and repository introspection. Uses child_process.execFile to avoid
 * shell injection — no library dependency needed.
 */

import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Types
// =============================================================================

export interface FileChange {
  status: "A" | "M" | "D" | "R";
  path: string;
  previousPath?: string; // For renames
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Execute a git command and return stdout.
 * Throws on non-zero exit code.
 */
function git(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", repoPath, ...args], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args[0]} failed: ${stderr.trim() || error.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Check if a path is inside a git repository.
 */
export async function isGitRepo(repoPath: string): Promise<boolean> {
  // Fast path: check for .git directory/file
  const gitPath = path.join(repoPath, ".git");
  if (fs.existsSync(gitPath)) return true;

  // Fallback: ask git (handles worktrees, submodules)
  try {
    await git(repoPath, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current branch name.
 * Returns "HEAD" if in detached HEAD state.
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
  try {
    return await git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    return "HEAD";
  }
}

/**
 * Detect the default branch name (main or master).
 * Checks remote HEAD first, then falls back to local branch existence.
 */
export async function getDefaultBranch(repoPath: string): Promise<string> {
  // Try remote HEAD reference
  try {
    const ref = await git(repoPath, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
    const branch = ref.replace("refs/remotes/origin/", "");
    if (branch) return branch;
  } catch {
    // No remote HEAD configured
  }

  // Check if 'main' exists locally
  try {
    await git(repoPath, ["rev-parse", "--verify", "refs/heads/main"]);
    return "main";
  } catch {
    // No 'main' branch
  }

  // Check if 'master' exists locally
  try {
    await git(repoPath, ["rev-parse", "--verify", "refs/heads/master"]);
    return "master";
  } catch {
    // No 'master' branch
  }

  // Last resort: current branch
  return getCurrentBranch(repoPath);
}

/**
 * Get the HEAD commit SHA.
 */
export async function getHeadCommit(repoPath: string): Promise<string> {
  return git(repoPath, ["rev-parse", "HEAD"]);
}

/**
 * Get the commit SHA for a specific ref (branch name, tag, etc.).
 */
export async function getCommitSha(repoPath: string, ref: string): Promise<string> {
  return git(repoPath, ["rev-parse", ref]);
}

/**
 * Get the fork point (merge base) between two branches.
 * This is the commit where `branch` diverged from `baseBranch`.
 */
export async function getForkPoint(repoPath: string, branch: string, baseBranch: string): Promise<string> {
  // Try fork-point first (more accurate for rebased branches)
  try {
    return await git(repoPath, ["merge-base", "--fork-point", baseBranch, branch]);
  } catch {
    // Fall back to simple merge-base
    return git(repoPath, ["merge-base", baseBranch, branch]);
  }
}

/**
 * Get files changed between a branch's current state and a fork point commit.
 * Returns an array of FileChange objects with status and path.
 */
export async function getChangedFilesSinceFork(
  repoPath: string,
  branch: string,
  forkCommit: string,
): Promise<FileChange[]> {
  const output = await git(repoPath, ["diff", "--name-status", forkCommit, branch]);
  if (!output) return [];

  return output.split("\n").map((line) => {
    const parts = line.split("\t");
    const statusChar = parts[0][0] as FileChange["status"];

    if (statusChar === "R") {
      return {
        status: statusChar,
        path: parts[2], // New path
        previousPath: parts[1], // Old path
      };
    }

    return {
      status: statusChar,
      path: parts[1],
    };
  });
}

/**
 * Get files changed between two commits (e.g., for a push event).
 */
export async function getChangedFilesBetween(
  repoPath: string,
  fromCommit: string,
  toCommit: string,
): Promise<FileChange[]> {
  const output = await git(repoPath, ["diff", "--name-status", fromCommit, toCommit]);
  if (!output) return [];

  return output.split("\n").map((line) => {
    const parts = line.split("\t");
    const statusChar = parts[0][0] as FileChange["status"];

    if (statusChar === "R") {
      return { status: statusChar, path: parts[2], previousPath: parts[1] };
    }

    return { status: statusChar, path: parts[1] };
  });
}

/**
 * Get the remote URL for the repository.
 * Returns null if no remote is configured.
 */
export async function getRemoteUrl(repoPath: string, remote = "origin"): Promise<string | null> {
  try {
    return await git(repoPath, ["remote", "get-url", remote]);
  } catch {
    return null;
  }
}

/**
 * List all local branches.
 */
export async function listBranches(repoPath: string): Promise<string[]> {
  const output = await git(repoPath, ["branch", "--format=%(refname:short)"]);
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}

/**
 * Check if a branch exists locally.
 */
export async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  try {
    await git(repoPath, ["rev-parse", "--verify", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a GitHub remote URL into owner/repo format.
 * Handles both HTTPS and SSH URLs.
 * Returns null if not a GitHub URL.
 */
export function parseGitHubUrl(remoteUrl: string): { owner: string; repo: string } | null {
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
}
