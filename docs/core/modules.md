# Core Modules Guide

This guide covers all modules in **@usenella/core**. You can import the same modules from **@getnella/mcp** because that package re-exports the Core API.

## Table of Contents

- [Indexing & Search (RAG)](#indexing--search-rag)
- [Workspace Management](#workspace-management)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Context Sharing](#context-sharing)
- [Sync](#sync)
- [Playground Server](#playground-server)
- [Agent Runner](#agent-runner)
- [MCP Tool Handler](#mcp-tool-handler)
- [GCP Backend](#gcp-backend)
- [Supabase Backend](#supabase-backend)

---

## Indexing & Search (RAG)

Use the indexing stack to build hybrid (vector + lexical) search over your codebase, then verify generated code against it.

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

// Index the workspace (incremental — skips unchanged files)
await index.index();

// Hybrid search (vector + lexical with RRF fusion)
const results = await index.search({
  query: 'rate limit middleware',
  topK: 5,
  filter: { filePatterns: ['src/**/*.ts'] }
});

// Verify generated code against the index
const verification = await index.verify({
  code: agentGeneratedCode,
  filePath: 'src/middleware/rateLimit.ts',
  checkImports: true,
  checkSymbols: true,
  checkAPIs: true
});

console.log(verification.issues); // Missing imports, wrong signatures, etc.
```

### Components

| Class | Role |
|-------|------|
| `IndexManager` | Orchestrates incremental indexing and search |
| `Chunker` | AST-based code chunking that respects function/class boundaries |
| `Embedder` | Generates embeddings via Voyage-code-2, OpenAI, or local ONNX |
| `VectorStore` | In-memory vector store with JSON persistence |
| `LexicalIndex` | BM25-based keyword search index |
| `HybridSearcher` | RRF fusion (default: 0.4 vector / 0.6 lexical, k=60) |
| `CodeVerifier` | Verifies imports, symbols, and API signatures against index |

### Configuration

```ts
const DEFAULT_INDEX_CONFIG = {
  embedder: 'voyage-code-2',     // 'voyage-code-2' | 'openai' | 'local'
  dimensions: 1536,
  chunkStrategy: 'ast',
  hybridWeights: { vector: 0.4, lexical: 0.6 },
  fusionK: 60,
  reranker: 'cohere'
};
```

---

## Workspace Management

Register multiple workspaces and switch between them for multi-repo agents.

```ts
import {
  WorkspaceRegistry,
  Workspace,
  WorkspaceSwitcher,
  FileLock,
  RegistryBackupManager,
  RegistryMigrationManager,
  WorkspaceValidator,
  FileWatcher,
} from '@usenella/core';
```

### Basic Usage

```ts
import {
  createWorkspaceRegistry,
  createWorkspaceSwitcher,
} from '@usenella/core';

const registry = createWorkspaceRegistry('/path/to/.nella');

// Register workspaces
const backend = registry.register('/repos/backend', 'Backend API');
const frontend = registry.register('/repos/frontend', 'Frontend App');

// List all
const all = registry.list(); // [backend, frontend]

// Switch active workspace
const switcher = createWorkspaceSwitcher({ registry });
const workspace = await switcher.switchTo(backend.id);
```

### File Watching

```ts
const watcher = new FileWatcher('/path/to/repo', {
  debounceMs: 500,
  ignore: ['**/node_modules/**', '**/.git/**']
});

watcher.on('change', (files) => {
  console.log('Files changed:', files);
  // Trigger re-indexing
});

watcher.start();
```

### Backup & Migration

```ts
// Auto-backup registry
const backup = new RegistryBackupManager(registry);
await backup.create(); // Creates timestamped backup
await backup.restore('2026-02-08T12:00:00'); // Restore from backup

// Migrate registry schema across versions
const migration = new RegistryMigrationManager(registry);
await migration.migrate();
```

### Validation

```ts
const validator = new WorkspaceValidator(registry);
const results = validator.validate();
// Checks: paths exist, no duplicates, config integrity
```

### Concurrency

```ts
const lock = new FileLock('/path/to/.nella/lock');
await lock.acquire();
try {
  // Safe file operations
} finally {
  lock.release();
}
```

---

## Authentication

Issue API keys for agents and manage access control.

```ts
import {
  KeyManager,
  AgentManager,
  Authenticator,
  TokenManager,
  AuditLogManager,
  IPFilter,
  RequestSigner,
} from '@usenella/core';
```

### API Key Management

```ts
import { createKeyManager, createAuthenticator } from '@usenella/core';

const keyManager = createKeyManager('/path/to/.nella/auth');

// Create a key with specific permissions
const { rawKey } = keyManager.create({
  name: 'ci-agent',
  permissions: ['read', 'write', 'execute'],
  rateLimit: { maxRequests: 1000, windowMs: 60000 },
  expiresAt: new Date('2026-12-31')
});

// Authenticate a request
const authenticator = createAuthenticator('/path/to/.nella/auth');
const auth = authenticator.authenticate({
  apiKey: rawKey,
  action: 'execute'
});

if (!auth.authenticated) {
  console.log('Denied:', auth.reason);
}
```

### Agent Management

```ts
const agentManager = new AgentManager(store);

const agent = await agentManager.register({
  name: 'my-claude',
  type: 'cursor',  // 'copilot' | 'cursor' | 'cline' | 'aider' | 'continue' | 'custom'
  apiKeyId: key.id
});

const agents = await agentManager.list();
```

### JWT Tokens

```ts
const tokenManager = new TokenManager(process.env.JWT_SECRET);

const token = tokenManager.create({
  userId: '123',
  permissions: ['read', 'write']
});

const payload = tokenManager.verify(token);
```

### Audit Logging

```ts
const audit = new AuditLogManager(store);

audit.log({
  action: 'key.created',
  userId: '123',
  details: { keyName: 'ci-agent' }
});

const entries = await audit.query({
  action: 'key.created',
  since: new Date('2026-01-01'),
  limit: 50
});
```

### IP Filtering & Request Signing

```ts
// IP-based access control
const filter = new IPFilter({
  allowList: ['192.168.1.0/24', '10.0.0.0/8'],
  denyList: ['10.0.0.1']
});
const allowed = filter.check('192.168.1.100'); // true

// HMAC request signing
const signer = new RequestSigner(process.env.SIGNING_SECRET);
const signature = signer.sign({ method: 'POST', path: '/api/validate', body });
const valid = signer.verify(request, signature);
```

---

## Rate Limiting

Apply per-agent rate limits with pluggable backends and algorithms.

```ts
import {
  RateLimiter,
  MemoryBackend,
  RedisBackend,
  SQLiteBackend,
  SlidingWindowAlgorithm,
  TokenBucketAlgorithm,
  PriorityHandler,
  DynamicLimitAdjuster,
} from '@usenella/core';
```

### Basic Usage

```ts
import { createRateLimiter } from '@usenella/core';

// Simple in-memory limiter
const limiter = createRateLimiter({ requestsPerMinute: 120 });
const result = limiter.consume({ entityId: 'ci-agent', entityType: 'agent' });

if (!result.allowed) {
  console.log('Rate limited. Retry after:', result.retryAfterMs, 'ms');
}
```

### Redis Backend (Production)

```ts
const limiter = new RateLimiter({
  backend: new RedisBackend('redis://localhost:6379'),
  algorithm: new TokenBucketAlgorithm({
    refillRate: 10,    // 10 tokens per second
    capacity: 100      // Max 100 tokens
  }),
  maxRequests: 1000,
  windowMs: 60000
});
```

### SQLite Backend (Single-Server)

```ts
const limiter = new RateLimiter({
  backend: new SQLiteBackend('/path/to/.nella/ratelimit.db'),
  algorithm: new SlidingWindowAlgorithm(),
  maxRequests: 500,
  windowMs: 60000
});
```

### Priority Handling

```ts
const handler = new PriorityHandler(limiter);

// Critical requests bypass normal limits
await handler.handle(request, 'critical');

// Low-priority requests are throttled first
await handler.handle(request, 'low');

// Priority levels: 'critical' | 'high' | 'normal' | 'low'
```

### Dynamic Limit Adjustment

```ts
const adjuster = new DynamicLimitAdjuster(limiter, {
  degradation: {
    enabled: true,
    thresholds: [
      { load: 0.8, reduction: 0.2 },   // At 80% load → reduce limits by 20%
      { load: 0.95, reduction: 0.5 }    // At 95% load → reduce limits by 50%
    ]
  }
});

// Automatically adjusts limits based on system load
await adjuster.adjust();
```

---

## Context Sharing

Share decisions, code snippets, and assumptions across agents.

```ts
import {
  SharedContextManager,
  LocalTransport,
  SupabaseTransport,
} from '@usenella/core';
```

### Basic Usage

```ts
import { createSharedContextManager } from '@usenella/core';

const shared = createSharedContextManager('/path/to/.nella/shared-context');

// Share a decision
shared.set({
  key: 'auth-migration-plan',
  value: 'Migrate JWT to OAuth by Q3',
  sourceAgentId: 'architect-agent',
  workspaceId: 'repo-1',
  type: 'decision',
  visibility: 'workspace',
  channel: 'architecture'
});

// Query shared context
const recent = shared.query('repo-1', {
  types: ['decision'],
  visibility: 'workspace',
  channel: 'architecture',
  limit: 10
});
```

### Context Types & Visibility

**Types:** `decision`, `snippet`, `schema`, `api`, `config`, `dependency`, `test`, `error`, `note`, `reference`

**Visibility:** `private` (creator only), `workspace` (all agents in workspace), `shared` (explicitly shared), `global` (all agents)

### Channels

Group context entries by topic:

```ts
shared.set({
  key: 'db-schema-v2',
  value: { /* schema data */ },
  type: 'schema',
  channel: 'database',
  visibility: 'workspace'
});

// Get all entries in the database channel
const dbContext = shared.query('repo-1', { channel: 'database' });
```

### Transports

| Transport | Description |
|-----------|-------------|
| `LocalTransport` | File-based storage, no network required |
| `SupabaseTransport` | Supabase-backed with real-time sync across agents |

```ts
// Supabase transport for real-time sharing
const shared = new SharedContextManager({
  transport: new SupabaseTransport({
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY
  }),
  encryption: true
});
```

### Versioning & Conflict Detection

Context entries include `etag` for optimistic concurrency:

```ts
const entry = await shared.get('auth-approach');
// entry.etag = 'abc123'

await shared.set({
  key: 'auth-approach',
  value: updatedValue,
  etag: entry.etag  // Will fail if changed since read
});
```

---

## Sync

Sync workspace data across tiers with auto-fallback: local → Supabase → GCP.

```ts
import {
  SyncManager,
  LocalSyncAdapter,
  SupabaseSyncAdapter,
  GCPSyncAdapter,
  WorkspaceCloudSyncManager,
} from '@usenella/core';
```

### Basic Usage

```ts
const sync = new SyncManager();
await sync.init({
  tier: 'gcp',
  cloudStorageConfig: {
    bucket: 'nella-artifacts',
    projectId: 'my-gcp-project',
  },
  cloudSync: {
    conflictResolution: 'merge',
    include: ['**/*'],
    exclude: ['**/node_modules/**', '**/.git/**'],
  },
});

await sync.createCloudSync('repo-1', '/path/to/repo', {
  compression: true,
  bandwidthLimitKBps: 512,
});

await sync.syncWorkspace('repo-1');
const state = sync.getCloudSyncState('repo-1');
```

### Cloud Sync Features

| Feature | Description |
|---------|-------------|
| Delta chunking | Only sync changed blocks, not entire files |
| AES-256-GCM encryption | End-to-end encryption at rest |
| Gzip compression | Bandwidth-optimized transfers |
| Bandwidth throttling | Configurable throughput limits |
| Offline queue | Queue operations when disconnected |
| Conflict resolution | `last-write-wins`, `merge`, `manual`, `server-wins` |

### Sync Tiers

| Tier | Adapter | Use Case |
|------|---------|----------|
| `local` | `LocalSyncAdapter` | Development, no setup required |
| `supabase` | `SupabaseSyncAdapter` | Cloud sync with real-time, team collaboration |
| `gcp` | `GCPSyncAdapter` | Enterprise deployments, Cloud SQL + Cloud Storage |

> **Deprecation Notice:** `createCloudSyncManager(...)` from `cloud-sync/` is deprecated. Use `SyncManager` from the `sync/` module instead.

---

## Playground Server

Run a local playground for live sessions, chain-of-thought visualization, and cost tracking.

```ts
import { createPlaygroundServer } from '@usenella/core';

const server = createPlaygroundServer({
  workspacePath: '/path/to/repo',
  storagePath: '/path/to/repo/.nella/playground',
  port: 3847,
});

await server.start();
// Dashboard: http://localhost:3847
// WebSocket:  ws://localhost:3847/ws
```

### Features

- **Real-time session tracking** — Live view of active agent sessions
- **Chain-of-thought visualization** — See the agent's reasoning process
- **Tool call history** — Every MCP tool call with timing and results
- **Token usage & cost tracking** — Real-time cost estimation per session
- **HTML dashboard** — Built-in web UI at the server root

### WebSocket Protocol

Connect to `ws://localhost:3847/ws` to receive real-time events:

```ts
const ws = new WebSocket('ws://localhost:3847/ws');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  // message.type: 'session-start' | 'tool-call' | 'tool-result' |
  //               'chain-of-thought' | 'cost-update' | 'session-end'
  console.log(message.type, message.data);
};
```

---

## Agent Runner

Built-in LLM agent runner with multi-turn tool-use loops.

```ts
import {
  AgentRunner,
  AnthropicAdapter,
  OpenAIAdapter,
  createAgentAdapter,
  MODEL_PRICING,
} from '@usenella/core';
```

### Basic Usage

```ts
const adapter = createAgentAdapter({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const runner = new AgentRunner(adapter, {
  maxIterations: 10,
  tools: nellaTools
});

const result = await runner.run({
  prompt: 'Add a GET /users/:id endpoint',
  systemPrompt: 'You are a senior TypeScript developer.'
});

console.log('Response:', result.response);
console.log('Tool calls:', result.toolCalls.length);
console.log('Iterations:', result.iterations);
console.log('Tokens:', result.tokenUsage);
console.log('Cost: $' + result.cost.toFixed(4));
```

### Cost Estimation

```ts
import { MODEL_PRICING, estimateAgentCost } from '@usenella/core';

// Get pricing for a model
const pricing = MODEL_PRICING['claude-sonnet-4-20250514'];
// { inputPer1k: 0.003, outputPer1k: 0.015 }

// Estimate cost for a run
const cost = estimateAgentCost({
  model: 'gpt-4o',
  inputTokens: 5000,
  outputTokens: 2000
});
```

### Supported Models

| Model | Provider | Input $/1K | Output $/1K |
|-------|----------|-----------|------------|
| `claude-sonnet-4-20250514` | Anthropic | 0.003 | 0.015 |
| `claude-opus-4-20250514` | Anthropic | 0.015 | 0.075 |
| `gpt-4-turbo` | OpenAI | 0.01 | 0.03 |
| `gpt-4o` | OpenAI | 0.005 | 0.015 |
| `gpt-4o-mini` | OpenAI | 0.00015 | 0.0006 |

---

## MCP Tool Handler

Build a custom MCP server or attach Nella tools to an existing MCP runtime.

```ts
import {
  createMcpToolHandler,
  NELLA_TOOLS,
  createWorkspaceRegistry,
  createWorkspaceSwitcher,
} from '@usenella/core';

const registry = createWorkspaceRegistry('/path/to/.nella');
const entry = registry.register('/path/to/repo', 'Repo');
const switcher = createWorkspaceSwitcher({ registry });
const workspace = await switcher.switchTo(entry.id);

const handler = createMcpToolHandler({ workspace });

// Handle a tool call
const response = await handler.handleToolCall({
  name: 'nella_search',
  arguments: { query: 'user authentication middleware' },
});
```

### Core MCP Tools (6)

| Tool | Description |
|------|-------------|
| `nella_search` | Search indexed codebase (hybrid vector + lexical) |
| `nella_verify` | Verify code against indexed codebase |
| `nella_index` | Index or re-index the workspace |
| `nella_get_context` | Get shared context entries |
| `nella_set_context` | Set shared context entries |
| `nella_status` | Get server/workspace status |

These are the core-level tools exposed by `createMcpToolHandler()`. The current `@getnella/mcp` package ships a different 7-tool surface focused on indexing, session context, dependency tracking, and heartbeat continuity. See the [MCP Tools Reference](../mcp/tools.md).

---

## GCP Backend

Enterprise deployment with Google Cloud SQL (pgvector) and Cloud Storage.

```ts
import { GCPSyncAdapter } from '@usenella/core';

const gcp = new GCPSyncAdapter({
  projectId: 'my-gcp-project',
  cloudSql: {
    instanceConnectionName: 'project:region:instance',
    database: 'nella',
    user: 'nella-service'
  },
  cloudStorage: {
    bucket: 'nella-artifacts'
  }
});
```

The GCP backend provides:
- **Cloud SQL with pgvector** — Full vector search capabilities
- **Cloud Storage** — Artifact and file storage
- **Hybrid search** — Vector + text search across indexed codebases
- **Schema migrations** — SQL schema included at `packages/core/src/gcp/schema.sql`

---

## Supabase Backend

Cloud integration via Supabase for auth, real-time sync, and storage.

```ts
import { SupabaseSyncAdapter, SupabaseTransport } from '@usenella/core';

// Sync adapter
const supabase = new SupabaseSyncAdapter({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_KEY
});

// Context sharing transport (real-time)
const transport = new SupabaseTransport({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_KEY
});
```

Features:
- **Auth integration** — Supabase Auth for user/session management
- **Real-time subscriptions** — Live context updates across agents
- **PostgreSQL + pgvector** — Vector search backed by Supabase
- **Schema** — SQL schema at `packages/core/src/supabase/schema.sql`

---

## Next Steps

- See the full [API Reference](./api-reference.md) for detailed function signatures.
- See [Types Reference](./types.md) for all TypeScript type definitions.
- See [Context Management](./context.md) for the assumption/change tracking system.
- See [Examples](./examples.md) for end-to-end code examples.
- Use the CLI + MCP server via the [CLI Reference](../cli/commands.md).
