# MCP Integration Guide

How to set up and configure the Nella MCP Server with various clients.

> Status: this guide mixes current workflows with older reference material. For the maintained local setup docs, prefer [`../integrations/claude-desktop.md`](../integrations/claude-desktop.md), [`../integrations/cursor.md`](../integrations/cursor.md), and [`../cli/commands.md`](../cli/commands.md).

## Table of Contents

- [Quick Start with CLI](#quick-start-with-cli)
- [Hosted (Cloud)](#hosted-cloud)
- [Self-Hosted Server (nella serve)](#self-hosted-server-nella-serve)
- [Claude Desktop](#claude-desktop)
- [Claude Code (CLI)](#claude-code-cli)
- [Cursor](#cursor)
- [Custom MCP Clients](#custom-mcp-clients)
- [Authentication (nella auth)](#authentication-nella-auth)
- [Configuration Options](#configuration-options)
- [Troubleshooting](#troubleshooting)

---

## Quick Start with CLI

The fastest way to connect any MCP client to a self-hosted Nella server:

```bash
# 1. Start the server in the background
nella serve --port 3001

# 2. Auto-configure your MCP client
nella connect --client claude-desktop

# Or for Claude Code:
nella connect --client claude-code

# Or for Cursor:
nella connect --client cursor
```

The `nella connect` command automatically:
- Creates an API key for the client
- Generates the correct MCP configuration
- Writes it to the client's config file
- Prints the config for verification

See [CLI Commands](../cli/commands.md) for full details.

---

## Hosted (Cloud)

The easiest way to use Nella MCP — no local installation required. Connect any MCP-compatible client to the hosted server using your API key.

### Getting an API Key

1. Sign up at [getnella.dev](https://app.getnella.dev)
2. Go to **Dashboard → API Keys**
3. Click **Create New Key** and copy the `nella_...` key (shown only once)

### Connecting via Streamable HTTP

The hosted server uses the MCP Streamable HTTP transport at:

```
https://mcp.getnella.dev/mcp
```

All requests require an `Authorization: Bearer nella_...` header.

### Claude Desktop (Remote)

```json
{
  "mcpServers": {
    "nella": {
      "transport": "streamable-http",
      "url": "https://mcp.getnella.dev/mcp",
      "headers": {
        "Authorization": "Bearer nella_YOUR_API_KEY"
      }
    }
  }
}
```

### Claude Code (Remote)

```bash
claude mcp add nella --transport streamable-http \
  --url https://mcp.getnella.dev/mcp \
  --header "Authorization: Bearer nella_YOUR_API_KEY"
```

### Cursor (Remote)

Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in your project):

```json
{
  "mcpServers": {
    "nella": {
      "url": "https://mcp.getnella.dev/mcp",
      "headers": {
        "Authorization": "Bearer nella_YOUR_API_KEY"
      }
    }
  }
}
```

### Rate Limits

Each API key has configurable rate limits (set in the dashboard):

| Preset   | Per Minute | Per Hour | Per Day  |
|----------|-----------|----------|----------|
| Low      | 30        | 500      | 5,000    |
| Standard | 60        | 1,000    | 10,000   |
| High     | 120       | 2,000    | 20,000   |

When a limit is hit, the server responds with `429 Too Many Requests`.

### Health Check

```bash
curl https://mcp.getnella.dev/health
```

### Self-Hosting

You can self-host the Nella MCP server using Docker:

```bash
docker pull ghcr.io/nella-labs/nella-mcp:latest

docker run -p 3001:3001 \
  -e SUPABASE_URL=your_url \
  -e SUPABASE_SERVICE_ROLE_KEY=your_key \
  -e PORT=3001 \
  ghcr.io/nella-labs/nella-mcp:latest
```

Or use the CLI (recommended for self-hosting):

```bash
nella serve --port 3001
```

Required environment variables:
- `SUPABASE_URL` — Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key for API key validation
- `PORT` — Server port (default: 3001)
- `REDIS_URL` — (Optional) Redis connection for distributed rate limiting

---

## Self-Hosted Server (nella serve)

Run your own Nella MCP server with authentication, rate limiting, and workspace indexing.

### Starting the Server

```bash
# Basic — binds to localhost:3001
nella serve

# Custom port and host
nella serve --port 8080 --host 0.0.0.0

# With API key authentication required
nella serve --port 3001 --api-key nella_my_secret_key
```

### Server Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | MCP Streamable HTTP transport |
| `/health` | GET | Health check (returns `{ status: "ok" }`) |
| `/status` | GET | Server status and metrics |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | For cloud features | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | For cloud features | Service role key |
| `PORT` | No | Server port (default: 3001) |
| `REDIS_URL` | No | Redis for distributed rate limiting |
| `NELLA_API_KEY` | No | API key for authentication |
| `ANTHROPIC_API_KEY` | For agents | Anthropic API key |
| `AZURE_EMBEDDING_API_KEY` | For indexing | Azure OpenAI embedding API key |
| `AZURE_ENDPOINT` | For indexing | Azure OpenAI endpoint URL |

### Connecting Clients

Use `nella connect` to auto-configure MCP clients:

```bash
# Connect Claude Desktop to a running server
nella connect --client claude-desktop --server-url http://localhost:3001

# Connect Claude Code
nella connect --client claude-code --server-url http://localhost:3001

# Connect Cursor
nella connect --client cursor --server-url http://localhost:3001

# Connect with a specific API key
nella connect --client claude-desktop --api-key nella_my_key
```

### Docker Deployment

```yaml
# docker-compose.yml
services:
  nella:
    image: ghcr.io/nella-labs/nella-mcp:latest
    ports:
      - "3001:3001"
    environment:
      - PORT=3001
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

---

## Claude Desktop

### Installation

The Nella MCP Server is included in the main `@getnella/mcp` package:

```bash
# Global installation
npm install -g @getnella/mcp

# Or use the direct stdio entrypoint (downloads on first use)
npx -y @getnella/mcp --workspace /path/to/project
```

### Configuration File Location

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

### Basic Configuration

**macOS / Linux:**
```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@getnella/mcp", "--workspace", "/path/to/your/project"]
    }
  }
}
```

**Windows:**
```json
{
  "mcpServers": {
    "nella": {
      "command": "npx.cmd",
      "args": ["@getnella/mcp", "--workspace", "C:\\path\\to\\your\\project"]
    }
  }
}
```

### Using Global Installation

If you installed globally, use the direct command:

**macOS / Linux:**
```json
{
  "mcpServers": {
    "nella": {
      "command": "nella",
      "args": ["mcp", "--workspace", "/path/to/your/project"]
    }
  }
}
```

**Windows:**
```json
{
  "mcpServers": {
    "nella": {
      "command": "nella.cmd",
      "args": ["mcp", "--workspace", "C:\\path\\to\\your\\project"]
    }
  }
}
```

### Using Local Development Build

For development or testing with a local build:

```json
{
  "mcpServers": {
    "nella": {
      "command": "node",
      "args": [
        "/path/to/nella/packages/nella/dist/cli.js",
        "mcp",
        "--workspace",
        "/path/to/your/project"
      ]
    }
  }
}
```

### Multiple Workspaces

You can configure multiple Nella servers for different projects:

```json
{
  "mcpServers": {
    "nella-frontend": {
      "command": "npx",
      "args": ["@getnella/mcp", "--workspace", "/path/to/frontend"]
    },
    "nella-backend": {
      "command": "npx",
      "args": ["@getnella/mcp", "--workspace", "/path/to/backend"]
    }
  }
}
```

### Verifying Installation

After configuring, restart Claude Desktop and ask Claude:

> "What Nella tools do you have available?"

Claude should list the available tools if configured correctly.

---

## Cursor

### Configuration File Location

| Platform | Path |
|----------|------|
| macOS | `~/.cursor/mcp.json` |
| Windows | `%USERPROFILE%\.cursor\mcp.json` |
| Linux | `~/.cursor/mcp.json` |

You can also use a project-level config at `.cursor/mcp.json` in your project root.

### Basic Configuration (Local / Stdio)

**macOS / Linux:**
```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@getnella/mcp", "--workspace", "/path/to/your/project"]
    }
  }
}
```

**Windows:**
```json
{
  "mcpServers": {
    "nella": {
      "command": "npx.cmd",
      "args": ["@getnella/mcp", "--workspace", "C:\\path\\to\\your\\project"]
    }
  }
}
```

### Remote Configuration (Hosted / Self-Hosted)

```json
{
  "mcpServers": {
    "nella": {
      "url": "https://mcp.getnella.dev/mcp",
      "headers": {
        "Authorization": "Bearer nella_YOUR_API_KEY"
      }
    }
  }
}
```

### Auto-Configure with CLI

```bash
# Configure Cursor automatically
nella connect --client cursor

# With a specific API key
nella connect --client cursor --api-key nella_your_key

# Point to a self-hosted server
nella connect --client cursor --server-url http://localhost:3001
```

### Verifying Installation

After configuring, reload Cursor (**Developer: Reload Window** from the command palette) and ask the AI:

> "What Nella tools do you have available?"

---

## Claude Code (CLI)

### Configuration

Claude Code uses the same MCP configuration format. Add to your Claude Code settings:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@getnella/mcp", "--workspace", "."]
    }
  }
}
```

Using `.` as the workspace path will use the current working directory.

### Dynamic Workspace

For Claude Code, you might want the workspace to follow your current directory:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@getnella/mcp", "--workspace", "${workspaceFolder}"]
    }
  }
}
```

---

## Custom MCP Clients

### Starting the Server Programmatically

The MCP server uses stdio transport:

```typescript
import { spawn } from 'child_process';

const server = spawn('npx', ['@getnella/mcp', 'mcp', '--workspace', '/path/to/project'], {
  stdio: ['pipe', 'pipe', 'inherit']
});

// Send MCP messages via stdin
server.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list'
}) + '\n');

