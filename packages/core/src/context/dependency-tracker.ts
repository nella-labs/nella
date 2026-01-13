/**
 * Dependency Tracker
 *
 * Monitors package.json and lockfiles to detect dependency changes.
 * Helps agents stay aware of dependency drift between runs.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  DependencySnapshot,
  DependencyChange,
  DependencyDiff,
  PackageInfo,
  Assumption,
} from "../types";

/**
 * Compute SHA-256 hash of a file
 */
function hashFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Detect lockfile type and path
 */
function detectLockfile(
  repoPath: string
): { type: "npm" | "pnpm" | "yarn" | "none"; path: string | null } {
  const lockfiles = [
    { type: "pnpm" as const, name: "pnpm-lock.yaml" },
    { type: "yarn" as const, name: "yarn.lock" },
    { type: "npm" as const, name: "package-lock.json" },
  ];

  for (const { type, name } of lockfiles) {
    const lockPath = path.join(repoPath, name);
    if (fs.existsSync(lockPath)) {
      return { type, path: lockPath };
    }
  }

  return { type: "none", path: null };
}

/**
 * Parse package.json dependencies
 */
function parsePackageJson(
  pkgPath: string
): Record<string, PackageInfo> {
  const packages: Record<string, PackageInfo> = {};

  try {
    const content = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(content);

    // Parse dependencies
    if (pkg.dependencies) {
      for (const [name, version] of Object.entries(pkg.dependencies)) {
        packages[name] = {
          version: String(version),
          isDev: false,
        };
      }
    }

    // Parse devDependencies
    if (pkg.devDependencies) {
      for (const [name, version] of Object.entries(pkg.devDependencies)) {
        packages[name] = {
          version: String(version),
          isDev: true,
        };
      }
    }
  } catch (e) {
    // Invalid package.json
  }

  return packages;
}

/**
 * Try to detect Node.js version from .nvmrc, .node-version, or package.json engines
 */
function detectNodeVersion(repoPath: string): string | undefined {
  // Check .nvmrc
  const nvmrcPath = path.join(repoPath, ".nvmrc");
  if (fs.existsSync(nvmrcPath)) {
    const version = fs.readFileSync(nvmrcPath, "utf-8").trim();
    if (version) return version;
  }

  // Check .node-version
  const nodeVersionPath = path.join(repoPath, ".node-version");
  if (fs.existsSync(nodeVersionPath)) {
    const version = fs.readFileSync(nodeVersionPath, "utf-8").trim();
    if (version) return version;
  }

  // Check package.json engines
  const pkgPath = path.join(repoPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.engines?.node) {
        return pkg.engines.node;
      }
    } catch (e) {
      // Ignore
    }
  }

  return undefined;
}

/**
 * Dependency Tracker - monitors package dependencies
 */
export class DependencyTracker {
  /**
   * Take a snapshot of current dependency state
   */
  takeSnapshot(repoPath: string): DependencySnapshot {
    const pkgPath = path.join(repoPath, "package.json");
    const lockfile = detectLockfile(repoPath);

    return {
      takenAt: new Date().toISOString(),
      packageJsonHash: hashFile(pkgPath),
      lockfileHash: lockfile.path ? hashFile(lockfile.path) : "",
      lockfileType: lockfile.type,
      packages: parsePackageJson(pkgPath),
      nodeVersion: detectNodeVersion(repoPath),
    };
  }

  /**
   * Compare two snapshots and detect changes
   */
  compareSnapshots(
    previous: DependencySnapshot,
    current: DependencySnapshot
  ): DependencyChange[] {
    const changes: DependencyChange[] = [];
    const previousPkgs = previous.packages;
    const currentPkgs = current.packages;

    // Detect added and updated packages
    for (const [name, info] of Object.entries(currentPkgs)) {
      const prevInfo = previousPkgs[name];

      if (!prevInfo) {
        // Package was added
        changes.push({
          type: "added",
          package: name,
          version: info.version,
          isDev: info.isDev,
        });
      } else if (prevInfo.version !== info.version) {
        // Package was updated
        changes.push({
          type: "updated",
          package: name,
          version: info.version,
          previousVersion: prevInfo.version,
          isDev: info.isDev,
        });
      }
    }

    // Detect removed packages
    for (const [name, info] of Object.entries(previousPkgs)) {
      if (!currentPkgs[name]) {
        changes.push({
          type: "removed",
          package: name,
          previousVersion: info.version,
          isDev: info.isDev,
        });
      }
    }

    return changes;
  }

