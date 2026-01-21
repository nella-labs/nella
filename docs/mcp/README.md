# MCP Server Documentation

The Nella MCP Server exposes Nella's reliability layer to AI agents like Claude through the Model Context Protocol.

## Overview

The `@nella-labs/nella` package provides both a CLI and an MCP server that allows AI agents to:

- **Validate changes** against constraints before/after making them
- **Detect risks** in proposed code modifications
- **Track context** across conversation sessions
- **Check prerequisites** before starting work

## Documentation

| Document | Description |
|----------|-------------|
| [Tools Reference](./tools.md) | Complete reference for all 12 MCP tools |
| [Integration Guide](./integration.md) | Setup for Claude Desktop, Claude Code, and custom clients |
| [Context Management](./context.md) | Session persistence, assumptions, and dependency tracking |
| [Examples](./examples.md) | Practical usage examples and workflows |

## Quick Start

### 1. Install

```bash
npm install -g @nella-labs/nella
# or use npx without installing
npx @nella-labs/nella mcp --help
```

### 2. Configure Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@nella-labs/nella", "mcp", "--workspace", "/path/to/project"]
    }
  }
}
```

### 3. Use with Claude

Once configured, Claude can use Nella tools naturally:

```
User: Add pagination to the users API

Claude: I'll first check prerequisites and record my assumptions about the codebase.
[Uses nella_check_prerequisites]
[Uses nella_add_assumption to record API structure]
[Makes changes to the codebase]
[Uses nella_run to validate the changes]
```

## Tool Categories

### Validation Tools
Verify changes meet requirements:
- `nella_check` — Quick constraint validation
- `nella_validate` — Run test/lint/compile commands
- `nella_run` — Complete validation workflow

### Safety Tools
Detect and prevent risky operations:
- `nella_detect_risks` — Scan for dangerous patterns
- `nella_should_refuse` — Pre-flight refusal check
- `nella_check_prerequisites` — Verify workspace setup

### Context Tools
Track state across sessions:
- `nella_get_context` — Get full session context
- `nella_add_assumption` — Record codebase assumptions
- `nella_check_assumptions` — Validate assumptions
- `nella_get_file_history` — Track file changes
- `nella_check_dependencies` — Detect dependency changes
- `nella_record_change` — Manual change recording

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Claude / Agent                        │
└─────────────────────────────────────────────────────────────┘
                              │
                    MCP Protocol (stdio)
                              │
┌─────────────────────────────────────────────────────────────┐
│                     @nella-labs/mcp                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Validation  │  │   Safety    │  │      Context        │  │
│  │   Tools     │  │   Tools     │  │       Tools         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                     @nella-labs/core                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
│  │Validators│  │  Safety  │  │  Utils   │  │   Context   │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                         Workspace
                      .nella/session.json
```

## Session Persistence

Context is automatically persisted to `.nella/session.json` in your workspace:

- **Changes** — All file modifications during the session
- **Assumptions** — Recorded beliefs about the codebase
- **Dependencies** — Package snapshots for drift detection
- **Statistics** — Hotspot files, session duration, etc.

This allows context to survive across multiple conversations with Claude.

## Related Packages

- [@nella-labs/core](../core/) — Core reliability engine
- [@nella-labs/cli](../cli/) — Command-line interface
- [@nella-labs/benchmark](../benchmark/) — Benchmarking tools
