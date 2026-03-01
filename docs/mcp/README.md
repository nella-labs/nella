# MCP Server Documentation

The Nella MCP Server exposes Nella's reliability layer to AI agents like Claude through the Model Context Protocol. It supports both local stdio mode and hosted HTTP mode, providing 23 tools across 5 categories.

## Overview

The `@getnella/mcp` package provides a CLI and MCP server that allows AI agents to:

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
| [Tools Reference](./tools.md) | Complete reference for all 23 MCP tools |
| [Integration Guide](./integration.md) | Setup for Claude Desktop, Claude Code, hosted/self-hosted, and custom clients |
| [Context Management](../core/context.md) | Session persistence, assumptions, and dependency tracking |
| [CLI Commands](../cli/commands.md) | Full CLI reference (`serve`, `connect`, `auth`, etc.) |
| [Examples](../core/examples.md) | Practical code examples |
| [Tips & Best Practices](../guides/tips-and-best-practices.md) | Always-on setup, prompt tips, constraint patterns, workflow guides |

## Quick Start

### 1. Install

```bash
npm install -g @getnella/mcp
# or use npx without installing
npx @getnella/mcp mcp --help
```

### 2. Configure Claude Desktop

Add to your `claude_desktop_config.json`:

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
- `nella_explain` — Code explanation via structured search and analysis
- `nella_docs` — Documentation and comment search
- `nella_history` — Recent tool call history

### Code Tools
Code analysis and test generation:
- `nella_refactor` — Detect refactoring opportunities (nesting, duplication, magic numbers, etc.)
- `nella_test` — Generate test skeletons for functions and classes

## Phase 7 Features

### Input Validation
All tool calls are validated against JSON Schema before execution. Invalid arguments return structured error messages with field-level details.

### Caching
Read-only tool results are cached using an LRU cache with per-tool TTL. Mutating tools (`nella_index`, `nella_set_context`) automatically invalidate dependent caches. Cache stats are available via `nella_status`.

### Retry with Backoff
Retryable tools (search, verify, index) automatically retry on transient failures with exponential backoff and jitter. Max retries and backoff parameters are configurable per tool.

### Tool Timeouts
Each tool has a configurable timeout. Long-running tools like `nella_index` (60s) have longer timeouts than quick lookups like `nella_history` (5s).

### Tool Chaining
Tools can invoke other tools internally. For example, `nella_explain` chains to `nella_search` to find code before building an explanation. Chain depth is limited to 3 to prevent infinite recursion.

### Streaming (Progress Notifications)
Long-running tools like `nella_index` emit progress notifications via MCP SDK's `progressToken` mechanism, allowing clients to display real-time progress.

### OpenTelemetry
Optional tracing and metrics via OpenTelemetry SDK. Install `@opentelemetry/sdk-node` and related packages to enable. Degrades gracefully if packages are not available.

### Tool Versioning
All tools are versioned (currently `1.0.0`) and managed through a `ToolRegistry`. Supports multiple versions of the same tool, deprecation, and version-based lookup (`nella_search@1.0.0`).

### Tool Metadata
Each tool includes category, tags, examples, timeout, and retry configuration in its schema — enabling rich tool discovery and documentation generation.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude / Agent / Client                    │
└─────────────────────────────────────────────────────────────┘
                              │
              MCP Protocol (stdio OR Streamable HTTP)
                              │
┌─────────────────────────────────────────────────────────────┐
│                     @getnella/mcp                          │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  ┌──────┐  │
│  │ Validation  │  │   Safety    │  │  Context   │  │ Code │  │
│  │  (3 tools)  │  │  (3 tools)  │  │ (6 tools)  │  │(2)   │  │
│  └─────────────┘  └─────────────┘  └────────────┘  └──────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                     @usenella/core                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
│  │Validators│  │ Indexing │  │  Auth &  │  │   Context   │  │
│  │ & Safety │  │ & Search │  │Rate Limit│  │  Sharing    │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌─────────────┐               │
│  │  Agents  │  │   Sync   │  │ Playground  │               │
│  └──────────┘  └──────────┘  └─────────────┘               │
│────────────────── Core MCP Tools (9) ──────────────────────│  │
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
- [@getnella/mcp](../../packages/nella/README.md) — CLI + MCP server
- [@usenella/benchmark](../benchmark/) — Benchmarking tools
