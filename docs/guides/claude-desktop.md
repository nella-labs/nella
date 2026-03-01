# Claude Desktop Setup

Set up Nella with Claude Desktop.

This guide walks you through setting up Nella with Claude Desktop, Anthropic's desktop application for Claude.

## Prerequisites

- Claude Desktop installed
- Node.js 18 or later

## Configuration

Claude Desktop uses a JSON configuration file to manage MCP servers.

### Step 1: Locate the configuration file

Find the Claude Desktop configuration file:

**macOS:**

```bash
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**

```bash
%APPDATA%\Claude\claude_desktop_config.json
```

If the file doesn't exist, create it.

### Step 2: Add Nella to the configuration

Open the configuration file and add the Nella MCP server:

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

Replace `/path/to/project` with the absolute path to your workspace.

### Step 3: Restart Claude Desktop

Close and reopen Claude Desktop to load the new configuration.

### Step 4: Verify the installation

Ask Claude to verify Nella is available:

```
Can you check if Nella MCP tools are available?
```

Claude should respond with a list of available Nella tools.

## Multiple Workspaces

You can configure multiple Nella instances for different projects:

```json
{
  "mcpServers": {
    "nella-frontend": {
      "command": "npx",
      "args": ["@getnella/mcp", "-w", "/projects/frontend"]
    },
    "nella-backend": {
      "command": "npx",
      "args": ["@getnella/mcp", "-w", "/projects/backend"]
    }
  }
}
```

## Using Nella with Claude

Once configured, Claude will automatically use Nella tools when appropriate. You can also explicitly request Nella features:

### Check Constraints

```
Please use nella_check to verify my changes don't violate any constraints.
The constraints are:
- Don't modify package.json
- No console.log statements
```

### Run Validation

```
Use nella_validate to run tests and lints after making changes.
```

### Complete Workflow

```
Use nella_run to validate the complete task with constraints and tests.
```

> **Tip:** You don't need to use exact tool names. Claude understands natural language requests like "check if these changes are safe" or "run the validation workflow."

## Example Conversation

**You:** I need to refactor the authentication module to use async/await. Please make sure you don't modify any migration files or introduce console.log statements.

**Claude:** I'll help you refactor the authentication module. Let me first check the constraints...

_[Claude uses nella_should_refuse to check if the task is safe]_

The task is safe to proceed. Now let me make the changes...

_[Claude edits files and uses nella_validate to verify]_

All validations passed! Here's a summary of what I changed:

- Converted callback-based auth to async/await
- Updated 3 files: auth.ts, auth.utils.ts, auth.test.ts
- All tests pass

## Common Workflows

### Pre-flight Check

1. `nella_should_refuse` — Check if task is safe
2. `nella_check_prerequisites` — Verify project setup
3. `nella_get_context` — See what's already been done

### Making Changes

1. `nella_add_assumption` — Record assumptions
2. Make code changes
3. `nella_record_change` — Track what was changed
4. `nella_validate` — Run tests

### Final Validation

1. `nella_check_assumptions` — Verify assumptions still valid
2. `nella_check_dependencies` — Check for drift
3. `nella_run` — Full validation with metrics

## Troubleshooting

### Nella tools not appearing

1. Verify the configuration file is valid JSON
2. Check that the workspace path is correct
3. Restart Claude Desktop completely
4. Check the Claude Desktop logs for errors

### Connection errors

1. Ensure Node.js is installed and in your PATH
2. Try running `npx @getnella/mcp mcp -w /path/to/project` manually to check for errors
3. Verify the workspace path exists

### Path issues on Windows

Use forward slashes or escaped backslashes in paths:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@getnella/mcp", "-w", "C:/path/to/project"]
    }
  }
}
```
