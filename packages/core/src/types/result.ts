/**
 * Result Types
 *
 * Types for run results, validation outcomes, and metrics.
 */

// =============================================================================
// Command Results
// =============================================================================

/**
 * Result of running a single command
 */
export interface CommandResult {
  /** The command that was executed */
  command: string;

  /** Whether the command succeeded (exit code 0) */
  success: boolean;

  /** Captured stdout + stderr */
  output: string;

  /** Process exit code */
  exitCode: number;

  /** Execution time in milliseconds */
  durationMs: number;
}

// =============================================================================
// Validation Results
// =============================================================================

/**
 * Results from running validation commands
 */
export interface ValidationResult {
  /** Test command result (null if no test command) */
  test: CommandResult | null;

  /** Lint command result (null if no lint command) */
  lint: CommandResult | null;

  /** Compile/typecheck command result (null if no compile command) */
  compile: CommandResult | null;

  /** Whether all configured validations passed */
  allPassed: boolean;
}

// =============================================================================
// Constraint Results
// =============================================================================

/**
 * Result of checking a single constraint
 */
export interface ConstraintResult {
  /** Constraint ID */
  id: string;

  /** Whether the constraint passed (not violated) */
  passed: boolean;

  /** Details about the violation if failed */
  violationDetails?: string;
}

// =============================================================================
// Refusal Results
// =============================================================================

/**
 * Result of refusal detection
 */
export interface RefusalResult {
  /** Whether the task should be refused */
  shouldRefuse: boolean;

  /** Reason for refusal */
  reason: string;

  /** Risk patterns that were matched */
  patternsMatched: string[];

  /** Confidence level (0-1) */
  confidence: number;
}

// =============================================================================
// Scope Results
// =============================================================================

/**
 * Result of scope creep detection
 */
export interface ScopeResult {
  /** Files that were expected to be modified */
  expectedFiles: string[];

  /** Files that were actually modified */
  actualFiles: string[];

  /** Files modified but not expected */
  extraFiles: string[];

  /** Files expected but not modified */
  missingFiles: string[];

  /** Scope creep ratio (0 = no creep, higher = more creep) */
  scopeCreepRatio: number;
}

// =============================================================================
// Plan Types
// =============================================================================

/**
 * A single step in the execution plan
 */
export interface PlanStep {
  /** File to be modified */
  file: string;

  /** Type of action */
  action: "create" | "modify" | "delete";

  /** Reason for this change */
  reason: string;
}

/**
 * Agent's declared plan
 */
export interface Plan {
  /** Summary of intent */
  summary: string;

  /** Steps to execute */
  steps: PlanStep[];

  /** Files that will be modified */
  filesToModify: string[];

  /** Packages to be added */
  packagesAdded: string[];

  /** Risk level assessment */
  riskLevel: "low" | "medium" | "high";
}

// =============================================================================
// Metrics
// =============================================================================

/**
 * Computed metrics for a run
 */
export interface Metrics {
  /** Scope creep ratio (extra files / expected files) */
  scopeCreep: number;

  /** Number of constraints violated */
  constraintViolations: number;

  /** Validation integrity (0-1, ratio of validations passed) */
  validationIntegrity: number;

  /** Refusal correctness (null if not a refusal task) */
  refusalCorrectness: boolean | null;
}

// =============================================================================
// Artifacts
// =============================================================================

/**
 * Paths to generated artifacts
 */
export interface Artifacts {
  /** Path to diff file */
  diffPath: string;

  /** Path to logs file */
  logsPath: string;

  /** Path to metrics file */
  metricsPath: string;

  /** Run directory */
  runDir: string;
}

// =============================================================================
// Run Result (Main Output)
// =============================================================================

/**
 * Complete result of a task run - the main output of Core
 */
export interface RunResult {
  /** Run identifier */
  runId: string;

  /** Timestamp when run started */
  timestamp: string;

  /** Task that was executed */
  taskId: string;

  /** Agent's declared plan (if provided) */
  plan: Plan | null;

  /** Constraint check results */
  constraints: ConstraintResult[];

  /** Refusal result (null if proceeded without refusal check) */
  refusal: RefusalResult | null;

  /** Validation results */
  validation: ValidationResult | null;

  /** Scope analysis */
  scope: ScopeResult | null;

  /** Computed metrics */
  metrics: Metrics;

  /** Whether the run passed overall */
  passed: boolean;

  /** Artifact locations */
  artifacts: Artifacts | null;

  /** Any errors that occurred */
  errors: string[];
}

// =============================================================================
// Log Entry Types
// =============================================================================

export type LogEntryType =
  | "plan"
  | "refusal"
  | "constraint_check"
  | "validation"
  | "scope_check"
  | "metrics"
  | "error"
  | "dependency_change"
  | "assumption_conflict"
  | "assumptions_invalidated";

/**
 * A single log entry in the run record
 */
export interface LogEntry {
  /** Timestamp */
  ts: string;

  /** Entry type */
  type: LogEntryType;

  /** Entry data */
  data: Record<string, unknown>;
}
