# How to Use Nella

An end-to-end guide for using Nella with AI coding agents.

## 1) Install

```bash
npm install -g @getnella/mcp
```

## 2) Set up MCP

Configure your AI agent to connect to Nella:

```bash
# Auto-configure Claude Desktop, VS Code, or Cursor
nella connect --client all
```

Or start a local MCP server:

```bash
nella mcp --workspace /path/to/project
```

## 3) Index your codebase

```bash
nella index --force
```

This creates vector embeddings and lexical indexes so agents can search your real codebase instead of hallucinating references.

## 4) Use the MCP tools

Once connected, your AI agent has access to these tools:

### Search

- **`nella_search`** — Hybrid search across your indexed codebase
- **`nella_index`** — Re-index when the codebase changes

### Context tracking

- **`nella_get_context`** — See session overview (changes, assumptions, stats)
- **`nella_add_assumption`** — Record assumptions about the codebase
- **`nella_check_assumptions`** — Verify assumptions haven't been invalidated
- **`nella_check_dependencies`** — Detect dependency drift (package.json/lockfile changes)

### Trust chain

- **`nella_heartbeat`** — Verify trust-chain continuity between tool calls

