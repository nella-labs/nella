# @nella/core

Reliability layer for coding agents. Enforces behavioral contracts that prevent agents from making unsafe or incorrect changes.

## What It Does

Core gates and validates agent changes:

- **Refuses** when prerequisites are missing or risk patterns detected
- **Validates constraints** (don't touch forbidden files, no forbidden patterns)
- **Runs validation** (test/lint/compile) and captures proof
- **Checks scope** (detect scope creep outside declared plan)
- **Calculates metrics** (scope creep ratio, constraint violations, validation integrity)
- **Emits structured logs** (JSONL run records)

## Installation

```bash
npm install @nella/core
```

## Usage

```typescript
import { runTask, check, Task } from '@nella/core';

// Pre-flight check: can this task proceed?
const refusal = check(task, '/path/to/repo');
if (refusal.shouldRefuse) {
  console.log('Refused:', refusal.reason);
}

// Full validation with changes
const result = await runTask('/path/to/repo', task, {
  files: [
    { path: 'src/users.ts', operation: 'modify', content: '...' }
  ]
});

console.log('Passed:', result.passed);
console.log('Metrics:', result.metrics);
```

## API

### `runTask(repoPath, task, changes?, options?) → RunResult`

Main entrypoint. Orchestrates the full validation flow.

### `check(task, workspacePath, options?) → RefusalResult`

Pre-flight check. Returns whether the task should be refused.

### `checkConstraints(files, diff, constraints) → ConstraintResult[]`

Validate changes against constraint definitions.

### `runValidation(config, workDir) → ValidationResult`

Execute test/lint/compile commands.

### `checkScope(files, expected) → ScopeResult`

Detect scope creep.

## Types

See [types/](./src/types/) for full type definitions:

- `Task` - Task definition
- `Constraint` - Constraint rules
- `RunResult` - Complete run output
- `Metrics` - Computed quality metrics

## Development

```bash
pnpm build      # Build the package
pnpm dev        # Watch mode
pnpm test       # Run tests
```

