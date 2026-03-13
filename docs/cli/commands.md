# CLI Reference

Complete command reference for `@getnella/mcp`.

## Table of Contents

- [Commands](#commands)
  - [nella index](#nella-index)
  - [nella mcp](#nella-mcp)
  - [nella serve](#nella-serve)
  - [nella connect](#nella-connect)
  - [nella auth](#nella-auth)
  - [nella playground](#nella-playground)
- [Options](#options)
- [Exit Codes](#exit-codes)

---

## Commands

### `nella index`

Index workspace for semantic and lexical search.

```bash
nella index [--force]
```

**Purpose:** Create vector embeddings and lexical indexes for hybrid codebase search.

**Example:**
```bash
# Index current workspace
nella index

# Force full reindex
nella index --force
```

---

### `nella mcp`

Start an MCP (Model Context Protocol) server for AI agent integration.

```bash
nella mcp [--workspace <path>]
```

**Purpose:** Run Nella as an MCP server that AI agents (Claude, GPT, etc.) can connect to.

**Example:**
```bash
# Start MCP server for current directory
nella mcp

# Start MCP server for specific workspace
nella mcp --workspace /path/to/project
nella mcp -w ./my-project
```

**MCP Tools Exposed:**
- `nella_index` — Index workspace for search
- `nella_search` — Hybrid codebase search
- `nella_get_context` — Get current session context
- `nella_add_assumption` — Record an assumption
- `nella_check_assumptions` — Validate assumptions
- `nella_check_dependencies` — Check for dependency drift

**Claude Desktop Integration:**

Add to `~/.config/Claude/claude_desktop_config.json` (macOS/Linux) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

---

### `nella serve`

Start a hosted MCP server using Streamable HTTP transport.

```bash
nella serve [--port <number>] [--host <host>]
```

**Purpose:** Run Nella as a hosted MCP server accessible over HTTP with API key authentication, rate limiting, and WebSocket support.

**Example:**
```bash
nella serve
nella serve --port 8080 --host 0.0.0.0
```

---

### `nella connect`

Configure MCP clients to use Nella's hosted server.

```bash
nella connect [--api-key <key>] [--server-url <url>] [--client <name>]
```

**Purpose:** Automatically configure Claude Desktop, VS Code, and/or Cursor to connect to the Nella MCP server.

**Example:**
```bash
nella connect
nella connect --client claude
nella connect --api-key nella_your_key_here
```

---

### `nella auth`

Manage authentication for the Nella hosted service.

```bash
nella auth login    # Open browser for authentication
nella auth logout   # Clear stored credentials
nella auth status   # Show current login state
```

---

### `nella playground`

Start the playground server with a real-time debugging dashboard.

```bash
nella playground [--workspace <path>] [--port <number>] [--host <host>]
```

**Purpose:** Launch an interactive dashboard for debugging agent sessions in real-time.

**Example:**
```bash
nella playground
nella playground --workspace /path/to/project --port 4000
```

**Dashboard:** Opens at `http://localhost:3847`

---

## Options

| Option | Short | Description | Commands |
|--------|-------|-------------|----------|
| `--workspace <path>` | `-w` | Path to workspace/project | mcp, playground |
| `--repo <path>` | `-r` | Path to repository or git URL | playground |
| `--port <number>` | `-p` | Port for HTTP server (default: 3847) | serve, playground |
| `--host <host>` | | Host for HTTP server (default: localhost) | serve, playground |
| `--api-key <key>` | `-k` | API key for connect command | connect |
| `--server-url <url>` | `-u` | Server URL for connect | connect |
| `--client <name>` | | Target MCP client: claude, vscode, cursor, all | connect |
| `--force` | `-f` | Force full reindex | index |
| `--json` | | Output as JSON | All |
| `--help` | `-h` | Show help message | All |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Failure |
