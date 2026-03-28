# Custom MCP Client

Connect Nella to any MCP-compatible client or build your own integration.

## Stdio Transport

Nella's MCP server uses the stdio transport by default. Any MCP client that supports stdio can connect:

```bash
npx -y @getnella/mcp --workspace /path/to/repo
```

The server communicates over stdin/stdout using the MCP protocol.

## Programmatic Connection

Connect to Nella from a TypeScript/JavaScript application:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@getnella/mcp', '--workspace', '/path/to/repo'],
});

const client = new Client({ name: 'my-app', version: '1.0.0' });
await client.connect(transport);

// List available tools
const tools = await client.listTools();
console.log(tools);

// Call a tool
const result = await client.callTool({
  name: 'nella_search',
  arguments: {
    query: 'authentication middleware',
  },
});

console.log(result);
```

## Hosted Server (HTTP)

For team use or CI/CD, run Nella as an HTTP server:

```bash
nella serve --port 3001 --host 127.0.0.1
```

Connect via Streamable HTTP transport:

```json
{
  "mcpServers": {
    "nella": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer nella_abc123..."
      }
    }
  }
}
```

The current local `nella serve` implementation requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and uses `REDIS_URL` when available. If you omit flags, it uses `PORT` or `3000` and binds `0.0.0.0`.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SUPABASE_URL` | Supabase project URL for hosted mode | None |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key for hosted mode | None |
| `REDIS_URL` | Optional Redis URL for hosted-mode rate limiting | None |
| `PORT` | Hosted server port when `--port` is omitted | `3000` |
| `NELLA_LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) | `info` |

## Available Tools

Local stdio connections expose the workspace tools below:

| Tool | Description |
|------|-------------|
| `nella_index` | Index a workspace directory |
| `nella_search` | Hybrid semantic + lexical codebase search |
| `nella_get_context` | Get session context |
| `nella_add_assumption` | Record an assumption |
| `nella_check_assumptions` | Check assumption validity |
| `nella_check_dependencies` | Detect dependency drift |
| `nella_heartbeat` | Verify trust-chain continuity between tool calls |

See the [MCP Tools Reference](../mcp/tools.md) for full input/output schemas.
