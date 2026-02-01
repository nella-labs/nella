/**
 * Workspace Validator
 *
 * Validates workspace entries to ensure paths exist
 * and workspace data is consistent.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkspaceEntry } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface ValidationResult {
  workspaceId: string;
  workspaceName: string;
  valid: boolean;
  issues: ValidationIssue[];
  warnings: ValidationWarning[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
  field?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  suggestion?: string;
}

export interface BatchValidationResult {
  totalWorkspaces: number;
  validWorkspaces: number;
  invalidWorkspaces: number;
  staleWorkspaces: number;
  results: ValidationResult[];
  summary: string;
}

// =============================================================================
// Issue Codes
// =============================================================================

export const ValidationCodes = {
  // Errors
  PATH_NOT_FOUND: "PATH_NOT_FOUND",
  PATH_NOT_DIRECTORY: "PATH_NOT_DIRECTORY",
  PATH_NOT_ACCESSIBLE: "PATH_NOT_ACCESSIBLE",
  MISSING_ID: "MISSING_ID",
  MISSING_NAME: "MISSING_NAME",
  MISSING_PATH: "MISSING_PATH",
  INVALID_CONFIG: "INVALID_CONFIG",
  MISSING_INDEX: "MISSING_INDEX",

  // Warnings
  STALE_INDEX: "STALE_INDEX",
  LARGE_WORKSPACE: "LARGE_WORKSPACE",
  NO_GIT_REPO: "NO_GIT_REPO",
  INDEX_OUTDATED: "INDEX_OUTDATED",
  LONG_UNUSED: "LONG_UNUSED",
} as const;

// =============================================================================
// Workspace Validator Class
// =============================================================================

export class WorkspaceValidator {
  private staleThresholdDays: number;
  private unusedThresholdDays: number;

  constructor(options: {
    staleThresholdDays?: number;
    unusedThresholdDays?: number;
  } = {}) {
    this.staleThresholdDays = options.staleThresholdDays ?? 7;
    this.unusedThresholdDays = options.unusedThresholdDays ?? 30;
  }

  /**
   * Validate a single workspace entry
   */
  async validate(workspace: WorkspaceEntry): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const warnings: ValidationWarning[] = [];

    // Required fields
    if (!workspace.id) {
      issues.push({
        code: ValidationCodes.MISSING_ID,
        message: "Workspace ID is missing",
        severity: "error",
        field: "id",
      });
    }

    if (!workspace.name) {
      issues.push({
        code: ValidationCodes.MISSING_NAME,
        message: "Workspace name is missing",
        severity: "error",
        field: "name",
      });
    }

    if (!workspace.path) {
      issues.push({
        code: ValidationCodes.MISSING_PATH,
        message: "Workspace path is missing",
        severity: "error",
        field: "path",
      });
    } else {
      // Path existence check
      const pathIssues = await this.validatePath(workspace.path);
      issues.push(...pathIssues);

      // Git repo check (warning only)
      if (pathIssues.length === 0) {
        const gitWarnings = await this.checkGitRepo(workspace.path);
        warnings.push(...gitWarnings);
      }
    }

    // Index status check
    if (workspace.indexStatus === "error") {
      issues.push({
        code: ValidationCodes.MISSING_INDEX,
        message: "Workspace index is in error state",
        severity: "error",
        field: "indexStatus",
      });
    }

    // Stale index check - use lastAccessed as proxy for index age
    if (workspace.indexStatus === "stale") {
      warnings.push({
        code: ValidationCodes.STALE_INDEX,
        message: `Index is marked as stale`,
        suggestion: "Consider re-indexing this workspace",
      });
    } else if (workspace.indexStatus === "ready" && workspace.lastAccessed) {
      // Check if workspace hasn't been accessed recently
      const lastAccessedAge = Date.now() - new Date(workspace.lastAccessed).getTime();
      const lastAccessedDays = lastAccessedAge / (1000 * 60 * 60 * 24);

      if (lastAccessedDays > this.staleThresholdDays) {
        warnings.push({
          code: ValidationCodes.INDEX_OUTDATED,
          message: `Index may be outdated (last accessed ${Math.floor(lastAccessedDays)} days ago)`,
          suggestion: "Consider re-indexing this workspace",
        });
      }
    }

    // Long unused check
    if (workspace.lastAccessed) {
      const unusedTime = Date.now() - new Date(workspace.lastAccessed).getTime();
      const unusedDays = unusedTime / (1000 * 60 * 60 * 24);

      if (unusedDays > this.unusedThresholdDays) {
        warnings.push({
          code: ValidationCodes.LONG_UNUSED,
          message: `Workspace hasn't been accessed in ${Math.floor(unusedDays)} days`,
          suggestion: "Consider archiving or removing this workspace",
        });
      }
    }

    // Large workspace check - use filesIndexed
    if (workspace.stats?.filesIndexed && workspace.stats.filesIndexed > 50000) {
      warnings.push({
        code: ValidationCodes.LARGE_WORKSPACE,
        message: `Workspace contains ${workspace.stats.filesIndexed.toLocaleString()} indexed files`,
        suggestion: "Consider using exclude patterns for better performance",
      });
    }

    return {
      workspaceId: workspace.id || "unknown",
      workspaceName: workspace.name || "Unknown",
      valid: issues.filter((i) => i.severity === "error").length === 0,
      issues,
      warnings,
    };
  }

  /**
   * Validate path existence and accessibility
   */
  private async validatePath(workspacePath: string): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      await fs.promises.access(workspacePath, fs.constants.R_OK);
      
      const stat = await fs.promises.stat(workspacePath);
      if (!stat.isDirectory()) {
        issues.push({
          code: ValidationCodes.PATH_NOT_DIRECTORY,
          message: `Path exists but is not a directory: ${workspacePath}`,
          severity: "error",
          field: "path",
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        issues.push({
          code: ValidationCodes.PATH_NOT_FOUND,
          message: `Workspace path does not exist: ${workspacePath}`,
          severity: "error",
          field: "path",
        });
      } else if ((error as NodeJS.ErrnoException).code === "EACCES") {
        issues.push({
          code: ValidationCodes.PATH_NOT_ACCESSIBLE,
          message: `Workspace path is not accessible: ${workspacePath}`,
          severity: "error",
          field: "path",
        });
      } else {
        issues.push({
          code: ValidationCodes.PATH_NOT_ACCESSIBLE,
          message: `Error accessing workspace path: ${(error as Error).message}`,
          severity: "error",
          field: "path",
        });
      }
    }

    return issues;
  }

  /**
   * Check if workspace is a git repository
   */
  private async checkGitRepo(workspacePath: string): Promise<ValidationWarning[]> {
    const warnings: ValidationWarning[] = [];
    const gitPath = path.join(workspacePath, ".git");

    try {
      await fs.promises.access(gitPath);
    } catch {
      warnings.push({
        code: ValidationCodes.NO_GIT_REPO,
        message: "Workspace is not a git repository",
        suggestion: "Version control is recommended for code workspaces",
      });
    }

    return warnings;
  }

  /**
   * Validate multiple workspaces
   */
  async validateBatch(workspaces: WorkspaceEntry[]): Promise<BatchValidationResult> {
    const results: ValidationResult[] = [];
    let validCount = 0;
    let invalidCount = 0;
    let staleCount = 0;

    for (const workspace of workspaces) {
      const result = await this.validate(workspace);
      results.push(result);

      if (result.valid) {
        validCount++;
      } else {
        invalidCount++;
      }

      // Check for stale (path not found)
      if (result.issues.some((i) => i.code === ValidationCodes.PATH_NOT_FOUND)) {
        staleCount++;
      }
    }

    const summary = this.generateSummary(validCount, invalidCount, staleCount, results);

    return {
      totalWorkspaces: workspaces.length,
      validWorkspaces: validCount,
      invalidWorkspaces: invalidCount,
      staleWorkspaces: staleCount,
      results,
      summary,
    };
  }

  /**
   * Get stale workspace IDs (paths that no longer exist)
   */
  async getStaleWorkspaceIds(workspaces: WorkspaceEntry[]): Promise<string[]> {
    const staleIds: string[] = [];

    for (const workspace of workspaces) {
      if (!workspace.path || !workspace.id) continue;

      try {
        await fs.promises.access(workspace.path);
      } catch {
        staleIds.push(workspace.id);
      }
    }

    return staleIds;
  }

  /**
   * Generate validation summary
   */
  private generateSummary(
    valid: number,
    invalid: number,
    stale: number,
    results: ValidationResult[]
  ): string {
    const lines: string[] = [];
    lines.push(`Workspace Validation Summary`);
    lines.push(`============================`);
    lines.push(`Total: ${valid + invalid}`);
    lines.push(`Valid: ${valid}`);
    lines.push(`Invalid: ${invalid}`);
    lines.push(`Stale (path missing): ${stale}`);

    if (invalid > 0) {
      lines.push(``);
      lines.push(`Issues Found:`);
      for (const result of results) {
        if (!result.valid) {
          lines.push(`  - ${result.workspaceName}: ${result.issues.map((i) => i.message).join(", ")}`);
        }
      }
    }

    const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);
    if (totalWarnings > 0) {
      lines.push(``);
      lines.push(`Warnings: ${totalWarnings}`);
    }

    return lines.join("\n");
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createValidator(options?: {
  staleThresholdDays?: number;
  unusedThresholdDays?: number;
}): WorkspaceValidator {
  return new WorkspaceValidator(options);
}
