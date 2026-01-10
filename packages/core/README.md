# @nella-labs/core

[![npm](https://img.shields.io/npm/v/@nella-labs/core)](https://www.npmjs.com/package/@nella-labs/core)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

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
npm install @nella-labs/core
```

## Usage

```typescript
import { runTask, check, Task } from '@nella-labs/core';

// Pre-flight check: can this task proceed?
const refusal = check(task, '/path/to/repo');
if (refusal.shouldRefuse) {
  console.log('Refused:', refusal.reason);
  process.exit(1);
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

**Parameters:**
- `repoPath` — Path to the repository
- `task` — Task definition (parsed from YAML)
- `changes` — Optional file changes to apply
- `options.skipValidation` — Skip running test/lint/compile commands
- `options.skipPrerequisites` — Skip prerequisite checks

**Returns:** `RunResult` with validation status, metrics, and artifacts.

### `check(task, workspacePath, options?) → RefusalResult`

Pre-flight check. Returns whether the task should be refused.

**Use cases:**
- Detect risky patterns in task prompts (logging passwords, disabling auth)
- Check if prerequisites are met (required files exist)
- Validate task structure before execution

### `checkConstraints(files, diff, constraints) → ConstraintResult[]`

Validate changes against constraint definitions.

**Checks:**
- Files not to modify (glob patterns)
- Forbidden patterns in code (regex)

### `runValidation(config, workDir) → ValidationResult`

Execute test/lint/compile commands and capture output.

### `checkScope(files, expected) → ScopeResult`

Detect scope creep by comparing modified files against expected changes.

**Returns:**
- `scopeCreep` — Ratio of unexpected file changes
- `extraFiles` — Files modified that weren't in the expected list

## Types

See [types/](./src/types/) for full type definitions:

| Type | Description |
|------|-------------|
| `Task` | Task definition with constraints, validation, expected changes |
| `Constraint` | Constraint rules (files_not_to_modify, forbidden_patterns) |
| `RunResult` | Complete run output with pass/fail, metrics, artifacts |
| `RefusalResult` | Pre-flight check result (shouldRefuse, reason, patterns) |
| `Metrics` | Computed quality metrics (VI, CVR, SC, etc.) |
| `ValidationResult` | Test/lint/compile execution results |

## Metrics

Nella Core computes these metrics:

| Metric | Description |
|--------|-------------|
| `validationIntegrity` | Ratio of validation commands that passed |
| `constraintViolationRate` | Ratio of constraints violated |
| `scopeCreep` | Ratio of files modified outside expected scope |
| `passedAll` | Boolean: all validations and constraints passed |

## Development

```bash
pnpm build      # Build the package
pnpm dev        # Watch mode
pnpm test       # Run tests
```

## License

[Apache-2.0](../../LICENSE)

