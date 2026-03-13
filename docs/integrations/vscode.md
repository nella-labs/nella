# VS Code

Set up Nella as an MCP server for VS Code with GitHub Copilot.

## Prerequisites

- VS Code with GitHub Copilot extension
- Node.js 18 or later

## Setup

Add a `.vscode/mcp.json` file to your project:

```json
{
  "servers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp"],
      "env": {
        "NELLA_REPO_PATH": "${workspaceFolder}"
      }
    }
  }
}
```

Reload VS Code after saving.

## Usage

With the MCP server configured, Copilot's agent mode can call Nella tools during conversations. Ask Copilot to search the codebase, track assumptions, or check dependencies — it will use the appropriate Nella tool automatically.

```
@workspace Add a health check endpoint. Use nella_search to find existing endpoint patterns first.
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Tools not available | Ensure you're using Copilot in agent mode, not inline completions |
| Server not starting | Verify `npx @getnella/mcp mcp` runs without errors in your terminal |
| Path issues | Use absolute paths if `${workspaceFolder}` doesn't resolve correctly |
