# MCP Setup

Connect Nella to your AI coding agent via the Model Context Protocol (MCP). This guide covers local stdio setups, hosted HTTP setups, and custom client wiring.

## What Is MCP?

The Model Context Protocol lets AI agents call external tools during a conversation. When connected to Nella, your agent can:

- search your indexed codebase for relevant code
- track session context, assumptions, and dependency drift
- continue Nella's trust-chain flow with heartbeat checks

## Claude Desktop

### Automatic Setup

The fastest path is:

```bash
nella connect --client claude
```

This flow writes the Claude Desktop MCP config for you and can create a hosted API key when needed.

### Manual Setup

Edit Claude Desktop's config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "--workspace", "/path/to/your/project"]
    }
  }
}
```

Restart Claude Desktop after saving.

### Verify Connection

In Claude Desktop, ask:

> "What Nella tools are available?"

You should see tools such as `nella_search`, `nella_index`, `nella_get_context`, and `nella_heartbeat`.

### Troubleshooting Claude Desktop

| Issue | Solution |
|-------|----------|
| Tools not appearing | Restart Claude Desktop. Check that `npx -y @getnella/mcp --workspace /path/to/project` runs without errors in your terminal. |
| "MCP server disconnected" | Check that Node.js 18+ is installed and accessible from Claude Desktop's default shell. |
| Permission errors | Ensure the configured `--workspace` path exists and is readable by the MCP process. |
| Slow startup | The first `npx` run downloads the package. Subsequent starts are faster. |

## Cursor

### Setup

Add Nella in Settings -> MCP Servers -> Add Server:

```json
{
  "nella": {
    "command": "npx",
    "args": ["-y", "@getnella/mcp", "--workspace", "${workspaceFolder}"]
  }
}
```

Or commit a project-local `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "--workspace", "${workspaceFolder}"]
    }
  }
}
```

### Troubleshooting Cursor

| Issue | Solution |
|-------|----------|
| Server not starting | Check Cursor's MCP panel for error messages. |
| "Command not found" | Ensure `npx` is in your PATH, or use the absolute path to `npx`. |
| Workspace path issues | Use an absolute path instead of `${workspaceFolder}` if variable substitution is not resolving. |

## VS Code

For VS Code with MCP-enabled tooling, add Nella to `.vscode/mcp.json`:

```json
{
  "servers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "--workspace", "${workspaceFolder}"]
    }
  }
}
```

## Hosted MCP Server

For team use, CI, or shared deployments, use the hosted HTTP server:

```bash
# Start the hosted server
nella serve --port 3001

# Or configure a client for hosted mode
nella connect --mode hosted
```

The hosted server provides:

- `POST /mcp` for Streamable HTTP MCP traffic
- `GET /health` for health checks
- `/ws` for the hosted WebSocket bridge
- API key authentication backed by Supabase
- Redis-backed or in-memory rate limiting

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

If you're building your own MCP client, connect to the stdio transport like this:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@getnella/mcp', '--workspace', '/path/to/repo'],
});

const client = new Client({ name: 'my-app', version: '1.0.0' });
await client.connect(transport);

const tools = await client.listTools();

const result = await client.callTool({
  name: 'nella_search',
  arguments: {
    query: 'user authentication',
  },
});
```

## Hosted Server Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SUPABASE_URL` | Supabase project URL for hosted auth and data access | Required |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key | Required |
| `REDIS_URL` | Redis connection string for shared rate limiting | Optional |
| `PORT` | Hosted MCP port | `3000` |
| `NELLA_LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) | `info` |

## Available MCP Tools

Once connected, the local MCP server exposes these tools:

| Tool | Category | Description |
|------|----------|-------------|
| `nella_index` | Indexing | Index workspace codebase for search |
| `nella_search` | Indexing | Search indexed codebase (hybrid, semantic, or lexical) |
| `nella_get_context` | Context | Get current session context |
| `nella_add_assumption` | Context | Record an assumption |
| `nella_check_assumptions` | Context | Check assumption validity |
| `nella_check_dependencies` | Context | Detect dependency drift |
| `nella_heartbeat` | Trust chain | Continue the challenge-response flow |

## Related Docs

- [MCP Tools Reference](../mcp/tools.md) — Detailed input/output schemas for every tool
- [MCP Integration Guide](../mcp/integration.md) — Advanced MCP configuration
- [Authentication](../core/auth.md) — API key management and auth flows
