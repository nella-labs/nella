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
      "args": ["-y", "@getnella/mcp"],
      "env": {
        "NELLA_REPO_PATH": "."
      }
    }
  }
}
```

This ensures everyone on your team uses Nella when working in the project.

### Option B: Global configuration

Open Cursor: **Settings** (Cmd/Ctrl + ,) → **Features** → **MCP** → **Add Server**

```json
{
  "nella": {
    "command": "npx",
    "args": ["-y", "@getnella/mcp"],
    "env": {
      "NELLA_REPO_PATH": "${workspaceFolder}"
    }
  }
}
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
| Workspace path issues | Use absolute paths instead of `${workspaceFolder}` if variables aren't resolving |
| Tools not loading | Restart Cursor. Check that `npx @getnella/mcp mcp` works in your terminal |