  /**
   * Get full diff between snapshots including affected assumptions
   */
  getDiff(
    previous: DependencySnapshot,
    current: DependencySnapshot,
    assumptions: Assumption[] = []
  ): DependencyDiff {
    const changes = this.compareSnapshots(previous, current);
    const packageJsonChanged = previous.packageJsonHash !== current.packageJsonHash;
    const lockfileChanged = previous.lockfileHash !== current.lockfileHash;

    // Find assumptions that might be affected by dependency changes
    const changedPackageNames = changes.map((c) => c.package);
    const affectedAssumptions = assumptions.filter((a) => {
      // Check if assumption is about dependencies
      if (a.type !== "dependency") return false;

      // Check if any changed package is mentioned in the assumption
      const lowerDesc = a.description.toLowerCase();
      return changedPackageNames.some((pkg) =>
        lowerDesc.includes(pkg.toLowerCase())
      );
    });

    return {
      hasChanges: changes.length > 0 || packageJsonChanged || lockfileChanged,
      changes,
      packageJsonChanged,
      lockfileChanged,
      affectedAssumptions,
    };
  }

  /**
   * Check if dependencies have changed since a snapshot
   */
  hasChanged(repoPath: string, previous: DependencySnapshot): boolean {
    const pkgPath = path.join(repoPath, "package.json");
    const lockfile = detectLockfile(repoPath);

    // Quick check using hashes
    if (hashFile(pkgPath) !== previous.packageJsonHash) {
      return true;
    }

    if (lockfile.path && hashFile(lockfile.path) !== previous.lockfileHash) {
      return true;
    }

    return false;
  }

  /**
   * Get a list of all dependencies
   */
  listDependencies(repoPath: string): Array<{
    name: string;
    version: string;
    isDev: boolean;
  }> {
    const pkgPath = path.join(repoPath, "package.json");
    const packages = parsePackageJson(pkgPath);

    return Object.entries(packages).map(([name, info]) => ({
      name,
      version: info.version,
      isDev: info.isDev,
    }));
  }

  /**
   * Check if a specific package is installed
   */
  hasPackage(repoPath: string, packageName: string): boolean {
    const pkgPath = path.join(repoPath, "package.json");
    const packages = parsePackageJson(pkgPath);
    return packageName in packages;
  }

  /**
   * Get version of a specific package
   */
  getPackageVersion(repoPath: string, packageName: string): string | null {
    const pkgPath = path.join(repoPath, "package.json");
    const packages = parsePackageJson(pkgPath);
    return packages[packageName]?.version ?? null;
  }

  /**
   * Generate a summary of dependency changes for logging
   */
  summarizeChanges(changes: DependencyChange[]): string {
    if (changes.length === 0) {
      return "No dependency changes detected.";
    }

    const added = changes.filter((c) => c.type === "added");
    const removed = changes.filter((c) => c.type === "removed");
    const updated = changes.filter((c) => c.type === "updated");

    const parts: string[] = [];

    if (added.length > 0) {
      parts.push(`Added: ${added.map((c) => `${c.package}@${c.version}`).join(", ")}`);
    }

    if (removed.length > 0) {
      parts.push(`Removed: ${removed.map((c) => c.package).join(", ")}`);
    }

    if (updated.length > 0) {
      parts.push(
        `Updated: ${updated.map((c) => `${c.package} (${c.previousVersion} → ${c.version})`).join(", ")}`
      );
    }

    return parts.join("; ");
  }
}
