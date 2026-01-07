/**
 * Constraint Checker
 *
 * Checks for constraint violations in agent changes
 */

import { Constraint } from "../types";

export interface ConstraintCheckResult {
  constraintId: string;
  violated: boolean;
  reason?: string;
}

/**
 * Check if any files were modified that should not be
 */
export function checkFilesNotToModify(
  modifiedFiles: string[],
  constraint: Constraint
): ConstraintCheckResult {
  const filesNotToModify = constraint.filesNotToModify ?? [];

  for (const pattern of filesNotToModify) {
    for (const file of modifiedFiles) {
      if (matchesPattern(file, pattern)) {
        return {
          constraintId: constraint.id,
          violated: true,
          reason: `Modified forbidden file: ${file} (matches pattern: ${pattern})`,
        };
      }
    }
  }

  return {
    constraintId: constraint.id,
    violated: false,
  };
}

/**
 * Check if diff contains forbidden patterns
 */
export function checkForbiddenPatterns(
  diff: string,
  constraint: Constraint
): ConstraintCheckResult {
  const forbiddenPatterns = constraint.forbiddenPatterns ?? [];

  for (const pattern of forbiddenPatterns) {
    const regex = new RegExp(pattern, "gi");
    if (regex.test(diff)) {
      return {
        constraintId: constraint.id,
        violated: true,
        reason: `Diff contains forbidden pattern: ${pattern}`,
      };
    }
  }

  return {
    constraintId: constraint.id,
    violated: false,
  };
}

/**
 * Check all constraints for violations
 */
export function checkAllConstraints(
  modifiedFiles: string[],
  diff: string,
  constraints: Constraint[]
): ConstraintCheckResult[] {
  const results: ConstraintCheckResult[] = [];

  for (const constraint of constraints) {
    // Check files not to modify
    if (constraint.filesNotToModify && constraint.filesNotToModify.length > 0) {
      const fileResult = checkFilesNotToModify(modifiedFiles, constraint);
      if (fileResult.violated) {
        results.push(fileResult);
        continue;
      }
    }

    // Check forbidden patterns
    if (constraint.forbiddenPatterns && constraint.forbiddenPatterns.length > 0) {
      const patternResult = checkForbiddenPatterns(diff, constraint);
      if (patternResult.violated) {
        results.push(patternResult);
        continue;
      }
    }

    // No violations for this constraint
    results.push({
      constraintId: constraint.id,
      violated: false,
    });
  }

  return results;
}

/**
 * Get list of violated constraint IDs
 */
export function getViolatedConstraints(results: ConstraintCheckResult[]): string[] {
  return results.filter((r) => r.violated).map((r) => r.constraintId);
}

/**
 * Match file path against a glob-like pattern
 * Supports * and ** wildcards
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // Normalize paths
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  // Convert glob pattern to regex
  const regexPattern = normalizedPattern
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/\?/g, ".");

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(normalizedPath);
}
