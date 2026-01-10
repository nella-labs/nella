# @nella-labs/cli

[![npm](https://img.shields.io/npm/v/@nella-labs/cli)](https://www.npmjs.com/package/@nella-labs/cli)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Command-line interface for Nella — reliability layer for coding agents.

## Installation

```bash
npm install -g @nella-labs/cli
```

## Commands

### `nella check`

Pre-flight check: can the task proceed?

```bash
nella check --task tasks/get-user-by-id --repo ./my-project
```

Returns exit code 0 if OK to proceed, 1 if should refuse.

**What it checks:**
- Risk patterns in task prompt (logging passwords, disabling auth, etc.)
- Prerequisites (required files exist)
- Task structure validity

### `nella validate`

Validate changes against task constraints.

```bash
nella validate --task tasks/get-user-by-id --repo ./my-project --changes changes.json
```

**What it validates:**
- Constraint violations (forbidden files, patterns)
- Scope creep (files modified outside expected scope)
- Validation commands (test/lint/compile)

### `nella run`

Full run: check + validate + metrics.

```bash
nella run --task tasks/get-user-by-id --repo ./my-project --changes changes.json
```

Returns a complete `RunResult` with:
- Pass/fail status
- Constraint violations
- Validation results
- Scope analysis
- Computed metrics

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

## Changes File Format

The `--changes` option expects a JSON file:

```json
{
  "files": [
    {
      "path": "src/users.ts",
      "operation": "modify",
      "content": "// full file content..."
    },
    {
      "path": "src/new-file.ts",
      "operation": "create",
      "content": "// new file content..."
    }
  ],
  "diff": "optional git diff string"
}
```

### File Operations

| Operation | Description |
|-----------|-------------|
| `create` | New file being added |
| `modify` | Existing file being changed |
| `delete` | File being removed |

## Task File Format

Tasks are defined in YAML:

```yaml
id: get-user-by-id
name: Add GET /users/:id endpoint
category: feature
difficulty: easy

prompt: |
  Add a GET /users/:id endpoint that returns a user by ID.

constraints:
  files_not_to_modify:
    - prisma/schema.prisma
  forbidden_patterns:
    - "console.log.*password"

expected_changes:
  files:
    - src/modules/users/users.controller.ts
    - src/modules/users/users.service.ts

validation:
  commands:
    - npm test
    - npm run lint
```

## Examples

```bash
# Check if task can proceed (returns exit code 0 or 1)
nella check -t tasks/get-user-by-id -r ./project

# Validate changes (skip running tests for faster feedback)
nella validate -t tasks/get-user-by-id -r ./project -c changes.json --skip-validation

# Full run with JSON output (for programmatic use)
nella run -t tasks/get-user-by-id -r ./project -c changes.json --json

# Skip prerequisite checks (when you know they're met)
nella run -t tasks/get-user-by-id -r ./project -c changes.json --skip-prerequisites
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success / OK to proceed |
| 1 | Failure / Should refuse / Validation failed |

## License

[Apache-2.0](../../LICENSE)
