# MCP Setup

Connect Nella to your AI coding agent via the Model Context Protocol (MCP). This guide covers setup for Claude Desktop, Cursor, VS Code, and custom MCP clients.

## What is MCP?

The Model Context Protocol lets AI agents call external tools during a conversation. When connected to Nella's MCP server, your agent can:

- Check constraints and validate code changes
- Detect dangerous patterns and decide whether to refuse
- Track session context, assumptions, and dependencies
- Search your indexed codebase for relevant code

## Claude Desktop

### Automatic Setup

The fastest way to connect:

```bash
nella connect
```

This command:
1. Authenticates with your Nella account (opens browser if needed)
2. Creates an API key
3. Writes the MCP configuration to Claude Desktop's config file
4. Verifies the connection

### Manual Setup

Edit Claude Desktop's config file:

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

Restart Claude Desktop after saving.

### Verify Connection

In Claude Desktop, you should see Nella's tools listed in the tool picker. Ask Claude:

> "What Nella tools are available?"

It should list tools like `nella_check`, `nella_validate`, `nella_run`, etc.

### Troubleshooting Claude Desktop

| Issue | Solution |
|-------|----------|
| Tools not appearing | Restart Claude Desktop. Check that `npx @getnella/mcp mcp` runs without errors in your terminal |
| "MCP server disconnected" | Check that Node.js 18+ is installed and accessible from the default shell |
| Permission errors | Ensure `NELLA_REPO_PATH` points to a directory you have read access to |
| Slow startup | First run downloads the package. Subsequent starts are faster |

## Cursor

### Setup

Add Nella to Cursor's MCP configuration:

**Settings → MCP Servers → Add Server**

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

Or edit `.cursor/mcp.json` in your project root:

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

### Troubleshooting Cursor

| Issue | Solution |
|-------|----------|
| Server not starting | Check Cursor's MCP panel for error messages |
| "Command not found" | Ensure `npx` is in your PATH. Try using the full path to `npx` |
| Workspace path issues | Use absolute paths instead of `${workspaceFolder}` if variables aren't resolving |

## VS Code (Copilot)

For VS Code with GitHub Copilot, add to `.vscode/mcp.json`:

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

## Hosted MCP Server

For cloud-hosted deployments (team use, CI/CD), use the hosted variant:

```bash
# Start the hosted server
nella serve --port 3001

# Or connect to Nella's cloud-hosted server
nella connect --hosted
```

The hosted server uses Streamable HTTP instead of stdio, enabling:
- Multi-tenant access with API key authentication
- Rate limiting per key and per agent
- WebSocket support for real-time updates
- Health endpoint for load balancer probes

### Connecting to a Hosted Server

```json
{
  "mcpServers": {
    "nella": {
      "url": "https://mcp.getnella.dev/mcp",
      "headers": {
        "Authorization": "Bearer nella_abc123..."
      }
    }
  }
}
```

## Custom MCP Clients

If you're building your own MCP client, connect to the stdio transport:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@getnella/mcp', 'mcp'],
  env: { NELLA_REPO_PATH: '/path/to/repo' },
});

const client = new Client({ name: 'my-app', version: '1.0.0' });
await client.connect(transport);

// List available tools
const tools = await client.listTools();

// Call a tool
const result = await client.callTool({
  name: 'nella_check',
  arguments: {
    task_yaml_path: './tasks/my-task.yaml',
    repo_path: '/path/to/repo',
  },
});
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NELLA_REPO_PATH` | Path to the project being validated | Current directory |
| `NELLA_API_KEY` | API key for hosted server auth | None |
| `NELLA_LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) | `info` |

## Available MCP Tools

Once connected, these tools are available to the agent:

| Tool | Category | Description |
|------|----------|-------------|
| `nella_check` | Validation | Check constraints against file changes |
| `nella_validate` | Validation | Run test/lint/compile commands |
| `nella_run` | Validation | Full validation pipeline |
| `nella_detect_risks` | Safety | Scan for dangerous patterns |
| `nella_should_refuse` | Safety | Decide whether to refuse a task |
| `nella_check_prerequisites` | Safety | Verify project prerequisites |
| `nella_get_context` | Context | Get current session context |
| `nella_add_assumption` | Context | Record an assumption |
| `nella_check_assumptions` | Context | Check assumption validity |
| `nella_get_file_history` | Context | Get file change history |
| `nella_check_dependencies` | Context | Detect dependency drift |
| `nella_record_change` | Context | Manually record a change |

## Related Docs

- [MCP Tools Reference](../mcp/tools.md) — Detailed input/output schemas for every tool
- [MCP Integration Guide](../mcp/integration.md) — Advanced MCP configuration
- [Authentication](../core/auth.md) — API key management and auth flows
