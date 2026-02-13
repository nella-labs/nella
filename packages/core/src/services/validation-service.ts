/**
 * Validation Service
 *
 * Wraps core validation, constraint checking, and full task runs.
 * Encapsulates Task/Changes object construction that MCP tools currently inline.
 */

import {
  runTask,
  check,
  validate,
  type RunTaskOptions,
} from "../run";

import {
  checkConstraints,
  countViolations,
} from "../validators/constraint-checker";

import {
  runValidation,
} from "../validators/command-runner";

import type {
  Task,
  Changes,
  Constraint,
  RunResult,
  ConstraintResult,
  ValidationResult,
  FileChange,
  RefusalResult,
} from "../types";

// =============================================================================
// Types
// =============================================================================

export interface ValidateConstraintsParams {
  modifiedFiles: string[];
  diff: string;
  constraints: Constraint[];
}

export interface RunFullTaskParams {
  workspacePath: string;
  taskId: string;
  taskName: string;
  prompt: string;
  constraints?: Constraint[];
  validation?: {
    test?: string;
    lint?: string;
    compile?: string;
  };
  expectedFiles?: string[];
  changes: {
    diff?: string;
    files?: Array<{ path: string; content: string }>;
  };
  options?: RunTaskOptions;
}

// =============================================================================
// Service
// =============================================================================

export class ValidationService {
  /**
   * Check if proposed changes comply with constraints.
   * Direct wrapper — no Task construction needed.
   */
  async checkConstraints(params: ValidateConstraintsParams): Promise<{
    violations: ConstraintResult[];
    violationCount: number;
    passed: boolean;
  }> {
    const violations = checkConstraints(
      params.modifiedFiles,
      params.diff,
      params.constraints
    );
    const violationCount = countViolations(violations);

    return {
      violations,
      violationCount,
      passed: violationCount === 0,
    };
  }

  /**
   * Run validation commands (test, lint, compile).
   */
  async runValidation(
    commands: { test?: string; lint?: string; compile?: string },
    workspacePath: string
  ): Promise<ValidationResult> {
    return runValidation(commands, workspacePath);
  }

  /**
   * Execute a complete Nella task validation.
   * Encapsulates Task/Changes construction from raw params.
   */
  async runFullTask(params: RunFullTaskParams): Promise<RunResult> {
    const task: Task = {
      id: params.taskId,
      name: params.taskName,
      prompt: params.prompt,
      category: "feature",
      difficulty: "medium",
      fixture: params.workspacePath,
      constraints: params.constraints || [],
      validation: params.validation || {},
      expected: {
        filesToModify: params.expectedFiles || [],
        filesToIgnore: [],
      },
    };

    const fileChanges: FileChange[] = (params.changes.files || []).map((f) => ({
      path: f.path,
      content: f.content,
      operation: "modify" as const,
    }));

    const changes: Changes = {
      diff: params.changes.diff || "",
      files: fileChanges,
    };

    return runTask(params.workspacePath, task, changes, params.options);
  }

  /**
   * Quick pre-flight check (lighter than runFullTask).
   */
  async preflightCheck(
    workspacePath: string,
    taskPrompt: string,
    constraints?: Constraint[]
  ): Promise<{ safe: boolean; issues: string[] }> {
    try {
      const task: Task = {
        id: "preflight",
        name: "Pre-flight check",
        prompt: taskPrompt,
        category: "feature",
        difficulty: "medium",
        fixture: workspacePath,
        constraints: constraints || [],
        validation: {},
        expected: {
          filesToModify: [],
          filesToIgnore: [],
        },
      };

      const result: RefusalResult = check(task, workspacePath);

      const issues: string[] = [];
      if (result.shouldRefuse) {
        issues.push(`Refusal recommended: ${result.reason}`);
      }

      return { safe: issues.length === 0, issues };
    } catch (err) {
      return { safe: false, issues: [(err as Error).message] };
    }
  }
}
