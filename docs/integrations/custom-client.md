# Custom MCP Client

Connect Nella to any MCP-compatible client or build your own integration.

## Stdio Transport

Nella's MCP server uses the stdio transport by default. Any MCP client that supports stdio can connect:

```bash
npx @getnella/mcp mcp
```

The server communicates over stdin/stdout using the MCP protocol.

## Programmatic Connection

Connect to Nella from a TypeScript/JavaScript application:

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
console.log(tools);

// Call a tool
const result = await client.callTool({
  name: 'nella_check',
  arguments: {
    constraints: [
      {
        id: 'no-console',
        description: 'No console.log',
        forbiddenPatterns: ['console.log'],
      },
    ],
    modifiedFiles: ['src/index.ts'],
    diff: '+ console.log("debug")',
  },
});

console.log(result);
```

## Hosted Server (HTTP)

For team use or CI/CD, run Nella as an HTTP server:

```bash
nella serve --port 3001
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

The hosted server supports:
- Multi-tenant access with API key authentication
- Rate limiting per key
- Health endpoint for load balancer probes

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NELLA_REPO_PATH` | Path to the project being validated | Current directory |
| `NELLA_API_KEY` | API key for hosted server auth | None |
| `NELLA_LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) | `info` |

## Available Tools

Once connected, the client can call any of Nella's MCP tools:

| Tool | Description |
|------|-------------|
| `nella_check` | Validate constraints against file changes |
| `nella_validate` | Run test/lint/compile commands |
| `nella_run` | Full validation pipeline |
| `nella_detect_risks` | Scan for dangerous patterns |
| `nella_should_refuse` | Pre-flight refusal check |
| `nella_check_prerequisites` | Verify project setup |
| `nella_get_context` | Get session context |
| `nella_add_assumption` | Record an assumption |
| `nella_check_assumptions` | Check assumption validity |
| `nella_get_file_history` | Get file change history |
| `nella_check_dependencies` | Detect dependency drift |
| `nella_record_change` | Record a change manually |

See the [MCP Tools Reference](../mcp/tools.md) for full input/output schemas.
