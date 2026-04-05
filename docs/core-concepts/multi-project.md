# Multiple Projects

Nella supports multiple workspaces, so you can work across several projects in the same IDE session.

## Setting Up Multiple Workspaces

Configure separate Nella servers for each project in your MCP client config:

```json
{
  "mcpServers": {
    "nella-frontend": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "--workspace", "/path/to/frontend"]
    },
    "nella-backend": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "--workspace", "/path/to/backend"]
    }
  }
}
```

Each workspace maintains its own:

- Search index
- Session context
- Assumptions
- Dependency snapshots

## Switching Between Projects

Your agent can call tools from any configured workspace. Each workspace is independent — changes in one don't affect the other.

To add a new project, run:

```bash
nella connect --client claude --workspace /path/to/new-project
```

## File Watching

Nella detects file changes within each workspace and can update the index automatically. This keeps search results current as you edit code across projects.
