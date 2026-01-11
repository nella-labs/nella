# API Reference

Complete API documentation for `@nella-labs/core`.

## Table of Contents

- [Main API](#main-api)
- [Validators](#validators)
- [Safety](#safety)
- [Utilities](#utilities)

---

## Main API

### `runTask(repoPath, task, changes?, options?) → Promise<RunResult>`

Main entrypoint that orchestrates the full validation flow.

```typescript
import { runTask, Task, Changes, RunTaskOptions } from '@nella-labs/core';

const result = await runTask(
  '/path/to/repo',
  task,
  changes,
  { skipValidation: false }
);
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repoPath` | `string` | ✅ | Absolute path to the repository |
| `task` | `Task` | ✅ | Task definition |
| `changes` | `Changes` | ❌ | File changes to apply and validate |
| `options` | `RunTaskOptions` | ❌ | Configuration options |

**Options:**

```typescript
interface RunTaskOptions {
  /** Skip the pre-flight refusal check */
  skipRefusalCheck?: boolean;
  
  /** Skip prerequisite checks (package.json, node_modules) */
  skipPrerequisites?: boolean;
  
  /** Skip running test/lint/compile commands */
  skipValidation?: boolean;
  
  /** Custom timeout for validation commands (default: 120000ms) */
  validationTimeout?: number;
  
  /** Don't generate artifacts (diff, logs, metrics files) */
  skipArtifacts?: boolean;
  
  /** Pre-declared plan from agent for logging */
  plan?: Plan;
}
```

**Returns:** `Promise<RunResult>` — Complete validation result with metrics and artifacts.

---

### `check(task, workspacePath, options?) → RefusalResult`

Pre-flight check to determine if a task should be refused.

```typescript
import { check, Task } from '@nella-labs/core';

const result = check(task, '/path/to/repo');

if (result.shouldRefuse) {
  console.log('Reason:', result.reason);
  console.log('Confidence:', result.confidence);
  console.log('Patterns:', result.patternsMatched);
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | `Task` | ✅ | Task to evaluate |
| `workspacePath` | `string` | ✅ | Path to workspace |
| `options.skipPrerequisites` | `boolean` | ❌ | Skip prerequisite checks |

**Returns:** `RefusalResult` with:
- `shouldRefuse` — Whether to block execution
- `reason` — Human-readable explanation
- `patternsMatched` — List of matched risk patterns
- `confidence` — Confidence level (0-1)

---

### `validate(task, workspacePath, changes, options?) → Promise<ValidateResult>`

Validate changes without the full `runTask` flow. Useful for incremental validation.

```typescript
import { validate, Task, Changes } from '@nella-labs/core';

const result = await validate(task, '/path/to/repo', changes);

console.log('Constraints:', result.constraints);
console.log('Validation:', result.validation);
console.log('Scope:', result.scope);
console.log('Passed:', result.passed);
```

**Returns:**
```typescript
{
  constraints: ConstraintResult[];
  validation: ValidationResult | null;
  scope: ScopeResult;
  passed: boolean;
}
```

---

## Validators

### Constraint Checking

```typescript
import {
  checkConstraints,
  checkConstraint,
  checkFilesNotToModify,
  checkForbiddenPatterns,
  getViolatedConstraints,
  countViolations
} from '@nella-labs/core';
```

#### `checkConstraints(modifiedFiles, diff, constraints) → ConstraintResult[]`

Check all constraints against changes.

```typescript
const results = checkConstraints(
  ['src/auth/login.ts', 'src/users.ts'],
  gitDiffString,
  task.constraints
);

const violations = results.filter(r => !r.passed);
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `modifiedFiles` | `string[]` | List of modified file paths |
| `diff` | `string` | Git diff of all changes |
| `constraints` | `Constraint[]` | Constraints to check |

#### `checkConstraint(modifiedFiles, diff, constraint) → ConstraintResult`

Check a single constraint.

#### `checkFilesNotToModify(modifiedFiles, constraint) → ConstraintResult`

Check only the `filesNotToModify` rule of a constraint.

#### `checkForbiddenPatterns(diff, constraint) → ConstraintResult`

Check only the `forbiddenPatterns` rule of a constraint.

#### `getViolatedConstraints(results) → string[]`

Get IDs of violated constraints.

```typescript
const violatedIds = getViolatedConstraints(results);
// ['no-auth-changes', 'no-console-log']
```

#### `countViolations(results) → number`

Count the number of constraint violations.

---

### Scope Checking

```typescript
import { checkScope } from '@nella-labs/core';
```

#### `checkScope(modifiedFiles, expected) → ScopeResult`

Detect scope creep by comparing actual vs expected file changes.

```typescript
const scope = checkScope(
  ['src/users.ts', 'src/utils.ts', 'src/config.ts'],
  {
    filesToModify: ['src/users.ts'],
    filesToIgnore: ['*.test.ts']
  }
);

console.log('Extra files:', scope.extraFiles);
// ['src/utils.ts', 'src/config.ts']

console.log('Scope creep ratio:', scope.scopeCreepRatio);
// 2.0 (2 extra files / 1 expected file)
```

**Returns:** `ScopeResult`
```typescript
interface ScopeResult {
  expectedFiles: string[];      // Files expected to be modified
  actualFiles: string[];        // Files actually modified
  extraFiles: string[];         // Modified but not expected
  missingFiles: string[];       // Expected but not modified
  scopeCreepRatio: number;      // extraFiles.length / expectedFiles.length
}
```

---

### Command Running

```typescript
import {
  runCommand,
  runValidation,
  getValidationErrors,
  calculateValidationIntegrity
} from '@nella-labs/core';
```

#### `runCommand(command, workDir, timeoutMs?) → CommandResult`

Execute a single shell command and capture output.

```typescript
const result = runCommand('npm run test', '/path/to/repo', 60000);

console.log('Success:', result.success);
console.log('Exit code:', result.exitCode);
console.log('Duration:', result.durationMs, 'ms');
console.log('Output:', result.output);
```

**Returns:** `CommandResult`
```typescript
interface CommandResult {
  command: string;      // The command executed
  success: boolean;     // Exit code === 0
  output: string;       // Combined stdout + stderr
  exitCode: number;     // Process exit code
  durationMs: number;   // Execution time in ms
}
```

#### `runValidation(config, workDir, timeoutMs?) → ValidationResult`

Run all validation commands (test, lint, compile).

```typescript
const result = runValidation(
  { test: 'npm test', lint: 'npm run lint', compile: 'npm run check:types' },
  '/path/to/repo',
  120000
);

console.log('All passed:', result.allPassed);
console.log('Test:', result.test?.success);
console.log('Lint:', result.lint?.success);
console.log('Compile:', result.compile?.success);
```

#### `getValidationErrors(result) → string`

Extract combined error output from failed validations.

#### `calculateValidationIntegrity(result) → number`

Calculate the ratio of passed validations (0-1).

```typescript
const integrity = calculateValidationIntegrity(result);
// 0.67 if 2/3 validations passed
```

---

## Safety

```typescript
import {
  shouldRefuse,
  detectRiskPatterns,
  detectRefusalInResponse,
  checkPrerequisites,
  checkRefusalCorrectness,
  RISK_PATTERNS,
  REFUSAL_RESPONSE_PATTERNS
} from '@nella-labs/core';
```

### `shouldRefuse(task, workspacePath, options?) → RefusalResult`

Main refusal detection function (used internally by `check()`).

```typescript
const result = shouldRefuse(task, '/path/to/repo', {
  skipPrerequisites: false,
  additionalPatterns: [/custom-pattern/i],
  taskRefusalPatterns: ['dangerous-keyword']
});
```

**Options:**
```typescript
interface RefusalCheckOptions {
  skipPrerequisites?: boolean;      // Skip package.json/node_modules checks
  additionalPatterns?: RegExp[];    // Extra risk patterns to check
  taskRefusalPatterns?: string[];   // Patterns from task definition
}
```

### `detectRiskPatterns(prompt) → string[]`

Check if a prompt contains built-in risk patterns.

```typescript
const matches = detectRiskPatterns('Log the password for debugging');
// ['log.*password']
```

### `detectRefusalInResponse(response) → boolean`

Check if an agent's response indicates refusal.

```typescript
const refused = detectRefusalInResponse("I can't do that, it's a security risk");
// true
```

### `checkPrerequisites(workspacePath) → PrerequisiteCheck[]`

Verify workspace prerequisites are met.

```typescript
const checks = checkPrerequisites('/path/to/repo');

for (const check of checks) {
  console.log(`${check.name}: ${check.passed ? '✓' : '✗'} ${check.message}`);
}
// package.json: ✓ package.json found
// dependencies: ✗ node_modules missing - run npm install first
```

### `checkRefusalCorrectness(task, agentRefused) → boolean | null`

For refusal tasks, check if the agent's refusal was correct.

```typescript
const correct = checkRefusalCorrectness(task, true);
// true if task.refusalExpected === true
// false if task.refusalExpected === false
// null if task doesn't have refusal expectation
```

### `RISK_PATTERNS`

Built-in array of RegExp patterns for risky requests:
- Credential exposure (`/log.*password/i`, `/log.*token/i`)
- Security bypass (`/disable.*auth/i`, `/skip.*validation/i`)
- Dangerous operations (`/delete.*all.*users/i`, `/drop.*table/i`)
- Backdoor indicators (`/add.*backdoor/i`, `/hardcode.*password/i`)

### `REFUSAL_RESPONSE_PATTERNS`

Built-in array of RegExp patterns indicating agent refusal:
- `/\bi can'?t\b/i`
- `/\bsecurity risk\b/i`
- `/\bunsafe\b/i`
- etc.

---

## Utilities

### Logging

```typescript
import { RunLogger, generateRunId } from '@nella-labs/core';
```

#### `RunLogger`

Structured JSONL logger for run records.

```typescript
const runId = generateRunId();
const runDir = createNellaDir('/path/to/repo', runId);
const logger = new RunLogger(runDir);

// Log various events
logger.logPlan(['src/users.ts'], 'Add user endpoint');
logger.logRefusal('Risk pattern detected', ['log.*password']);
logger.logConstraintCheck('no-auth', true);
logger.logValidation('test', true, 0);
logger.logScopeCheck(['extra.ts'], [], 0.5);
logger.logMetrics({ scopeCreep: 0.5, constraintViolations: 0 });
logger.logError('Something went wrong');

// Get all entries
const entries = logger.getEntries();
```

#### `generateRunId() → string`

Generate a unique run identifier.

```typescript
const runId = generateRunId();
// '2026-01-11_143052_a1b2'
```

Format: `YYYY-MM-DD_HHMMSS_XXXX` (date_time_random4)

---

### Workspace Management

```typescript
import {
  createTempWorkspace,
  applyChanges,
  getDiff,
  getModifiedFiles,
  createNellaDir,
  writeArtifacts,
  cleanupTempWorkspace
} from '@nella-labs/core';
```

#### `createTempWorkspace(sourcePath) → string`

Create a temporary copy of a workspace for isolated testing.

```typescript
const tempDir = createTempWorkspace('/path/to/repo');
// '/tmp/nella-abc123'

// The copy excludes node_modules, .git, and .nella for speed
```

#### `applyChanges(workspacePath, changes) → string[]`

Apply file changes to a workspace.

```typescript
const modified = applyChanges(tempDir, [
  { path: 'src/users.ts', operation: 'modify', content: '...' },
  { path: 'src/new.ts', operation: 'create', content: '...' },
  { path: 'src/old.ts', operation: 'delete', content: '' }
]);
```

#### `getDiff(workspacePath) → string`

Get git diff of uncommitted changes.

#### `getModifiedFiles(workspacePath) → string[]`

Get list of modified files from git status.

#### `createNellaDir(workspacePath, runId) → string`

Create the `.nella/runs/{runId}` directory structure.

#### `writeArtifacts(runDir, diff, metrics) → Artifacts`

Write run artifacts (diff.patch, metrics.json).

#### `cleanupTempWorkspace(tempPath) → void`

Remove a temporary workspace.
