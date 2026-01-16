# @nella-labs/core

[![npm](https://img.shields.io/npm/v/@nella-labs/core)](https://www.npmjs.com/package/@nella-labs/core)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)

Reliability layer for coding agents. Enforces behavioral contracts that prevent agents from making unsafe or incorrect changes.

## Features

- **🛡️ Refusal Detection** — Block execution when prerequisites are missing or risk patterns detected
- **📋 Constraint Validation** — Ensure agents don't touch forbidden files or introduce forbidden patterns
- **✅ Validation Execution** — Run test/lint/compile commands and capture proof
- **🔍 Scope Analysis** — Detect scope creep when agents modify files outside the declared plan
- **📊 Metrics Calculation** — Compute scope creep ratio, constraint violations, validation integrity
- **📝 Structured Logging** — Emit JSONL run records for auditing and analysis
- **🧠 Context Management** — Track assumptions, changes, and dependencies across sessions

## Installation

```bash
npm install @nella-labs/core
```

**Prerequisites:** Target repository must have `package.json` and `node_modules` installed.

## Quick Start

```typescript
import { runTask, check, Task, Changes } from '@nella-labs/core';

// 1. Pre-flight check: should this task be refused?
const refusal = check(task, '/path/to/repo');
if (refusal.shouldRefuse) {
  console.error('Task refused:', refusal.reason);
  process.exit(1);
}

// 2. Validate agent changes
const changes: Changes = {
  files: [
    { path: 'src/users.ts', operation: 'modify', content: '...' }
  ]
};

const result = await runTask('/path/to/repo', task, changes);

console.log('Passed:', result.passed);
console.log('Metrics:', result.metrics);
```

## API Overview

### Main Functions

| Function | Description |
|----------|-------------|
| `runTask(repoPath, task, changes?, options?)` | Main entrypoint — full validation flow |
| `check(task, workspacePath, options?)` | Pre-flight refusal check |
| `validate(task, workspacePath, changes, options?)` | Validate without full run |

### Validators

| Function | Description |
|----------|-------------|
| `checkConstraints(files, diff, constraints)` | Check all constraints |
| `checkScope(files, expected)` | Detect scope creep |
| `runValidation(config, workDir)` | Run test/lint/compile |
| `runCommand(command, workDir, timeout?)` | Execute single command |

### Safety

| Function | Description |
|----------|-------------|
| `shouldRefuse(task, workspacePath, options?)` | Full refusal detection |
| `detectRiskPatterns(prompt)` | Check for risky patterns |
| `checkPrerequisites(workspacePath)` | Verify prerequisites |

### Context Management

| Export | Description |
|--------|-------------|
| `ContextManager` | High-level session context orchestrator |
| `SessionStore` | Session metadata and persistence |
| `ChangeLedger` | Track file changes across runs |
| `AssumptionTracker` | Record and validate codebase assumptions |
| `DependencyTracker` | Detect package dependency drift |

### Utilities

| Export | Description |
|--------|-------------|
| `RunLogger` | Structured JSONL logging |
| `generateRunId()` | Generate unique run ID |
| `createTempWorkspace(path)` | Create isolated workspace copy |
| `applyChanges(workspace, changes)` | Apply file changes |

## Metrics

| Metric | Description |
|--------|-------------|
| `scopeCreep` | Ratio of files modified outside expected scope |
| `constraintViolations` | Count of violated constraints |
| `validationIntegrity` | Ratio of validation commands that passed |
| `refusalCorrectness` | Whether refusal matched expectation |

## Documentation

📖 **Full documentation available in [docs/core/](../../docs/core/):**

- [API Reference](../../docs/core/api-reference.md) — Complete function documentation
- [Types Reference](../../docs/core/types.md) — All TypeScript interfaces
- [Configuration](../../docs/core/configuration.md) — Task YAML schema and options
- [Context Management](../../docs/core/context.md) — Session tracking and assumptions
- [Examples](../../docs/core/examples.md) — Practical code examples

## Development

```bash
pnpm build      # Build the package
pnpm dev        # Watch mode
pnpm test       # Run tests
```

## License

[Apache-2.0](../../LICENSE)

## See Also

- [Nella Specification](../../docs/spec.md) — Architecture and design
- [@nella-labs/cli](../cli/README.md) — Command-line interface
- [@nella-labs/benchmark](../benchmark/README.md) — Benchmarking tools