// Receive responses via stdout
server.stdout.on('data', (data) => {
  const response = JSON.parse(data.toString());
  console.log('Tools:', response.result.tools);
});
```

### MCP Protocol Basics

The server implements the MCP protocol over stdio:

1. **Initialize**: Exchange capabilities
2. **List Tools**: Get available tools
3. **Call Tool**: Execute a specific tool

Example tool call:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "nella_search",
    "arguments": {
      "query": "authentication middleware"
    }
  }
}
```

### Server Context

The stdio server maintains a context object:

```typescript
interface ServerContext {
  workspacePath: string;          // Configured workspace path
  contextManager: ContextManager; // Session state manager
  sessionToken?: string;          // Per-session trust token (prompt injection defense)
  hmacKey?: Buffer;               // HMAC signing key derived from session token
  challengeState?: ChallengeState; // Challenge-response state for trust chain verification
}
```

---

## Authentication (nella auth)

The `nella auth` command manages authentication for hosted and self-hosted servers.

### Login

```bash
# Interactive login (opens browser for OAuth)
nella auth login
```

Login uses a browser-based flow: the CLI starts a temporary localhost server, opens `app.getnella.dev` for authentication, and receives session tokens via redirect.

### Check Session

```bash
nella auth status
# Output:
# ✅ Authenticated
# Server: https://mcp.getnella.dev
# Key: nella_abc...xyz (masked)
# Expires: 2026-03-15T00:00:00Z
```

