# Playground Server

The playground server provides a real-time WebSocket + HTTP interface for interactive agent sessions, cost tracking, and telemetry.

## Key Exports

- `createPlaygroundServer` — start a playground server
- `DEFAULT_SERVER_CONFIG` / `DEFAULT_COST_CONFIG` — default settings

## Quick Start

```ts
import { createPlaygroundServer, DEFAULT_SERVER_CONFIG } from '@usenella/core';

const server = createPlaygroundServer({
  workspacePath: '/path/to/repo',
  storagePath: '/path/to/repo/.nella/playground',
  ...DEFAULT_SERVER_CONFIG,
});

await server.start();
console.log('Playground running');
```

## Update Cost Config

```ts
server.setCostConfig({
  inputCostPer1k: 0.002,
  outputCostPer1k: 0.004,
});
```

## Related Docs

- [Core Modules guide](./modules.md)
