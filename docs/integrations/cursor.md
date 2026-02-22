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
      "args": ["-y", "@getnella/latest", "mcp"],
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
    "args": ["-y", "@getnella/latest", "mcp"],
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
Add user authentication to the API. Don't modify any test files.
```

Cursor's agent will use `nella_check` to verify constraints and `nella_validate` to run tests.

### Inline Chat

When using inline chat (Cmd/Ctrl + K), you can request Nella validation:

```
Refactor this function to use async/await. Run nella_validate when done.
```

### Composer

In Composer mode, explicitly request Nella features:

```
I want to add pagination to the users endpoint. Please:
1. Check constraints before making changes
2. Validate with tests after each modification
3. Use nella_run for the final check
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Server not starting | Check Cursor's MCP panel for error messages |
| "Command not found" | Ensure `npx` is in your PATH. Try using the full path to `npx` |
| Workspace path issues | Use absolute paths instead of `${workspaceFolder}` if variables aren't resolving |
| Tools not loading | Restart Cursor. Check that `npx @getnella/latest mcp` works in your terminal |
