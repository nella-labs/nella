# Core Modules Guide

This guide covers the advanced modules added to **@usenella/core** for building larger agent systems. You can import the same modules from **@usenella/nella** because that package re-exports the Core API.

## Indexing & Search (RAG)

Use the indexing stack to build hybrid (vector + lexical) search over your codebase.

```ts
import {
  createIndexManager,
  DEFAULT_INDEX_CONFIG,
} from '@usenella/core';

const index = createIndexManager({
  workspaceId: 'repo-1',
  workspacePath: '/path/to/repo',
  storagePath: '/path/to/repo/.nella/index',
  ...DEFAULT_INDEX_CONFIG,
});

await index.index();
const results = await index.search({ query: 'rate limit middleware', topK: 5 });
```

## Workspace Management

Register multiple workspaces and switch between them when serving multi-repo agents.

```ts
import {
  createWorkspaceRegistry,
  createWorkspaceSwitcher,
} from '@usenella/core';

const registry = createWorkspaceRegistry('/path/to/.nella');
const entry = registry.register('/repos/backend', 'Backend API');

const switcher = createWorkspaceSwitcher({ registry });
const workspace = await switcher.switchTo(entry.id);
```

## Authentication & Rate Limiting

Issue API keys for agents and apply per-agent rate limits.

```ts
import {
  createKeyManager,
  createAuthenticator,
  createRateLimiter,
} from '@usenella/core';

const keyManager = createKeyManager('/path/to/.nella/auth');
const authenticator = createAuthenticator('/path/to/.nella/auth');
const limiter = createRateLimiter({ requestsPerMinute: 120 });

const { rawKey } = keyManager.create({
  name: 'ci-agent',
  permissions: ['read', 'write', 'execute'],
});

const auth = authenticator.authenticate({ apiKey: rawKey, action: 'execute' });
const limit = limiter.consume({ entityId: 'ci-agent', entityType: 'agent' });
```

## Context Sharing

Share decisions, code snippets, and assumptions across agents.

```ts
import { createSharedContextManager } from '@usenella/core';

const shared = createSharedContextManager('/path/to/.nella/shared-context');
shared.set({
  key: 'auth-migration-plan',
  value: 'Migrate JWT to OAuth by Q3',
  sourceAgentId: 'architect-agent',
  workspaceId: 'repo-1',
  type: 'decision',
  visibility: 'team',
});

const recent = shared.query('repo-1', { types: ['decision'], visibility: 'team', limit: 10 });
```

## Cloud Sync (Google Cloud Storage)

Sync session data and artifacts to a GCS bucket.

```ts
import { createCloudSyncManager } from '@usenella/core';

const sync = createCloudSyncManager('repo-1', '/path/to/repo', {
  projectId: 'my-gcp-project',
  bucketName: 'nella-artifacts',
  encryptionKey: process.env.NELLA_SYNC_KEY,
});

await sync.push();
```

## Export Manager

Bundle tool calls, searches, and verification results into exportable files.

```ts
import { createExportManager } from '@usenella/core';

const exporter = createExportManager();
await exporter.export(
  {
    toolCalls: [],
    searches: [],
    verifications: [],
  },
  { format: 'markdown', outputPath: '/path/to/reports/nella-run' }
);
```

## Playground Server

Run a local playground for live sessions and usage telemetry.

```ts
import { createPlaygroundServer } from '@usenella/core';

const server = createPlaygroundServer({
  workspacePath: '/path/to/repo',
  storagePath: '/path/to/repo/.nella/playground',
  port: 3030,
});

await server.start();
```

## MCP Tool Handler

Build a custom MCP server or attach Nella tools to an existing MCP runtime.

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
});

const response = await handler.handleToolCall({
  name: 'nella_check',
  arguments: { taskPath: './tasks/auth.yaml' },
});
```

## Next Steps

- See the full [API Reference](./api-reference.md) for detailed function signatures.
- See [Context Management](./context.md) for the assumption/change tracking system.
- Use the CLI + MCP server via [packages/nella/README.md](../../packages/nella/README.md).
