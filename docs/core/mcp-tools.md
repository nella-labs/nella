# MCP Tool Handler

Use the MCP tool handler to embed Nella tools inside your own MCP server runtime.

## Key Exports

- `createMcpToolHandler` / `McpToolHandler` — handle tool calls
- `NELLA_TOOLS` — list of supported tool definitions

## Create a Handler

```ts
import {
  createMcpToolHandler,
  createWorkspaceRegistry,
  createWorkspaceSwitcher,
} from '@usenella/core';

const registry = createWorkspaceRegistry('/path/to/.nella');
const entry = registry.register('/path/to/repo', 'Repo');
const switcher = createWorkspaceSwitcher({ registry });
const workspace = await switcher.switchTo(entry.id);

const handler = createMcpToolHandler({
  workspace,
  agentId: 'agent-1',
});
```

## Handle Tool Calls

```ts
const result = await handler.handleToolCall({
  name: 'nella_check',
  arguments: { taskPath: './tasks/auth.yaml' },
});

console.log(result);
```

## Notes

- Use `handler.getTools()` if your MCP runtime needs a tool schema list.
- Attach `authenticator` and `rateLimiter` in `ToolHandlerConfig` to enforce access rules.

## Related Docs

- [Core Modules guide](./modules.md)
- [MCP integration](../mcp/integration.md)
