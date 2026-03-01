# @getnella/mcp

> Unified CLI and MCP Server for AI agent validation

[![npm version](https://img.shields.io/npm/v/@getnella/mcp.svg)](https://www.npmjs.com/package/@getnella/mcp)
[![License](https://img.shields.io/badge/License-Proprietary-blue.svg)](https://getnella.dev)

Nella is a complete validation toolkit for AI coding agents. It provides both a CLI for direct use and an MCP (Model Context Protocol) server for integration with AI assistants like Claude.

## Installation

```bash
# Global installation
npm install -g @getnella/mcp

# Or use with npx
npx @getnella/mcp --help

# As a dev dependency
npm install -D @getnella/mcp
```

## Quick Start

### CLI Usage

```bash
# Pre-flight check before running an agent
nella check -t ./tasks/my-task -r ./project

# Validate agent changes
nella validate -t ./tasks/my-task -r ./project -c changes.json

# Full validation run with metrics
nella run -t ./tasks/my-task -r ./project -c changes.json
```

### MCP Server (for Claude Desktop)

```bash
# Start MCP server
nella mcp --workspace /path/to/project
```

### Playground Server

```bash
# Start playground with real-time dashboard
nella playground --workspace /path/to/project

# With custom port
nella playground --workspace /path/to/project --port 4000
```

Open `http://localhost:3847` to view the dashboard with:
- Real-time tool call monitoring
- Chain of thought visualization
- Cost tracking (tokens + estimated $)
- Session management

## Commands

### `nella check`

Pre-flight check to determine if a task can proceed.

```bash
nella check --task <path> --repo <path> [options]
```

Detects:
- Risk patterns (dangerous requests like logging passwords)
- Missing prerequisites (package.json, node_modules)
- Invalid task structure

### `nella validate`

Validate agent changes against task constraints.

```bash
nella validate --task <path> --repo <path> --changes <path> [options]
```

Validates:
- Constraint violations (forbidden files, patterns)
- Scope creep (unexpected file modifications)
- Test/lint/compile commands (unless `--skip-validation`)

### `nella run`

Full validation run combining check + validate + metrics.

```bash
nella run --task <path> --repo <path> [--changes <path>] [options]
```

Includes:
- All checks from `check` and `validate`
- Metrics calculation
- Artifact generation in `.nella/runs/`

### `nella mcp`

Start an MCP server for AI agent integration.

```bash
nella mcp [--workspace <path>]
```

### `nella playground`

Start the playground server with a real-time dashboard.

```bash
nella playground [--workspace <path>] [--port <number>] [--host <host>]
```

Features:
- **Dashboard UI** — Visual interface for monitoring agent sessions
- **WebSocket updates** — Real-time tool calls, chain of thought, cost tracking
- **HTTP API** — `/health`, `/api/status`, `/api/session/:id` endpoints

## MCP Integration

### Claude Desktop Setup

Add to your Claude Desktop config:

**Windows** (`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@getnella/mcp", "--workspace", "C:/path/to/project"]
    }
  }
}
```

**macOS/Linux** (`~/.config/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@getnella/mcp", "--workspace", "/path/to/project"]
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `nella_check` | Pre-flight task validation |
| `nella_validate` | Validate agent changes against constraints |
| `nella_run` | Full validation run with metrics |
| `nella_detect_risks` | Detect dangerous patterns in prompts |
| `nella_should_refuse` | Check if a task should be refused |
| `nella_check_prerequisites` | Verify project prerequisites |
| `nella_get_context` | Get current validation context |
| `nella_add_assumption` | Add a context assumption |
| `nella_check_assumptions` | Validate all assumptions |
| `nella_get_file_history` | Track file modification history |
| `nella_check_dependencies` | Verify project dependencies |
| `nella_record_change` | Record a file change for validation |

## CLI Options

| Option | Short | Description |
|--------|-------|-------------|
| `--task <path>` | `-t` | Path to task.yaml or task directory |
| `--repo <path>` | `-r` | Path to repository |
| `--changes <path>` | `-c` | Path to changes.json file |
| `--workspace <path>` | `-w` | Path to workspace (for `mcp`/`playground`) |
| `--port <number>` | `-p` | Port for playground server (default: 3847) |
| `--host <host>` | | Host for playground server (default: localhost) |
| `--skip-validation` | | Skip test/lint/compile commands |
| `--skip-prerequisites` | | Skip package.json/node_modules checks |
| `--json` | | Output as JSON |
| `--help` | `-h` | Show help |

## Programmatic Usage

```typescript
// Core validation functions
import {
  runTask,
  check,
  validate,
  checkConstraints,
  detectRiskPatterns,
} from '@getnella/mcp';

// MCP server
import { startMcpServer } from '@getnella/mcp/mcp';

// Example: Run validation programmatically
const result = await runTask(repoPath, task, changes);
console.log(result.passed ? 'Validation passed!' : 'Validation failed');
```

## Core Modules (Re-exported)

`@getnella/mcp` re-exports everything from `@usenella/core`, including advanced modules:

- Indexing & search (RAG)
- Workspace management
- Auth + rate limiting
- Context sharing
- Cloud sync (GCS)
- Playground server

See the [Core Modules guide](../../docs/core/modules.md) for examples.

## Task YAML Format

```yaml
id: my-task
name: "Task description"
prompt: |
  Your task prompt here...
category: feature  # feature | bug-fix | refactor | edge-case | refusal
difficulty: easy   # easy | medium | hard
fixture: my-project

constraints:
  - id: no-auth-changes
    description: "Do not modify authentication"
    files_not_to_modify:
      - "src/auth/**"
    forbidden_patterns:
      - "console\\.log"

validation:
  test: "npm run test"
  lint: "npm run lint"
  compile: "npm run check:types"

expected:
  files_to_modify:
    - "src/routes/users.ts"
```

## Changes JSON Format

```json
{
  "files": [
    {
      "path": "src/users.ts",
      "operation": "modify",
      "content": "// Full file content..."
    }
  ]
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success / OK to proceed / Validation passed |
| `1` | Failure / Should refuse / Validation failed |

## Related Packages

- [`@usenella/core`](https://www.npmjs.com/package/@usenella/core) - Core validation library
- [`@usenella/benchmark`](https://www.npmjs.com/package/@usenella/benchmark) - Benchmarking tools

## Documentation

Full documentation available at:
- [CLI Commands](../../docs/cli/commands.md)
- [MCP Integration](../../docs/mcp/integration.md)
- [Core API Reference](../../docs/core/api-reference.md)
- [Core Modules](../../docs/core/modules.md)
- [Examples](../../docs/core/examples.md)

## License

MIT © [Nella Labs](https://github.com/usenella)