### Logout

```bash
nella auth logout
```

Session data is stored in `~/.nella/auth.json` (macOS/Linux) or `%APPDATA%\nella\auth.json` (Windows).

---

## Configuration Options

### Command Line Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `--workspace`, `-w` | Yes | Path to the workspace directory |

### Environment Variables

### Workspace Requirements

The workspace should have:

1. **package.json** — Required for dependency checks
2. **node_modules/** — Required (run `npm install` first)
3. **.nella/** — Created automatically for session data

---

## Troubleshooting

### Server Not Starting

**Symptom**: Claude doesn't see Nella tools

**Solutions**:
1. Check the config file path is correct for your OS
2. Verify JSON syntax is valid
3. On Windows, use `npx.cmd` instead of `npx`
4. Check the workspace path exists

**Debug**: Run the server manually to see errors:
```bash
npx -y @getnella/mcp --workspace /path/to/project
```

### Permission Errors

**Symptom**: Cannot create `.nella` directory

**Solution**: Ensure write permissions on the workspace:
```bash
chmod -R u+w /path/to/project
```

### Context Not Persisting

**Symptom**: Session data lost between conversations

**Check**: Verify `.nella/session.json` exists and is writable:
```bash
ls -la /path/to/project/.nella/
cat /path/to/project/.nella/session.json
```

### Windows Path Issues

**Symptom**: Paths not resolving correctly

**Solutions**:
1. Use forward slashes or escaped backslashes in JSON
2. Use absolute paths
3. Avoid spaces in paths (or quote them)

```json
// Good
"--workspace", "C:/Users/name/project"
"--workspace", "C:\\Users\\name\\project"

// Bad
"--workspace", "C:\Users\name\project"
```

### Debugging MCP Communication

To debug MCP messages, you can intercept stdio:

```bash
# Create a debug wrapper script
cat > debug-nella.sh << 'EOF'
#!/bin/bash
tee /tmp/nella-in.log | npx -y @getnella/mcp "$@" | tee /tmp/nella-out.log
EOF
chmod +x debug-nella.sh
```

Then use the wrapper in your config:
```json
{
  "mcpServers": {
    "nella": {
      "command": "/path/to/debug-nella.sh",
      "args": ["--workspace", "/path/to/project"]
    }
  }
}
```

---

## Best Practices

### 1. Use Absolute Paths

Always use absolute paths in configuration to avoid ambiguity:
```json
"--workspace", "/Users/name/projects/myapp"
```

### 2. One Server Per Project

Configure separate MCP servers for different projects rather than switching workspaces:
```json
{
  "mcpServers": {
    "nella-api": { ... },
    "nella-web": { ... }
  }
}
```

### 3. Run npm install First

Ensure dependencies are installed before starting the server:
```bash
cd /path/to/project && npm install
```

### 4. Check Logs on Errors

The `.nella/` directory contains logs that can help diagnose issues:
```
.nella/
├── session.json      # Current session state
```

### 5. Restart After Config Changes

After modifying `claude_desktop_config.json`, restart Claude Desktop for changes to take effect.
