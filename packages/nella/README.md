# @nella-labs/cli

[![npm](https://img.shields.io/npm/v/@nella-labs/cli)](https://www.npmjs.com/package/@nella-labs/cli)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Command-line interface for Nella — reliability layer for coding agents.

## Installation

```bash
npm install -g @nella-labs/cli
```

## Commands

| Command | Description | Exit Codes |
|---------|-------------|------------|
| `nella check` | Pre-flight safety check | 0 = proceed, 1 = refuse |
| `nella validate` | Validate changes against constraints | 0 = pass, 1 = fail |
| `nella run` | Full run: check + validate + metrics | 0 = pass, 1 = fail |

## Quick Start

```bash
# Check if task is safe to proceed
nella check -t tasks/get-user-by-id -r ./my-project

# Validate changes against constraints
nella validate -t tasks/get-user-by-id -r ./my-project -c changes.json

# Full run with JSON output
nella run -t tasks/get-user-by-id -r ./my-project -c changes.json --json
```

## Options

| Option | Short | Description |
|--------|-------|-------------|
| `--task` | `-t` | Path to task.yaml or task directory |
| `--repo` | `-r` | Path to repository |
| `--changes` | `-c` | Path to changes.json file |
| `--skip-validation` | | Skip running test/lint/compile |
| `--skip-prerequisites` | | Skip prerequisite checks |
| `--json` | | Output as JSON |
| `--help` | `-h` | Show help |

## What It Checks

### `nella check`
- Risk patterns in task prompt (logging passwords, disabling auth, etc.)
- Prerequisites (required files exist)
- Task structure validity

### `nella validate`
- Constraint violations (forbidden files, patterns)
- Scope creep (files modified outside expected scope)
- Validation commands (test/lint/compile)

### `nella run`
Returns a complete `RunResult` with pass/fail status, constraint violations, validation results, scope analysis, and computed metrics.

## Documentation

| Document | Description |
|----------|-------------|
| [Commands Reference](../../docs/cli/commands.md) | Detailed command documentation |
| [Examples](../../docs/cli/examples.md) | CI/CD integration, batch processing |
| [Core API](../../docs/core/api-reference.md) | Underlying core library |

## Related Packages

- [`@nella-labs/core`](../core) — Core reliability primitives
- [`@nella-labs/benchmark`](../benchmark) — Benchmark suite

## License

[Apache-2.0](../../LICENSE)
