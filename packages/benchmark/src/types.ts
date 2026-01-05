/**
 * Nella Benchmark Types
 *
 * Types for evaluating coding agents on capability and safety.
 */

// =============================================================================
// Task Definition
// =============================================================================

export type TaskCategory = "feature" | "bug-fix" | "refactor" | "edge-case" | "refusal";
export type TaskDifficulty = "easy" | "medium" | "hard";

/**
 * A benchmark task definition loaded from YAML
 */
export interface Task {
  /** Unique task identifier (e.g., "get-user-by-id") */
  id: string;

  /** Human-readable task name */
  name: string;

  /** The prompt given to the coding agent (what a developer would ask) */
  prompt: string;

  /** Task category for grouping and analysis */
  category: TaskCategory;

  /** Difficulty level */
  difficulty: TaskDifficulty;

  /** Which fixture this task targets */
  fixture: string;

  /** Constraints the agent must follow (e.g., "do not modify auth.ts") */
  constraints: Constraint[];

  /** Validation commands to verify the task was completed correctly */
  validation: ValidationConfig;

  /** Expected changes for scope analysis */
  expected: ExpectedChanges;

  /** For refusal tasks: should the agent refuse this request? */
  refusalExpected?: boolean;

  /** Patterns that indicate a correct refusal */
  refusalPatterns?: string[];

  /** Time limit in seconds (optional) */
  timeoutSeconds?: number;
}

export interface Constraint {
  /** Constraint identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** The rule to enforce */
  rule: string;

  /** Files that must not be modified */
  filesNotToModify?: string[];

  /** Regex patterns that must not appear in changes */
  forbiddenPatterns?: string[];
}

export interface ValidationConfig {
  /** Command to run tests (e.g., "npm run test") */
  test?: string;

  /** Command to run linter (e.g., "npm run lint") */
  lint?: string;

  /** Command to run type checking (e.g., "npm run check:types") */
  compile?: string;
}

export interface ExpectedChanges {
  /** Files that should be modified */
  filesToModify: string[];

  /** Files that must not be touched */
  filesToIgnore: string[];

  /** Approximate number of lines expected to change */
  expectedLineCount?: number;
}

// =============================================================================
// Metrics
// =============================================================================

/**
 * Computed metrics for a single task run
 */
export interface Metrics {
  /** Build/Test Pass - did all validation commands pass? */
  btp: boolean;

  /** Validation Integrity - ratio of passed validations (0.0 - 1.0) */
  vi: number;

  /** Constraint Violation Rate - ratio of constraints violated (0.0 - 1.0, lower = better) */
  cvr: number;

  /** Scope Creep - ratio of extra files modified outside expected scope */
  sc: number;

  /** Refusal Correctness - did it correctly refuse risky tasks? (null if not a refusal task) */
  rc: boolean | null;

  /** Time to Green - seconds until first passing validation */
  ttg: number;

  /** Iteration Count - number of attempts before success */
  ic: number;

  /** Diff Accuracy - how close to golden diff (0.0 - 1.0) */
  da: number;
}

/**
 * Individual validation results
 */
export interface ValidationResults {
  testPassed: boolean | null;
  testOutput: string;

  lintPassed: boolean | null;
  lintOutput: string;

  compilePassed: boolean | null;
  compileOutput: string;
}

// =============================================================================
// Run Results
// =============================================================================

/**
 * Result of running a single task with a single agent
 */
export interface TaskRun {
  /** Task that was run */
  taskId: string;

  /** Agent that ran the task */
  agent: string;

  /** Timestamp when run started */
  timestamp: string;

  /** Computed metrics */
  metrics: Metrics;

  /** Individual validation results */
  validation: ValidationResults;

  /** Whether the task was completed successfully overall */
  passed: boolean;

  /** Files that were modified */
  filesModified: string[];

  /** Constraint violations detected */
  constraintViolations: string[];

  /** Whether the agent refused the task */
  refused: boolean;

  /** Agent's explanation/reasoning */
  explanation: string;
}

/**
 * Artifacts generated for a run
 */
export interface RunArtifacts {
  /** Git diff of all changes */
  diffPatch: string;

  /** Agent conversation/reasoning logs */
  logs: LogEntry[];

  /** Commands executed during the run */
  commands: string[];

  /** Path where artifacts are stored */
  outputPath: string;
}

export interface LogEntry {
  timestamp: string;
  type: "prompt" | "response" | "command" | "validation" | "decision";
  content: string;
}

// =============================================================================
// Aggregated Results
// =============================================================================

/**
 * Aggregated results across multiple agents and tasks
 */
export interface BenchmarkResults {
  /** When the benchmark was run */
  runDate: string;

  /** All task runs */
  runs: TaskRun[];

  /** Summary statistics per agent */
  agentSummaries: Map<string, AgentSummary>;

  /** Summary statistics per task */
  taskSummaries: Map<string, TaskSummary>;
}

export interface AgentSummary {
  agent: string;
  tasksAttempted: number;
  tasksPassed: number;
  passRate: number;

  /** Average metrics across all tasks */
  avgMetrics: {
    vi: number;
    cvr: number;
    sc: number;
    ttg: number;
    ic: number;
    da: number;
  };

  /** Refusal correctness rate (only for refusal tasks) */
  refusalRate: number;
}

export interface TaskSummary {
  taskId: string;
  agentsAttempted: number;
  agentsPassed: number;
  passRate: number;

  /** Average time to complete across agents */
  avgTtg: number;

  /** Which agents passed/failed */
  agentResults: Map<string, boolean>;
}

// =============================================================================
// Scenario Loader Types
// =============================================================================

/**
 * Raw YAML task structure before validation
 */
export interface RawTaskYaml {
  id: string;
  name: string;
  prompt: string;
  category: string;
  difficulty: string;
  fixture: string;
  constraints?: Array<{
    id: string;
    description: string;
    rule: string;
    files_not_to_modify?: string[];
    forbidden_patterns?: string[];
  }>;
  validation?: {
    test?: string;
    lint?: string;
    compile?: string;
  };
  expected?: {
    files_to_modify?: string[];
    files_to_ignore?: string[];
    expected_line_count?: number;
  };
  refusal_expected?: boolean;
  refusal_patterns?: string[];
  timeout_seconds?: number;
}

/**
 * Result of loading scenarios from disk
 */
export interface ScenarioLoadResult {
  tasks: Task[];
  errors: Array<{ file: string; error: string }>;
}
