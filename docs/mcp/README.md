# MCP Server Documentation

The Nella MCP Server exposes Nella's reliability layer to AI agents like Claude through the Model Context Protocol. It supports both local stdio mode and hosted HTTP mode, providing 18 tools across 4 categories.

## Overview

The `@usenella/nella` package provides a CLI and MCP server that allows AI agents to:

- **Validate changes** against constraints before/after making them
- **Detect risks** in proposed code modifications
- **Track context** across conversation sessions
- **Check prerequisites** before starting work
- **Search & index** codebases with hybrid semantic/lexical search
- **Share context** across multiple agents via channels
- **Verify code** against the indexed codebase for type and API correctness
- **Monitor status** of the server, workspaces, and connected agents

## Documentation

| Document | Description |
|----------|-------------|
| [Tools Reference](./tools.md) | Complete reference for all 18 MCP tools |
| [Integration Guide](./integration.md) | Setup for Claude Desktop, Claude Code, hosted/self-hosted, and custom clients |
| [Context Management](../core/context.md) | Session persistence, assumptions, and dependency tracking |
| [CLI Commands](../cli/commands.md) | Full CLI reference (`serve`, `connect`, `auth`, etc.) |
| [Examples](../core/examples.md) | Practical code examples |

## Quick Start

### 1. Install

```bash
npm install -g @usenella/nella
# or use npx without installing
npx @usenella/nella mcp --help
```

### 2. Configure Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@usenella/nella", "mcp", "--workspace", "/path/to/project"]
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

### Core Tools
Indexing, search, shared context, and server management (available via `nella serve` or direct import):
- `nella_search` — Hybrid semantic + lexical codebase search
- `nella_verify` — Verify code against indexed codebase
- `nella_index` — Index a workspace directory
- `nella_get_context` (core) — Read shared cross-agent context
- `nella_set_context` — Publish context to shared channels
- `nella_status` — Server status, workspace health, connected agents

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude / Agent / Client                    │
└─────────────────────────────────────────────────────────────┘
                              │
              MCP Protocol (stdio OR Streamable HTTP)
                              │
┌─────────────────────────────────────────────────────────────┐
│                     @usenella/nella                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Validation  │  │   Safety    │  │      Context        │  │
│  │  (3 tools)  │  │  (3 tools)  │  │     (6 tools)       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                     @usenella/core                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
│  │Validators│  │ Indexing │  │  Auth &  │  │   Context   │  │
│  │ & Safety │  │ & Search │  │Rate Limit│  │  Sharing    │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
│  │  Agents  │  │  Export  │  │   Sync   │  │ Playground  │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘  │
│────────────────── Core MCP Tools (6) ──────────────────────│  │
└─────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┼─────────────┐
                │             │             │
           Workspace      GCP/Supabase    Redis
        .nella/session    (cloud sync)  (rate limits)
```

## Session Persistence

Context is automatically persisted to `.nella/session.json` in your workspace:

- **Changes** — All file modifications during the session
- **Assumptions** — Recorded beliefs about the codebase
- **Dependencies** — Package snapshots for drift detection
- **Statistics** — Hotspot files, session duration, etc.

This allows context to survive across multiple conversations with Claude.

## Related Packages

- [@usenella/core](../core/) — Core reliability engine
- [@usenella/nella](../../packages/nella/README.md) — CLI + MCP server
- [@usenella/benchmark](../benchmark/) — Benchmarking tools
