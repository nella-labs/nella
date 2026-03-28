# Cursor

Set up Nella as an MCP server for Cursor IDE.

## Prerequisites

- [Cursor](https://cursor.com) installed (version 0.40+ with MCP support)
- Node.js 18 or later

## Setup

### Option A: Project-level configuration (recommended)

Create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "--workspace", "."]
    }
  }
}
```

This pins the local MCP server to the project directory. Direct stdio/local MCP requires `--workspace`.

### Option B: Global configuration

Open Cursor: **Settings** (Cmd/Ctrl + ,) → **Features** → **MCP** → **Add Server**

```json
{
  "nella": {
    "command": "npx",
    "args": ["-y", "@getnella/mcp", "--workspace", "/absolute/path/to/project"]
  }
}
```

### Option C: Use the CLI

```bash
nella connect --client cursor
```

### Reload Cursor

After saving the configuration, reload Cursor using **Developer: Reload Window** from the command palette (Cmd/Ctrl + Shift + P).

### Verify

Open Cursor's AI chat and ask:

> "What Nella tools are available?"

## Using Nella in Cursor

### Agent Mode

In Cursor's Agent mode, Nella tools are automatically available:

```
Add user authentication to the API.
```

Cursor's agent will use `nella_search` to find relevant code and `nella_add_assumption` to record beliefs about the codebase.

### Inline Chat

When using inline chat (Cmd/Ctrl + K), you can request Nella tools:

```
Refactor this function to use async/await. Use nella_search to find all callers first.
```

### Composer

In Composer mode, explicitly request Nella features:

```
I want to add pagination to the users endpoint. Please:
1. Use nella_search to find the existing endpoint
2. Record assumptions about the codebase
3. Check dependencies haven't drifted
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Server not starting | Check Cursor's MCP panel for error messages |
| "Command not found" | Ensure `npx` is in your PATH. Try using the full path to `npx` |
| Workspace path issues | Use an absolute path instead of `.` if Cursor is not launching the server from the project root |
| Tools not loading | Restart Cursor. Check that `npx -y @getnella/mcp --workspace /path/to/project` works in your terminal |
