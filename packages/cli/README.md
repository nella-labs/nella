# @nella/cli

Command-line interface for Nella - reliability layer for coding agents.

## Installation

```bash
npm install -g @nella/cli
```

## Commands

### `nella check`

Pre-flight check: can the task proceed?

```bash
nella check --task tasks/get-user-by-id --repo ./my-project
```

Returns exit code 0 if OK to proceed, 1 if should refuse.

### `nella validate`

Validate changes against task constraints.

```bash
nella validate --task tasks/get-user-by-id --repo ./my-project --changes changes.json
```

### `nella run`

Full run: check + validate + metrics.

```bash
nella run --task tasks/get-user-by-id --repo ./my-project --changes changes.json
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

## Changes File Format

The `--changes` option expects a JSON file:

```json
{
  "files": [
    {
      "path": "src/users.ts",
      "operation": "modify",
      "content": "// file content..."
    }
  ],
  "diff": "optional git diff string"
}
```

## Examples

```bash
# Check if task can proceed
nella check -t tasks/get-user-by-id -r ./project

# Validate changes (skip running tests)
nella validate -t tasks/get-user-by-id -r ./project -c changes.json --skip-validation

# Full run with JSON output
nella run -t tasks/get-user-by-id -r ./project -c changes.json --json
```
