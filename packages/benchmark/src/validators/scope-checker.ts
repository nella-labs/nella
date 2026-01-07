/**
 * Scope Checker
 *
 * Detects scope creep (files modified outside expected scope)
 */

import { ExpectedChanges } from "../types";

export interface ScopeCheckResult {
  expectedFiles: string[];
  actualFiles: string[];
  extraFiles: string[];
  missingFiles: string[];
  scopeCreepRatio: number;
}

/**
 * Check for scope creep in modified files
 */
export function checkScopeCreep(
  modifiedFiles: string[],
  expected: ExpectedChanges
): ScopeCheckResult {
  const expectedFiles = expected.filesToModify ?? [];
  const filesToIgnore = expected.filesToIgnore ?? [];

  // Normalize all paths
  const normalizedModified = modifiedFiles.map(normalizePath);
  const normalizedExpected = expectedFiles.map(normalizePath);
  const normalizedIgnore = filesToIgnore.map(normalizePath);

  // Find extra files (modified but not expected)
  const extraFiles = normalizedModified.filter((file) => {
    // Skip if in ignore list
    if (normalizedIgnore.some((pattern) => matchesPattern(file, pattern))) {
      return false;
    }
    // Check if it's in expected files
    return !normalizedExpected.some((pattern) => matchesPattern(file, pattern));
  });

  // Find missing files (expected but not modified)
  const missingFiles = normalizedExpected.filter((expected) => {
    return !normalizedModified.some((file) => matchesPattern(file, expected));
  });

  // Calculate scope creep ratio
  // 0 = no scope creep, higher values = more scope creep
  const scopeCreepRatio =
    expectedFiles.length > 0
      ? extraFiles.length / expectedFiles.length
      : extraFiles.length > 0
        ? 1
        : 0;

  return {
    expectedFiles: normalizedExpected,
    actualFiles: normalizedModified,
    extraFiles,
    missingFiles,
    scopeCreepRatio,
  };
}

/**
 * Normalize file path for comparison
 */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").toLowerCase();
}

/**
 * Match file path against a pattern (supports * and **)
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  const normalizedPath = normalizePath(filePath);
  const normalizedPattern = normalizePath(pattern);

  // Exact match
  if (normalizedPath === normalizedPattern) {
    return true;
  }

  // Glob pattern matching
  const regexPattern = normalizedPattern
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/\?/g, ".");

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(normalizedPath);
}
