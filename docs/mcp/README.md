# MCP Server Documentation

The Nella MCP Server exposes Nella's capabilities to AI agents like Claude through the Model Context Protocol. It supports both local stdio mode and hosted HTTP mode.

> Status: this folder is an engineering reference. For the maintained local CLI/MCP contract, prefer [`../../packages/nella/README.md`](../../packages/nella/README.md), [`../cli/commands.md`](../cli/commands.md), and the setup guides in [`../integrations/`](../integrations/).

## Overview

The `@getnella/mcp` package provides a CLI and MCP server that allows AI agents to:

- **Track context** across conversation sessions
- **Search & index** codebases with hybrid semantic/lexical search
- **Monitor dependencies** for drift detection
- **Verify trust-chain continuity** with challenge-response heartbeats

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
npx -y @getnella/mcp --workspace /path/to/project
```

### 2. Configure Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "--workspace", "/path/to/project"]
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

### Trust Chain
- `nella_heartbeat` — Continue the trust chain between tool calls

## Features

### Input Validation
All tool calls are validated against JSON Schema before execution. Invalid arguments return structured error messages with field-level details.

### Session Persistence
Workspace context is persisted under `.nella/`, so assumptions and dependency snapshots survive across conversations.

### Hosted Auth and Rate Limiting
`nella serve` uses Supabase-backed API key validation and Redis-backed or in-memory rate limiting for hosted deployments.

### Usage Logging
Both local and hosted servers record tool usage opportunistically when a valid hosted session is available.

### Trust Chain Protection
`nella_get_context` issues a challenge and `nella_heartbeat` continues the chain, helping clients confirm they are still interacting with the same trusted session.

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
│  ┌─────────────┐  ┌────────────┐  ┌────────────┐           │
│  │   Search    │  │  Context   │  │ Trust Chain│           │
│  │  (2 tools)  │  │ (4 tools)  │  │  (1 tool)  │           │
│  └─────────────┘  └────────────┘  └────────────┘           │
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
