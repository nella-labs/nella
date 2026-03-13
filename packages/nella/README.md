# @getnella/mcp

> Unified CLI and MCP Server for AI agent reliability

[![npm version](https://img.shields.io/npm/v/@getnella/mcp.svg)](https://www.npmjs.com/package/@getnella/mcp)
[![License](https://img.shields.io/badge/License-Proprietary-blue.svg)](https://getnella.dev)

Nella provides codebase indexing, hybrid search, and context tracking for AI coding agents via MCP (Model Context Protocol).

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

### MCP Server (for Claude Desktop)

```bash
# Start MCP server
nella mcp --workspace /path/to/project
```

### Index Your Codebase

```bash
# Index for search
nella index --force
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

### `nella index`

Index workspace for semantic and lexical search.

```bash
nella index [--force]
```

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

### `nella connect`

Configure MCP clients.

```bash
nella connect --client claude|vscode|cursor|all [--server-url <url>] [--api-key <key>]
```

### `nella auth`

Authentication management.

```bash
nella auth login|logout|status
```

## MCP Integration

### Claude Desktop Setup

Add to your Claude Desktop config:

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
| `nella_index` | Index workspace for semantic and lexical search |
| `nella_search` | Hybrid search (semantic + BM25) across indexed codebase |
| `nella_get_context` | Get current session context |
| `nella_add_assumption` | Record an assumption about the codebase |
| `nella_check_assumptions` | Get status of recorded assumptions |
| `nella_check_dependencies` | Check for dependency drift |

## CLI Options

| Option | Short | Description |
|--------|-------|-------------|
| `--workspace <path>` | `-w` | Path to workspace (for `mcp`/`playground`) |
| `--port <number>` | `-p` | Port for playground server (default: 3847) |
| `--host <host>` | | Host for playground server (default: localhost) |
| `--force` | `-f` | Force full reindex |
| `--json` | | Output as JSON |
| `--help` | `-h` | Show help |

## Programmatic Usage

```typescript
import {
  ContextManager,
  createIndexManager,
  IndexManager,
} from '@getnella/mcp';

// MCP server
import { startMcpServer } from '@getnella/mcp/mcp';
```

## Core Modules (Re-exported)

`@getnella/mcp` re-exports key modules from `@usenella/core`:

- Indexing & search (RAG)
- Context tracking (assumptions, dependencies)
- Workspace management
- Auth + rate limiting
- Cloud sync (GCS)
- Playground server

See the [Core Modules guide](../../docs/core/modules.md) for examples.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Failure |

## Related Packages

- [`@usenella/core`](https://www.npmjs.com/package/@usenella/core) - Core library
- [`@usenella/benchmark`](https://www.npmjs.com/package/@usenella/benchmark) - Benchmarking tools

## Documentation

Full documentation available at:
- [CLI Commands](../../docs/cli/commands.md)
- [MCP Integration](../../docs/mcp/integration.md)
- [Core API Reference](../../docs/core/api-reference.md)
- [Core Modules](../../docs/core/modules.md)

## License

MIT © [Nella Labs](https://github.com/usenella)
