# Installation & Setup

Install Nella and connect it to your AI coding agent in under 5 minutes.

## Prerequisites

- Node.js 18 or later

## Install

```bash
# npm
npm install -g @getnella/mcp

# pnpm  
pnpm add -g @getnella/mcp

# yarn
yarn global add @getnella/mcp
```

Verify the installation:

```bash
nella help
```

## Connect to Your Client

### Claude Desktop

**Option A: Automatic**

```bash
nella connect --client claude
```

**Option B: Manual**

Add to your `claude_desktop_config.json`:

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

### Claude Code

```bash
nella connect --client claude-code
```

Or use `nella setup` for a one-shot configuration.

### Cursor

**Option A: Automatic**

```bash
nella connect --client cursor
```

**Option B: Manual**

Create `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "--workspace", "."]
    }
  }
}
```

### VS Code

**Option A: Automatic**

```bash
nella connect --client vscode
```

**Option B: Manual**

Create `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "--workspace", "."]
    }
  }
}
```

### Windsurf

```bash
nella connect --client windsurf
```

### Other MCP Clients

Connect programmatically via stdio transport:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@getnella/mcp', '--workspace', '/path/to/project'],
});

const client = new Client({ name: 'my-client', version: '1.0.0' }, {});
await client.connect(transport);
```

## Authentication

```bash
nella auth login    # Opens browser to sign in
nella auth status   # Check your session
nella auth logout   # Sign out
```

> **Note:** Authentication is optional for local use. Sign in to access hosted features like cloud sync and team sharing.

## Verify

Ask your agent: *"What Nella tools are available?"*

If all 7 tools appear, you're ready to go.
