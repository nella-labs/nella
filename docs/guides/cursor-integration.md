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
      "args": ["@getnella/latest", "mcp", "--workspace", "/path/to/project"]
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
Refactor this function to use async/await. Don't modify any test files.
```

Cursor's AI will use Nella to check constraints and validate changes.

### Composer

In Cursor's Composer mode, you can explicitly request Nella features:

```
I want to add user authentication. Please:
1. Check constraints before making changes
2. Run tests after each file modification
3. Use nella_run for the complete workflow
```

### Chat Panel

The chat panel provides the most control over Nella usage:

```
Use nella_detect_risks to analyze this code for security issues:

[paste code here]
```

## Project-Specific Configuration

You can create a project-specific MCP configuration by adding a `.cursor/mcp.json` file to your project:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@getnella/latest", "mcp", "-w", "${workspaceFolder}"]
    }
  }
}
```

> **Tip:** Use `${workspaceFolder}` to reference the project root in Cursor MCP configurations.

## Recommended Workflows

### Feature Development

1. Start with constraints:

   ```
   Add a new feature for user profiles. Constraints:
   - Don't modify auth files
   - No changes to database migrations
   - All new files should have tests
   ```

2. Cursor uses `nella_check` throughout development

3. Final validation:

   ```
   Use nella_run to validate the complete feature.
   ```

### Bug Fixes

1. Describe the fix:

   ```
   Fix the login timeout issue. Run tests after each change.
   ```

2. Cursor uses `nella_validate` after modifications

### Code Review

1. Analyze existing code:

   ```
   Use nella_detect_risks to review this pull request diff:
   [paste diff]
   ```

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
   npx @getnella/latest mcp -w /path/to/project
   ```

### Slow responses

1. Nella tools add some latency for validation
2. Consider using targeted tests instead of full suites
3. Use `nella_check` for quick feedback, `nella_run` for complete validation

> **Note:** Cursor frequently updates its MCP support. Check Cursor's release notes for the latest configuration options.
