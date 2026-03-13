# MCP Server Documentation

The Nella MCP Server exposes Nella's capabilities to AI agents like Claude through the Model Context Protocol. It supports both local stdio mode and hosted HTTP mode.

## Overview

The `@getnella/mcp` package provides a CLI and MCP server that allows AI agents to:

- **Track context** across conversation sessions
- **Search & index** codebases with hybrid semantic/lexical search
- **Share context** across multiple agents via channels
- **Monitor dependencies** for drift detection

## Documentation

| Document | Description |
|----------|-------------|
| [Tools Reference](./tools.md) | Complete reference for all MCP tools |
| [Integration Guide](./integration.md) | Setup for Claude Desktop, Claude Code, hosted/self-hosted, and custom clients |
| [Context Management](../core/context.md) | Session persistence, assumptions, and dependency tracking |
| [CLI Commands](../cli/commands.md) | Full CLI reference (`serve`, `connect`, `auth`, etc.) |
| [Examples](../core/examples.md) | Practical code examples |
| [Tips & Best Practices](../guides/tips-and-best-practices.md) | Always-on setup, prompt tips, workflow guides |

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

Claude: I'll search the codebase for existing patterns and record my assumptions.
[Uses nella_search to find existing API patterns]
[Uses nella_add_assumption to record API structure]
[Makes changes to the codebase]
[Uses nella_check_assumptions to verify assumptions still hold]
```

## Tools

### Context Tools
Track state across sessions:
- `nella_get_context` — Get full session context
- `nella_add_assumption` — Record codebase assumptions
- `nella_check_assumptions` — Validate assumptions
- `nella_check_dependencies` — Detect dependency changes

### Search Tools
Indexing and search:
- `nella_index` — Index a workspace directory
- `nella_search` — Hybrid semantic + lexical codebase search

## Features

### Input Validation
All tool calls are validated against JSON Schema before execution. Invalid arguments return structured error messages with field-level details.

### Caching
Read-only tool results are cached using an LRU cache with per-tool TTL. Mutating tools (`nella_index`, `nella_set_context`) automatically invalidate dependent caches.

### Retry with Backoff
Retryable tools (search, index) automatically retry on transient failures with exponential backoff and jitter. Max retries and backoff parameters are configurable per tool.

### Tool Timeouts
Each tool has a configurable timeout. Long-running tools like `nella_index` (60s) have longer timeouts than quick lookups.

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
│  ┌─────────────┐  ┌────────────┐                           │
│  │   Search    │  │  Context   │                           │
│  │  (2 tools)  │  │ (4 tools)  │                           │
│  └─────────────┘  └────────────┘                           │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                     @usenella/core                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ Indexing │  │  Auth &  │  │  Context │  │    Sync     │  │
│  │ & Search │  │Rate Limit│  │  Sharing │  │             │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┼─────────────┐
                │             │             │
           Workspace      GCP/Supabase    Redis
        .nella/session    (cloud sync)  (rate limits)
```

## Session Persistence

Context is automatically persisted to `.nella/session.json` in your workspace:

- **Assumptions** — Recorded beliefs about the codebase
- **Dependencies** — Package snapshots for drift detection

This allows context to survive across multiple conversations with Claude.

## Related Packages

- [@usenella/core](../core/) — Core reliability engine
- [@getnella/mcp](../../packages/nella/README.md) — CLI + MCP server
- [@usenella/benchmark](../benchmark/) — Benchmarking tools
