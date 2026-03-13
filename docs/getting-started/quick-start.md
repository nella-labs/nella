# Quick Start

Get Nella running as an MCP server in under 5 minutes.

## Step 1: Install Nella

```bash
npm install -g @getnella/mcp
```

## Step 2: Configure your MCP client

Add Nella to your AI coding agent's MCP configuration.

### Claude Desktop

Edit `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp"],
      "env": {
        "NELLA_REPO_PATH": "/path/to/your/project"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

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

Restart your MCP client after saving.

## Step 3: Verify the connection

Ask your AI agent:

> "What Nella tools are available?"

It should list tools like `nella_search`, `nella_index`, `nella_get_context`, etc.

## Step 4: Index your codebase

```bash
nella index --force
```

## Step 5: Use Nella in a conversation

Ask the agent to use Nella for code understanding:

```
You: I need to add a new API endpoint. Search the codebase for
     how existing endpoints are structured.

Claude: I'll search the codebase for endpoint patterns.
[Uses nella_search to find endpoint implementations]

Found the pattern. Let me record my assumptions...
[Uses nella_add_assumption to track what it learned]

Here's how endpoints are structured in this project...
```

## Next Steps

- [Tips & Best Practices](../guides/tips-and-best-practices.md) — Always-on Nella, prompt tips, and workflow patterns
- [MCP Tools](../mcp/tools.md) — Full reference for every tool
- [Claude Desktop](../integrations/claude-desktop.md) — Detailed Claude Desktop setup
- [Cursor](../integrations/cursor.md) — Detailed Cursor setup
