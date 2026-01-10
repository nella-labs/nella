/**
 * Workspace Manager
 *
 * Handles workspace isolation - copying to temp, applying changes, generating diffs.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { FileChange, Artifacts } from "../types";

/**
 * Create a temporary copy of a workspace
 *
 * @param sourcePath - Original workspace path
 * @returns Path to the temporary copy
 */
export function createTempWorkspace(sourcePath: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nella-"));

  // Copy the workspace (excluding node_modules for speed)
  copyDirRecursive(sourcePath, tempDir, ["node_modules", ".git", ".nella"]);

  return tempDir;
}

/**
 * Recursively copy a directory
 */
function copyDirRecursive(src: string, dest: string, exclude: string[] = []): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (exclude.includes(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, exclude);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Apply file changes to a workspace
 *
 * @param workspacePath - Path to workspace
 * @param changes - File changes to apply
 * @returns List of modified file paths
 */
export function applyChanges(
  workspacePath: string,
  changes: FileChange[]
): string[] {
  const modifiedFiles: string[] = [];

  for (const change of changes) {
    const filePath = path.join(workspacePath, change.path);
    const dirPath = path.dirname(filePath);

    switch (change.operation) {
      case "create":
      case "modify":
        // Ensure directory exists
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        fs.writeFileSync(filePath, change.content);
        modifiedFiles.push(change.path);
        break;

      case "delete":
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          modifiedFiles.push(change.path);
        }
        break;
    }
  }

  return modifiedFiles;
}

/**
 * Initialize git in workspace and get diff of changes
 *
 * @param workspacePath - Path to workspace
 * @returns Git diff string
 */
export function getDiff(workspacePath: string): string {
  try {
    // Initialize git if not already
    const gitDir = path.join(workspacePath, ".git");
    if (!fs.existsSync(gitDir)) {
      execSync("git init", { cwd: workspacePath, stdio: "pipe" });
      execSync("git add -A", { cwd: workspacePath, stdio: "pipe" });
      execSync('git commit -m "initial"', { cwd: workspacePath, stdio: "pipe" });
    }

    // Get diff of uncommitted changes
    const diff = execSync("git diff HEAD", {
      cwd: workspacePath,
      encoding: "utf-8",
      stdio: "pipe",
    });

    return diff;
  } catch (e) {
    return "";
  }
}

/**
 * Get list of modified files from git
 */
export function getModifiedFiles(workspacePath: string): string[] {
  try {
    const output = execSync("git status --porcelain", {
      cwd: workspacePath,
      encoding: "utf-8",
      stdio: "pipe",
    });

    return output
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => line.substring(3).trim());
  } catch (e) {
    return [];
  }
}

/**
 * Create the .nella directory structure for artifacts
 */
export function createNellaDir(workspacePath: string, runId: string): string {
  const nellaDir = path.join(workspacePath, ".nella", "runs", runId);
  fs.mkdirSync(nellaDir, { recursive: true });
  return nellaDir;
}

/**
 * Write artifacts to the run directory
 */
export function writeArtifacts(
  runDir: string,
  diff: string,
  metrics: object
): Artifacts {
  const diffPath = path.join(runDir, "diff.patch");
  const metricsPath = path.join(runDir, "metrics.json");
  const logsPath = path.join(runDir, "logs.jsonl");

  fs.writeFileSync(diffPath, diff);
  fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));

  return {
    diffPath,
    logsPath,
    metricsPath,
    runDir,
  };
}

/**
 * Clean up a temporary workspace
 */
export function cleanupTempWorkspace(tempPath: string): void {
  try {
    fs.rmSync(tempPath, { recursive: true, force: true });
  } catch (e) {
    // Ignore cleanup errors
  }
}
