# API Reference

Complete reference for all Nella MCP tools.

Nella provides 6 MCP tools organized into two categories: Context and Indexing.

## Tool Categories

### Context Tools

Tools for managing session context and assumptions:

| Tool | Description |
|------|-------------|
| [`nella_get_context`](./tools/context-tools.md#nella_get_context) | Get full session context |
| [`nella_add_assumption`](./tools/context-tools.md#nella_add_assumption) | Record an assumption about the codebase |
| [`nella_check_assumptions`](./tools/context-tools.md#nella_check_assumptions) | Get status of recorded assumptions |
| [`nella_check_dependencies`](./tools/context-tools.md#nella_check_dependencies) | Check for dependency changes |

See [Context Tools](./tools/context-tools.md) for details on all context management tools.

### Indexing Tools

Tools for indexing and searching the codebase:

| Tool | Description |
|------|-------------|
| `nella_index` | Index workspace for semantic and lexical search |
| `nella_search` | Hybrid search (semantic + BM25) across indexed codebase |

## Setup

Start the MCP server with:

```bash
npx @getnella/mcp mcp --workspace /path/to/project
```

**Claude Desktop Config:**

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@getnella/mcp", "-w", "/path/to/project"]
    }
  }
}
```

## Response Format

All Nella tools return responses in a consistent markdown format:

```
## [Tool Name] Results

[Status icon] [Summary]

### [Section 1]
[Details...]

### [Section 2]
[Details...]
```

> **Note:** Nella implements the Model Context Protocol (MCP). Tools are called through MCP's standard tool calling mechanism.

## Tool Selection Guide

Choose the right tool based on your needs:

| If you want to... | Use |
|--------------------|-----|
| Search codebase semantically | `nella_search` |
| Index workspace for search | `nella_index` |
| Track assumptions | `nella_add_assumption` / `nella_check_assumptions` |
| Detect dependency drift | `nella_check_dependencies` |
| See session overview | `nella_get_context` |
