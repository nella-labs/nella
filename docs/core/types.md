# Types Reference

Complete type definitions for `@nella-labs/core`.

## Table of Contents

- [Task Types](#task-types)
- [Result Types](#result-types)
- [Agent Types](#agent-types)

---

## Task Types

```typescript
import type {
  Task,
  TaskCategory,
  TaskDifficulty,
  Constraint,
  ValidationConfig,
  ExpectedChanges,
  RawTaskYaml
} from '@nella-labs/core';
```

### `Task`

Main task definition interface.

```typescript
interface Task {
  id: string;                      // Unique identifier
  name: string;                    // Human-readable name
  prompt: string;                  // Prompt given to agent
  category: TaskCategory;          // 'feature' | 'bug-fix' | 'refactor' | 'edge-case' | 'refusal'
  difficulty: TaskDifficulty;      // 'easy' | 'medium' | 'hard'
  fixture: string;                 // Target repo/fixture name
  constraints: Constraint[];       // Rules agent must follow
  validation: ValidationConfig;    // Test/lint/compile commands
  expected: ExpectedChanges;       // Expected file modifications
  refusalExpected?: boolean;       // Should agent refuse?
  refusalPatterns?: string[];      // Patterns indicating correct refusal
  timeoutSeconds?: number;         // Time limit
}
```

### `TaskCategory`

```typescript
type TaskCategory =
  | 'feature'     // New functionality
  | 'bug-fix'     // Fix existing bug
  | 'refactor'    // Code improvement
  | 'edge-case'   // Handle edge cases
  | 'refusal';    // Task agent should refuse
```

### `TaskDifficulty`

```typescript
type TaskDifficulty = 'easy' | 'medium' | 'hard';
```

### `Constraint`

Constraint rule definition.

```typescript
interface Constraint {
  id: string;                      // Constraint identifier
  description: string;             // Human-readable description
  rule: string;                    // Rule statement
  filesNotToModify?: string[];     // Glob patterns for forbidden files
  forbiddenPatterns?: string[];    // Regex patterns forbidden in diffs
}
```

**Example:**
```typescript
const constraint: Constraint = {
  id: 'no-auth-changes',
  description: 'Do not modify authentication logic',
  rule: 'Files in src/auth/ must not be touched',
  filesNotToModify: ['src/auth/**', 'src/middlewares/auth*.ts'],
  forbiddenPatterns: ['password\\s*=', 'token\\s*=']
};
```

### `ValidationConfig`

```typescript
interface ValidationConfig {
  test?: string;      // e.g., 'npm run test'
  lint?: string;      // e.g., 'npm run lint'
  compile?: string;   // e.g., 'npm run check:types'
}
```

### `ExpectedChanges`

```typescript
interface ExpectedChanges {
  filesToModify: string[];         // Files that should be modified
  filesToIgnore: string[];         // Files to ignore in scope analysis
  expectedLineCount?: number;      // Approximate lines expected to change
}
```

### `RawTaskYaml`

Raw YAML structure before transformation (snake_case).

```typescript
interface RawTaskYaml {
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
```

---

## Result Types

```typescript
import type {
  RunResult,
  CommandResult,
  ValidationResult,
  ConstraintResult,
  RefusalResult,
  ScopeResult,
  Metrics,
  Artifacts,
  Plan,
  PlanStep,
  LogEntry,
  LogEntryType
} from '@nella-labs/core';
```

### `RunResult`

Complete result of a task run — the main output of Core.

```typescript
interface RunResult {
  runId: string;                   // Unique run identifier
  timestamp: string;               // ISO timestamp
  taskId: string;                  // Task that was executed
  plan: Plan | null;               // Agent's declared plan
  constraints: ConstraintResult[]; // Constraint check results
  refusal: RefusalResult | null;   // Refusal result
  validation: ValidationResult | null;  // Test/lint/compile results
  scope: ScopeResult | null;       // Scope analysis
  metrics: Metrics;                // Computed metrics
  passed: boolean;                 // Overall pass/fail
  artifacts: Artifacts | null;     // Generated artifact paths
  errors: string[];                // Any errors that occurred
}
```

### `CommandResult`

Result of running a single command.

```typescript
interface CommandResult {
  command: string;      // The command executed
  success: boolean;     // Exit code === 0
  output: string;       // Combined stdout + stderr
  exitCode: number;     // Process exit code
  durationMs: number;   // Execution time in ms
}
```

### `ValidationResult`

Results from running validation commands.

```typescript
interface ValidationResult {
  test: CommandResult | null;      // Test command result
  lint: CommandResult | null;      // Lint command result
  compile: CommandResult | null;   // Compile/typecheck result
  allPassed: boolean;              // All configured validations passed
}
```

### `ConstraintResult`

Result of checking a single constraint.

```typescript
interface ConstraintResult {
  id: string;                      // Constraint ID
  passed: boolean;                 // Whether constraint passed
  violationDetails?: string;       // Details if failed
}
```

### `RefusalResult`

Result of refusal detection.

```typescript
interface RefusalResult {
  shouldRefuse: boolean;           // Whether to block execution
  reason: string;                  // Reason for refusal
  patternsMatched: string[];       // Risk patterns matched
  confidence: number;              // Confidence level (0-1)
}
```

### `ScopeResult`

Result of scope creep detection.

```typescript
interface ScopeResult {
  expectedFiles: string[];         // Files expected to be modified
  actualFiles: string[];           // Files actually modified
  extraFiles: string[];            // Modified but not expected
  missingFiles: string[];          // Expected but not modified
  scopeCreepRatio: number;         // extraFiles.length / expectedFiles.length
}
```

### `Plan`

Agent's declared execution plan.

```typescript
interface Plan {
  summary: string;                 // Summary of intent
  steps: PlanStep[];               // Steps to execute
  filesToModify: string[];         // Files that will be modified
  packagesAdded: string[];         // Packages to be added
  riskLevel: 'low' | 'medium' | 'high';
}
```

### `PlanStep`

A single step in the execution plan.

```typescript
interface PlanStep {
  file: string;                    // File to be modified
  action: 'create' | 'modify' | 'delete';
  reason: string;                  // Reason for this change
}
```

### `Metrics`

Computed quality metrics.

```typescript
interface Metrics {
  scopeCreep: number;              // Extra files / expected files
  constraintViolations: number;    // Count of violated constraints
  validationIntegrity: number;     // Ratio of validations passed (0-1)
  refusalCorrectness: boolean | null;  // null if not a refusal task
}
```

### `Artifacts`

Paths to generated artifacts.

```typescript
interface Artifacts {
  diffPath: string;    // Path to diff.patch
  logsPath: string;    // Path to logs.jsonl
  metricsPath: string; // Path to metrics.json
  runDir: string;      // Run directory path
}
```

### `LogEntry`

A single log entry in the run record.

```typescript
interface LogEntry {
  ts: string;                      // ISO timestamp
  type: LogEntryType;              // Entry type
  data: Record<string, unknown>;   // Entry data
}
```

### `LogEntryType`

```typescript
type LogEntryType =
  | 'plan'
  | 'refusal'
  | 'constraint_check'
  | 'validation'
  | 'scope_check'
  | 'metrics'
  | 'error';
```

---

## Agent Types

```typescript
import type {
  FileChange,
  AgentResponse,
  Changes
} from '@nella-labs/core';
```

### `FileChange`

A file change proposed by an agent.

```typescript
interface FileChange {
  path: string;                           // Relative path from repo root
  operation: 'create' | 'modify' | 'delete';
  content: string;                        // New content (empty for delete)
}
```

**Example:**
```typescript
const changes: FileChange[] = [
  { path: 'src/users.ts', operation: 'modify', content: '/* new content */' },
  { path: 'src/new-file.ts', operation: 'create', content: 'export const x = 1;' },
  { path: 'src/old-file.ts', operation: 'delete', content: '' }
];
```

### `AgentResponse`

Structured response from an agent.

```typescript
interface AgentResponse {
  action: 'edit' | 'refuse';       // Whether agent edited or refused
  files: FileChange[];             // Files to change (empty for refuse)
  explanation: string;             // Agent's explanation/reasoning
  reason?: string;                 // Reason for refusal (if action is refuse)
}
```

### `Changes`

Input for validation.

```typescript
interface Changes {
  files: FileChange[];             // Files that were modified
  diff?: string;                   // Git diff (optional, computed if missing)
}
```
