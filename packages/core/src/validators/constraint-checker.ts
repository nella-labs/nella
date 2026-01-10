/**
 * Constraint Checker
 *
 * Validates that changes satisfy declared constraints.
 * Checks forbidden files and forbidden patterns.
 */

import { minimatch } from "minimatch";
import { Constraint, ConstraintResult } from "../types";

/**
 * Check if a file path matches a glob pattern
 */
function matchesGlob(filePath: string, pattern: string): boolean {
  // Normalize paths to forward slashes
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  return minimatch(normalizedPath, normalizedPattern, {
    nocase: true,
    dot: true,
  });
}

/**
 * Check if any modified files violate the "files not to modify" constraint
 */
export function checkFilesNotToModify(
  modifiedFiles: string[],
  constraint: Constraint
): ConstraintResult {
  const patterns = constraint.filesNotToModify ?? [];

  for (const pattern of patterns) {
    for (const file of modifiedFiles) {
      if (matchesGlob(file, pattern)) {
        return {
          id: constraint.id,
          passed: false,
          violationDetails: `Modified forbidden file: ${file} (matches pattern: ${pattern})`,
        };
      }
    }
  }

  return {
    id: constraint.id,
    passed: true,
  };
}

/**
 * Check if diff contains forbidden patterns (regex)
 */
export function checkForbiddenPatterns(
  diff: string,
  constraint: Constraint
): ConstraintResult {
  const patterns = constraint.forbiddenPatterns ?? [];

  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, "gi");
      if (regex.test(diff)) {
        return {
          id: constraint.id,
          passed: false,
          violationDetails: `Diff contains forbidden pattern: ${pattern}`,
        };
      }
    } catch (e) {
      // Invalid regex - treat as literal string match
      if (diff.toLowerCase().includes(pattern.toLowerCase())) {
        return {
          id: constraint.id,
          passed: false,
          violationDetails: `Diff contains forbidden pattern: ${pattern}`,
        };
      }
    }
  }

  return {
    id: constraint.id,
    passed: true,
  };
}

/**
 * Check a single constraint against changes
 */
export function checkConstraint(
  modifiedFiles: string[],
  diff: string,
  constraint: Constraint
): ConstraintResult {
  // Check files not to modify
  if (constraint.filesNotToModify && constraint.filesNotToModify.length > 0) {
    const fileResult = checkFilesNotToModify(modifiedFiles, constraint);
    if (!fileResult.passed) {
      return fileResult;
    }
  }

  // Check forbidden patterns
  if (constraint.forbiddenPatterns && constraint.forbiddenPatterns.length > 0) {
    const patternResult = checkForbiddenPatterns(diff, constraint);
    if (!patternResult.passed) {
      return patternResult;
    }
  }

  return {
    id: constraint.id,
    passed: true,
  };
}

/**
 * Check all constraints against changes
 *
 * @param modifiedFiles - List of file paths that were modified
 * @param diff - Git diff of all changes
 * @param constraints - Constraints to check
 * @returns Array of constraint check results
 */
export function checkConstraints(
  modifiedFiles: string[],
  diff: string,
  constraints: Constraint[]
): ConstraintResult[] {
  return constraints.map((constraint) =>
    checkConstraint(modifiedFiles, diff, constraint)
  );
}

/**
 * Get list of violated constraint IDs
 */
export function getViolatedConstraints(results: ConstraintResult[]): string[] {
  return results.filter((r) => !r.passed).map((r) => r.id);
}

/**
 * Count constraint violations
 */
export function countViolations(results: ConstraintResult[]): number {
  return results.filter((r) => !r.passed).length;
}
