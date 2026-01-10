/**
 * Run Task
 *
 * Main entrypoint for Nella Core. Orchestrates:
 * - Prerequisite checking
 * - Refusal detection
 * - Change application
 * - Constraint validation
 * - Command validation
 * - Scope checking
 * - Metrics calculation
 * - Artifact generation
 */

import {
  Task,
  Changes,
  RunResult,
  Plan,
  Metrics,
  ConstraintResult,
  RefusalResult,
  ValidationResult,
  ScopeResult,
  Artifacts,
} from "./types";

import {
  checkConstraints,
  countViolations,
} from "./validators/constraint-checker";

import { checkScope } from "./validators/scope-checker";

import {
  runValidation,
  calculateValidationIntegrity,
} from "./validators/command-runner";

import {
  shouldRefuse,
  checkRefusalCorrectness,
} from "./safety/refusal-detector";

import {
  generateRunId,
  RunLogger,
} from "./utils/logger";

import {
  createTempWorkspace,
  applyChanges,
  getDiff,
  getModifiedFiles,
  createNellaDir,
  writeArtifacts,
  cleanupTempWorkspace,
} from "./utils/workspace";

// =============================================================================
// Options
// =============================================================================

export interface RunTaskOptions {
  /** Skip refusal check */
  skipRefusalCheck?: boolean;

  /** Skip prerequisite checks */
  skipPrerequisites?: boolean;

  /** Skip validation commands */
  skipValidation?: boolean;

  /** Custom timeout for validation commands (ms) */
  validationTimeout?: number;

  /** Don't create artifacts */
  skipArtifacts?: boolean;

  /** Pre-declared plan from agent */
  plan?: Plan;
}

// =============================================================================
// Individual Check Functions (for granular MCP tools)
// =============================================================================

/**
 * Check if a task should be refused (pre-flight check)
 */
export function check(
  task: Task,
  workspacePath: string,
  options: { skipPrerequisites?: boolean } = {}
): RefusalResult {
  return shouldRefuse(task, workspacePath, {
    skipPrerequisites: options.skipPrerequisites,
    taskRefusalPatterns: task.refusalPatterns,
  });
}

/**
 * Validate changes against constraints and run validation commands
 */
