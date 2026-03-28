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
      "args": ["-y", "@getnella/mcp", "--workspace", "/path/to/project"]
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

### Search Codebase

```
Use nella_search to find how authentication is implemented in this project.
```

### Track Assumptions

```
Use nella_add_assumption to record that the User model has id, name, and email fields.
```

### Check Dependencies

```
Use nella_check_dependencies to see if any packages have changed.
```

> **Tip:** You don't need to use exact tool names. Claude understands natural language requests like "search the codebase for auth middleware" or "check if my assumptions are still valid."

## Example Conversation

**You:** I need to refactor the authentication module to use async/await.

**Claude:** I'll help you refactor the authentication module. Let me first search the codebase for the current implementation...

_[Claude uses nella_search to find auth-related code]_

Found the auth module. Let me record some assumptions before making changes...

_[Claude uses nella_add_assumption to track assumptions]_

Now let me make the changes and verify assumptions are still valid...

_[Claude uses nella_check_assumptions to verify]_

All assumptions are still valid! Here's a summary of what I changed.

## Troubleshooting

### Nella tools not appearing

1. Verify the configuration file is valid JSON
2. Check that the workspace path is correct
3. Restart Claude Desktop completely
4. Check the Claude Desktop logs for errors

### Connection errors

1. Ensure Node.js is installed and in your PATH
2. Try running `npx -y @getnella/mcp --workspace /path/to/project` manually to check for errors
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
