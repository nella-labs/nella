# API Reference

Reference for the 7 MCP tools exposed by the local Nella server in `packages/nella/src/mcp/server.ts`.

## Tool Categories

### Context Tools

| Tool | Description |
|------|-------------|
| [`nella_get_context`](./tools/nella-get-context.md) | Read the current session context, trust metadata, and heartbeat challenge. |
| [`nella_add_assumption`](./tools/nella-add-assumption.md) | Record an assumption about the codebase. |
| [`nella_check_assumptions`](./tools/nella-check-assumptions.md) | Review valid and invalidated assumptions. |
| [`nella_check_dependencies`](./tools/nella-check-dependencies.md) | Detect dependency drift since the last snapshot. |

See [Context Tools](./tools/context-tools.md) for the grouped context workflow.

### Indexing Tools

| Tool | Description |
|------|-------------|
| [`nella_index`](./tools/nella-index.md) | Build or refresh the workspace index used for search. |
| [`nella_search`](./tools/nella-search.md) | Search the indexed workspace with hybrid, semantic, or lexical retrieval. |

### Trust Chain Tool

| Tool | Description |
|------|-------------|
| [`nella_heartbeat`](./tools/nella-heartbeat.md) | Verify trust-chain continuity using the current challenge value. |

## Setup

Start the local MCP server with either of these entry points:

```bash
npx -y @getnella/mcp --workspace /path/to/project
# or
nella mcp --workspace /path/to/project
```

**Claude Desktop config**

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "-w", "/path/to/project"]
    }
  }
}
```

## Behavior Notes

- `nella_search.filePattern` is a case-insensitive substring filter on indexed file paths. It does not support glob syntax.
- `nella_search.language` is forwarded as a file-type filter. Language names like `typescript` and raw extensions like `ts` both work.
- `nella_add_assumption.relatedFiles` accepts exact paths or glob patterns because the underlying assumption tracker matches them with `minimatch`.
- `nella_check_assumptions` sets `isError: true` when assumptions were invalidated.
- `nella_check_dependencies` sets `isError: true` when dependency changes are detected.
- `nella_get_context` includes the session trust token, integrity guidance, and the current heartbeat challenge.

## Tool Selection Guide

| If you want to... | Use |
|--------------------|-----|
| Index the workspace for search | [`nella_index`](./tools/nella-index.md) |
| Find code or docs in the indexed workspace | [`nella_search`](./tools/nella-search.md) |
| Review the current session and trust metadata | [`nella_get_context`](./tools/nella-get-context.md) |
| Record a working assumption | [`nella_add_assumption`](./tools/nella-add-assumption.md) |
| Check whether assumptions still hold | [`nella_check_assumptions`](./tools/nella-check-assumptions.md) |
| Detect dependency drift | [`nella_check_dependencies`](./tools/nella-check-dependencies.md) |
| Continue the challenge-response trust chain | [`nella_heartbeat`](./tools/nella-heartbeat.md) |
