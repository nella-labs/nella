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

It should list tools like `nella_check`, `nella_validate`, `nella_run`, etc.

## Step 4: Use Nella in a conversation

Ask the agent to make a code change and use Nella for validation:

```
You: Add a GET /hello endpoint that returns { message: "Hello, World!" }.
     Don't modify any auth files or use console.log.

Claude: I'll check constraints first.
[Uses nella_check with constraints and the planned changes]
✓ All constraints pass

[Makes changes to src/routes/hello.ts]
[Uses nella_validate to run tests and lint]
✓ Tests pass, lint clean

The endpoint has been added and validated.
```

## Step 5: Write a task definition (optional)

For repeatable validation, create a `task.yaml`:

```yaml
id: add-hello-endpoint
name: Add GET /hello endpoint
category: feature
difficulty: easy

prompt: |
  Add a GET /hello endpoint that returns { message: "Hello, World!" }.

constraints:
  - id: no-auth-changes
    description: Do not modify authentication files
    rule: Auth files must not be touched
    files_not_to_modify:
      - "src/auth/**"
  - id: no-console-log
    description: No console.log in production code
    rule: Avoid console.log statements
    forbidden_patterns:
      - "console.log"

validation:
  test: "npm test"
  lint: "npm run lint"

expected:
  files_to_modify:
    - "src/routes/hello.ts"
```

The agent can reference this task file when calling Nella tools.

## Next Steps

- [Tips & Best Practices](../guides/tips-and-best-practices.md) — Always-on Nella, prompt tips, and workflow patterns
- [MCP Tools](../mcp/tools.md) — Full reference for every tool
- [Task Authoring](../user-guide/task-authoring.md) — Write effective task definitions
- [Claude Desktop](../integrations/claude-desktop.md) — Detailed Claude Desktop setup
- [Cursor](../integrations/cursor.md) — Detailed Cursor setup
