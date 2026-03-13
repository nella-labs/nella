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

- **`nella_search`** — Hybrid search (semantic + BM25) across your indexed codebase
- **`nella_index`** — Re-index when the codebase changes

### Context tracking

- **`nella_get_context`** — See session overview (changes, assumptions, stats)
- **`nella_add_assumption`** — Record assumptions about the codebase
- **`nella_check_assumptions`** — Verify assumptions haven't been invalidated
- **`nella_check_dependencies`** — Detect dependency drift (package.json/lockfile changes)

## 5) Explore advanced modules

Nella Core includes advanced modules for larger agent systems:

- **Workspace registry** — multi-repo routing for agent tools.
- **Auth + rate limiting** — API key management and per-agent quotas.
- **Cloud sync** — push/pull run data from Google Cloud Storage.
- **Playground server** — real-time playground with session telemetry.

Start with the [Core Modules guide](./core/modules.md) for examples.
