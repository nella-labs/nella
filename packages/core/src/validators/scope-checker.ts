/**
 * Scope Checker
 *
 * Detects scope creep - files modified outside expected scope.
 */

import { minimatch } from "minimatch";
import { ExpectedChanges, ScopeResult } from "../types";

/**
 * Normalize file path for comparison
 */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * Check if a file matches any pattern in a list
 */
function matchesAnyPattern(file: string, patterns: string[]): boolean {
  const normalizedFile = normalizePath(file);
  return patterns.some((pattern) =>
    minimatch(normalizedFile, normalizePath(pattern), { nocase: true, dot: true })
  );
}

/**
 * Check for scope creep in modified files
 *
 * @param modifiedFiles - Files that were actually modified
 * @param expected - Expected changes from task definition
 * @returns Scope analysis result
 */
export function checkScope(
  modifiedFiles: string[],
  expected: ExpectedChanges
): ScopeResult {
  const expectedFiles = expected.filesToModify ?? [];
  const filesToIgnore = expected.filesToIgnore ?? [];

  // Normalize all paths
  const normalizedModified = modifiedFiles.map(normalizePath);
  const normalizedExpected = expectedFiles.map(normalizePath);

  // Find extra files (modified but not expected and not in ignore list)
  const extraFiles = normalizedModified.filter((file) => {
    // Skip if in ignore list
    if (matchesAnyPattern(file, filesToIgnore)) {
      return false;
    }
    // Check if it matches any expected pattern
    return !matchesAnyPattern(file, normalizedExpected);
  });

  // Find missing files (expected but not modified)
  const missingFiles = normalizedExpected.filter((expected) => {
    return !normalizedModified.some((file) =>
      minimatch(file, expected, { nocase: true, dot: true })
    );
  });

  // Calculate scope creep ratio
  // 0 = no scope creep, higher = more creep
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
