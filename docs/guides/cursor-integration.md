# Cursor Integration

Set up Nella with Cursor IDE.

This guide explains how to integrate Nella with Cursor, the AI-powered code editor.

## Prerequisites

- Cursor IDE installed (version 0.40+ with MCP support)
- Node.js 18 or later

## Configuration

Cursor supports MCP servers through its settings configuration.

### Step 1: Open Cursor settings

Open Cursor and go to **Settings** (Cmd/Ctrl + ,).

Navigate to **Features** > **MCP** or search for "MCP" in settings.

### Step 2: Add Nella MCP server

Add Nella to your MCP servers configuration:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "--workspace", "/path/to/project"]
    }
  }
}
```

Replace `/path/to/project` with the absolute path to your workspace.

Alternatively, you can use the MCP configuration file at `~/.cursor/mcp.json`.

### Step 3: Reload Cursor

Reload Cursor to apply the changes. You can use **Developer: Reload Window** from the command palette.

### Step 4: Verify installation

Open Cursor's AI chat and ask:

```
What Nella tools are available?
```

## Using Nella in Cursor

Nella works seamlessly with Cursor's AI features.

### Inline Chat

When using inline chat (Cmd/Ctrl + K), Nella tools are automatically available:

```
Search the codebase for how user authentication works.
```

Cursor's AI will use `nella_search` to find relevant code.

### Composer

In Cursor's Composer mode, you can explicitly request Nella features:

```
I want to add user authentication. Please:
1. Search the codebase for existing auth patterns
2. Record your assumptions about the codebase
3. Check dependencies before making changes
```

### Chat Panel

The chat panel provides the most control over Nella usage:

```
Use nella_search to find all API endpoint definitions in this project.
```

## Project-Specific Configuration

You can create a project-specific MCP configuration by adding a `.cursor/mcp.json` file to your project:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@getnella/mcp", "-w", "${workspaceFolder}"]
    }
  }
}
```

> **Tip:** Use `${workspaceFolder}` to reference the project root in Cursor MCP configurations.

## Troubleshooting

### MCP not loading

1. Check that MCP is enabled in Cursor settings
2. Verify Node.js is in your PATH
3. Check Cursor's developer console for errors

### Tool calls failing

1. Verify the workspace path is correct
2. Check network connectivity
3. Try running the MCP server manually:

   ```bash
   npx -y @getnella/mcp --workspace /path/to/project
   ```

> **Note:** Cursor frequently updates its MCP support. Check Cursor's release notes for the latest configuration options.
