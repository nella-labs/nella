# Playground

The Playground module provides an interactive web-based UI for testing Nella MCP tools, browsing indexed code, and exploring context state.

## Key Exports

- `createPlaygroundServer` / `PlaygroundServer` — start the playground HTTP + WebSocket server

## Quick Start

```ts
import { createPlaygroundServer } from '@usenella/core';

const server = createPlaygroundServer({
  port: 4000,
  workspace: '/path/to/project',
});

await server.start();
console.log('Playground running at http://localhost:4000');
```

Or via CLI:

```bash
nella playground --port 4000 --workspace ./my-project
```

## Features

The playground provides:

- **Chat Interface** — Invoke MCP tools using a chat-like UI with tool response rendering
- **Workspace Browser** — Browse and search files in the indexed workspace
- **Context Viewer** — View session context (changes, assumptions, dependencies) and shared context (cross-agent entries)
- **Tool Explorer** — Browse all available MCP tools with parameter schemas
- **Real-Time Updates** — WebSocket connection for live tool responses

## WebSocket Protocol

The playground uses WebSocket for real-time communication:

```ts
// Client → Server: invoke a tool
ws.send(JSON.stringify({
  type: 'tool_call',
  id: 'msg-1',
  tool: 'nella_get_context',
  arguments: {},
}));

// Server → Client: tool result
// { type: 'tool_result', id: 'msg-1', content: '## Session Context...' }

// Server → Client: context update
// { type: 'context_update', data: { changes: [...], assumptions: [...] } }
```

## Configuration

```ts
interface PlaygroundOptions {
  port?: number;             // Default: 4000
  host?: string;             // Default: 'localhost'
  workspace?: string;        // Workspace path
  open?: boolean;            // Auto-open browser (default: true)
}
```

## Session Management

```ts
// Sessions track playground interactions
interface PlaygroundSession {
  id: string;
  startedAt: Date;
  workspace: string;
  messages: PlaygroundMessage[];
}

interface PlaygroundMessage {
  id: string;
  role: 'user' | 'tool';
  tool?: string;
  content: string;
  timestamp: Date;
}
```

## Related Docs

- [CLI Commands](../cli/commands.md) — `nella playground` command
- [Agent Runner](agents.md) — Running agents programmatically
- [MCP Tools](../mcp/tools.md) — All available tools
