/**
 * Task Definition Types
 *
 * Core types for defining tasks that agents execute.
 */

// =============================================================================
// Task Categories and Difficulty
// =============================================================================

export type TaskCategory =
  | "feature"
  | "bug-fix"
  | "refactor"
  | "edge-case"
  | "refusal";

export type TaskDifficulty = "easy" | "medium" | "hard";

// =============================================================================
// Task Definition
// =============================================================================

/**
 * A task definition - what an agent is asked to do
 */
export interface Task {
  /** Unique task identifier (e.g., "get-user-by-id") */
  id: string;

  /** Human-readable task name */
  name: string;

  /** The prompt given to the coding agent */
  prompt: string;

  /** Task category for grouping and analysis */
  category: TaskCategory;

  /** Difficulty level */
  difficulty: TaskDifficulty;

  /** Which fixture/repo this task targets */
  fixture: string;

  /** Constraints the agent must follow */
  constraints: Constraint[];

  /** Validation commands to verify task completion */
  validation: ValidationConfig;

  /** Expected changes for scope analysis */
  expected: ExpectedChanges;

  /** For refusal tasks: should the agent refuse this request? */
  refusalExpected?: boolean;

  /** Patterns that indicate a correct refusal */
  refusalPatterns?: string[];

  /** Time limit in seconds */
  timeoutSeconds?: number;
}

// =============================================================================
// Constraints
// =============================================================================

/**
 * A constraint that must be satisfied
 */
export interface Constraint {
  /** Constraint identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** The rule to enforce */
  rule: string;

  /** Glob patterns for files that must not be modified */
  filesNotToModify?: string[];

  /** Regex patterns that must not appear in changes */
  forbiddenPatterns?: string[];
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Commands to run for validation
 */
export interface ValidationConfig {
  /** Command to run tests (e.g., "npm run test") */
  test?: string;

  /** Command to run linter (e.g., "npm run lint") */
  lint?: string;

  /** Command to run type checking (e.g., "npm run check:types") */
  compile?: string;
}

// =============================================================================
// Expected Changes
// =============================================================================

/**
 * What changes are expected from the task
 */
export interface ExpectedChanges {
  /** Files that should be modified */
  filesToModify: string[];

  /** Files that can be ignored in scope analysis */
  filesToIgnore: string[];

  /** Approximate number of lines expected to change */
  expectedLineCount?: number;
}

// =============================================================================
// Raw YAML Types (snake_case from YAML files)
// =============================================================================

/**
 * Raw YAML task structure before transformation
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
