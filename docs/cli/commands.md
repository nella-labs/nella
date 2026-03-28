# CLI Reference

Complete command reference for the `nella` CLI that ships with `@getnella/mcp`.

## Table of Contents

- [Commands](#commands)
  - [nella index](#nella-index)
  - [nella mcp](#nella-mcp)
  - [nella serve](#nella-serve)
  - [nella connect](#nella-connect)
  - [nella auth](#nella-auth)
  - [nella setup](#nella-setup)
  - [nella help](#nella-help)
- [Options](#options)
- [Exit Codes](#exit-codes)

---

## Commands

### `nella index`

Index the current workspace or a specific path for semantic and lexical search.

```bash
nella index [--workspace <path>] [--force] [--graph]
```

**Purpose:** Create vector embeddings and lexical indexes for hybrid codebase search.

**Requirements:** `nella index` needs a Nella login (`nella auth login`) or Azure embedding environment variables.

**Example:**
```bash
# Index current workspace
nella index

# Force full reindex
nella index --force
```

---

### `nella mcp`

Start the local stdio MCP server.

```bash
nella mcp --workspace <path>
```

**Purpose:** Run Nella as an MCP server that AI agents can connect to over stdio.

**Note:** `--workspace` is required for `nella mcp`.

**Example:**
```bash
nella mcp --workspace /path/to/project

# direct package entrypoint
npx -y @getnella/mcp --workspace /path/to/project
```

---

### `nella serve`

Start the hosted MCP server over HTTP.

```bash
nella serve [--port <number>] [--host <host>]
```

**Purpose:** Run Nella as a hosted MCP server with API key authentication and rate limiting.

**Requirements:** The current implementation requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. It uses `REDIS_URL` when available.

**Runtime defaults:** If you omit flags, the server uses `PORT` or `3000`, and binds `0.0.0.0`.

**Example:**
```bash
nella serve --port 3001 --host 127.0.0.1
```

---

### `nella connect`

Configure MCP clients to use Nella.

```bash
nella connect [--api-key <key>] [--server-url <url>] [--client <name>]
```

**Purpose:** Configure supported MCP clients in local or hosted mode.

**Supported clients:** `claude`, `claude-code`, `vscode`, `cursor`, `windsurf`, `cline`, `roo-code`, or `all`.

**Example:**
```bash
nella connect
nella connect --client claude
nella connect --mode local --client cursor -y
nella connect --mode hosted --api-key nella_your_key_here
nella connect --client vscode
```

---

### `nella auth`

Manage authentication for the hosted Nella service.

```bash
nella auth login
nella auth logout
nella auth status
```

**Purpose:** Log in, log out, or check the current session state.

---

### `nella setup`

Shortcut for a one-shot local Claude Code setup.

```bash
nella setup
```

**Purpose:** Alias for `nella connect --client claude-code --mode local -y`.

---

### `nella help`

Show the top-level help text.

```bash
nella help
```

---

## Options

| Option | Short | Description | Commands |
|--------|-------|-------------|----------|
| `--workspace <path>` | `-w` | Workspace path. Required for `mcp`; defaults to cwd for `index`. | `index`, `mcp` |
| `--graph` | | Build a dependency graph from the indexed workspace. | `index` |
| `--force` | `-f` | Force full reindex. | `index` |
| `--port <number>` | `-p` | Port for the hosted server. If omitted, the current implementation uses `PORT` or `3000`. | `serve` |
| `--host <host>` | | Host for the hosted server. If omitted, the current implementation uses `0.0.0.0`. | `serve` |
| `--api-key <key>` | `-k` | API key for hosted connection mode. | `connect` |
| `--server-url <url>` | `-u` | Hosted server URL. | `connect` |
| `--client <name>` | | Target client: `claude`, `claude-code`, `vscode`, `cursor`, `windsurf`, `cline`, `roo-code`, or `all`. | `connect` |
| `--mode <mode>` | | Connection mode: `local` or `hosted`. | `connect` |
| `--yes` | `-y` | Skip confirmation prompts. | `connect`, `setup` |
| `--help` | `-h` | Show help message. | All |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Failure |