export async function validate(
  task: Task,
  workspacePath: string,
  changes: Changes,
  options: RunTaskOptions = {}
): Promise<{
  constraints: ConstraintResult[];
  validation: ValidationResult | null;
  scope: ScopeResult;
  passed: boolean;
}> {
  // Create temp workspace
  const tempDir = createTempWorkspace(workspacePath);

  try {
    // Apply changes
    applyChanges(tempDir, changes.files);

    // Get diff
    const diff = changes.diff ?? getDiff(tempDir);
    const modifiedFiles =
      changes.files.map((f) => f.path) || getModifiedFiles(tempDir);

    // Check constraints
    const constraints = checkConstraints(modifiedFiles, diff, task.constraints);

    // Check scope
    const scope = checkScope(modifiedFiles, task.expected);

    // Run validation (unless skipped)
    let validation: ValidationResult | null = null;
    if (!options.skipValidation && task.validation) {
      validation = runValidation(
        task.validation,
        tempDir,
        options.validationTimeout
      );
    }

    // Determine if passed
    const constraintsPassed = constraints.every((c) => c.passed);
    const validationPassed = validation === null || validation.allPassed;
    const passed = constraintsPassed && validationPassed;

    return {
      constraints,
      validation,
      scope,
      passed,
    };
  } finally {
    cleanupTempWorkspace(tempDir);
  }
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Run a complete task validation
 *
 * This is the main entrypoint for Nella Core. It:
 * 1. Checks if the task should be refused
 * 2. Applies changes to a temporary workspace
 * 3. Validates constraints
 * 4. Runs validation commands (test/lint/compile)
 * 5. Checks for scope creep
 * 6. Computes metrics
 * 7. Writes artifacts
 *
 * @param repoPath - Path to the repository
 * @param task - Task definition
 * @param changes - Changes to validate (optional)
 * @param options - Run options
 * @returns Complete run result
 */
export async function runTask(
  repoPath: string,
  task: Task,
  changes?: Changes,
  options: RunTaskOptions = {}
): Promise<RunResult> {
  const runId = generateRunId();
  const timestamp = new Date().toISOString();
  const errors: string[] = [];

  // Create run directory for artifacts
  let runDir: string | null = null;
  let logger: RunLogger | null = null;

  if (!options.skipArtifacts) {
    runDir = createNellaDir(repoPath, runId);
    logger = new RunLogger(runDir);
  }

  // Initialize result
  let refusal: RefusalResult | null = null;
  let constraints: ConstraintResult[] = [];
  let validation: ValidationResult | null = null;
  let scope: ScopeResult | null = null;
  let artifacts: Artifacts | null = null;
  let passed = false;

  try {
    // Step 1: Refusal check
    if (!options.skipRefusalCheck) {
      refusal = check(task, repoPath, {
        skipPrerequisites: options.skipPrerequisites,
      });

      if (refusal.shouldRefuse) {
        logger?.logRefusal(refusal.reason, refusal.patternsMatched);

        // Early return for refusal
        const metrics = calculateMetrics([], null, null, task, true);
        logger?.logMetrics(metrics);

        if (runDir) {
          artifacts = writeArtifacts(runDir, "", metrics);
        }

        return {
          runId,
          timestamp,
          taskId: task.id,
          plan: options.plan ?? null,
          constraints: [],
          refusal,
          validation: null,
          scope: null,
          metrics,
          passed: false,
          artifacts,
          errors,
        };
      }
    }

    // Step 2: If no changes provided, we're just doing a check
    if (!changes) {
      const metrics = calculateMetrics([], null, null, task, false);

      return {
        runId,
        timestamp,
        taskId: task.id,
        plan: options.plan ?? null,
        constraints: [],
        refusal,
        validation: null,
        scope: null,
        metrics,
        passed: true,
        artifacts: null,
        errors,
      };
    }

    // Step 3: Validate changes
    logger?.logPlan(
      changes.files.map((f) => f.path),
      options.plan?.summary ?? "Changes provided"
    );

    const tempDir = createTempWorkspace(repoPath);

    try {
      // Apply changes to temp workspace
      const modifiedFiles = applyChanges(tempDir, changes.files);

      // Get diff
      const diff = changes.diff ?? getDiff(tempDir);

      // Check constraints
      constraints = checkConstraints(modifiedFiles, diff, task.constraints);
      for (const c of constraints) {
        logger?.logConstraintCheck(c.id, c.passed, c.violationDetails);
      }

      // Check scope
      scope = checkScope(modifiedFiles, task.expected);
      logger?.logScopeCheck(
        scope.extraFiles,
        scope.missingFiles,
        scope.scopeCreepRatio
      );

      // Run validation commands
      if (!options.skipValidation && task.validation) {
        validation = runValidation(
          task.validation,
          tempDir,
          options.validationTimeout
        );

        if (validation.test) {
          logger?.logValidation("test", validation.test.success, validation.test.exitCode);
        }
        if (validation.lint) {
          logger?.logValidation("lint", validation.lint.success, validation.lint.exitCode);
        }
        if (validation.compile) {
          logger?.logValidation("compile", validation.compile.success, validation.compile.exitCode);
        }
      }

      // Determine overall pass
      const constraintsPassed = constraints.every((c) => c.passed);
      const validationPassed = validation === null || validation.allPassed;
      passed = constraintsPassed && validationPassed;

      // Calculate metrics
      const metrics = calculateMetrics(constraints, validation, scope, task, false);
      logger?.logMetrics(metrics);

      // Write artifacts
      if (runDir) {
        artifacts = writeArtifacts(runDir, diff, metrics);
      }

      return {
        runId,
        timestamp,
        taskId: task.id,
        plan: options.plan ?? null,
        constraints,
        refusal,
        validation,
        scope,
        metrics,
        passed,
        artifacts,
        errors,
      };
    } finally {
      cleanupTempWorkspace(tempDir);
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    errors.push(error);
    logger?.logError(error);

    const metrics = calculateMetrics(constraints, validation, scope, task, false);

    return {
      runId,
      timestamp,
      taskId: task.id,
      plan: options.plan ?? null,
      constraints,
      refusal,
      validation,
      scope,
      metrics,
      passed: false,
      artifacts,
      errors,
    };
  }
}

// =============================================================================
// Metrics Calculation
// =============================================================================

function calculateMetrics(
  constraints: ConstraintResult[],
  validation: ValidationResult | null,
  scope: ScopeResult | null,
  task: Task,
  refused: boolean
): Metrics {
  const scopeCreep = scope?.scopeCreepRatio ?? 0;
  const constraintViolations = countViolations(constraints);
  const validationIntegrity = validation
    ? calculateValidationIntegrity(validation)
    : 1;
  const refusalCorrectness = task.refusalExpected !== undefined
    ? checkRefusalCorrectness(task, refused)
    : null;

  return {
    scopeCreep,
    constraintViolations,
    validationIntegrity,
    refusalCorrectness,
  };
}
