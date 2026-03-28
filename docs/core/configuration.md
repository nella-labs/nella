# Configuration

Configuration options for `@usenella/core`.

## Table of Contents

- [IndexManager Configuration](#indexmanager-configuration)
- [Embedding Providers](#embedding-providers)
- [ContextManager Configuration](#contextmanager-configuration)
- [Workspace Configuration](#workspace-configuration)
- [MCP Tool Handler Configuration](#mcp-tool-handler-configuration)
- [Environment Variables](#environment-variables)

---

## IndexManager Configuration

The `IndexManager` is configured via `IndexManagerConfig`, which extends `IndexConfig` with workspace-specific fields.

```typescript
import { createIndexManager } from '@usenella/core';
import type { IndexManagerConfig } from '@usenella/core';

const config: IndexManagerConfig = {
  // Workspace identity
  workspaceId: 'my-project',
  workspacePath: '/path/to/repo',
  storagePath: '/path/to/repo/.nella/index',

  // Embedding settings
  embedder: {
    provider: 'azure',                 // 'azure' | 'nella'
    model: 'text-embedding-3-small',   // Model name
    dimensions: 1536,                  // Embedding vector dimensions
    apiKey: process.env.AZURE_EMBEDDING_API_KEY,
    endpoint: process.env.AZURE_ENDPOINT,
    deployment: process.env.AZURE_EMBEDDING_DEPLOYMENT,
  },

  // Chunking settings
  chunking: {
    maxTokens: 1024,                   // Max tokens per chunk
    overlap: 50,                       // Token overlap between chunks
    strategy: 'ast',                   // 'ast' | 'recursive' | 'fixed'
  },

  // Search settings
  search: {
    vectorWeight: 0.4,                 // Semantic search weight (0-1)
    lexicalWeight: 0.6,                // BM25 lexical search weight (0-1)
    rerankEnabled: true,               // Enable reranking
    rerankModel: undefined,            // Optional rerank model name
    topK: 10,                          // Default results per query
  },

  // File patterns
  include: [
    '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
    '**/*.py', '**/*.java', '**/*.go', '**/*.rs',
    '**/*.md', '**/*.json',
  ],
  exclude: [
    '**/node_modules/**', '**/dist/**', '**/build/**',
    '**/.git/**', '**/coverage/**', '**/*.min.js',
    '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock',
  ],
};

const manager = createIndexManager(config);
```

### Default Configuration

Use `DEFAULT_INDEX_CONFIG` for sensible defaults:

```typescript
import { DEFAULT_INDEX_CONFIG, DEFAULT_EMBEDDING_MODEL, MODEL_DIMENSIONS } from '@usenella/core';

// DEFAULT_INDEX_CONFIG provides:
// - embedder: azure provider, text-embedding-3-small, 1536 dimensions
// - chunking: 1024 max tokens, 50 overlap, AST strategy
// - search: 0.4 vector / 0.6 lexical weights, reranking enabled, topK 10
// - include: ts, tsx, js, jsx, py, java, go, rs, md, json
// - exclude: node_modules, dist, build, .git, coverage, min.js, lockfiles

const manager = createIndexManager({
  workspaceId: 'my-project',
  workspacePath: '/path/to/repo',
  storagePath: '/path/to/repo/.nella/index',
  ...DEFAULT_INDEX_CONFIG,
});
```

### Chunking Strategies

| Strategy | Description |
|----------|-------------|
| `ast` | AST-based chunking that respects function/class boundaries (recommended) |
| `recursive` | Recursive text splitting with overlap |
| `fixed` | Fixed-size token chunks |

### Search Weights

The hybrid search combines vector (semantic) and lexical (BM25) search using Reciprocal Rank Fusion (RRF):

- `vectorWeight: 0.4` + `lexicalWeight: 0.6` (default) -- favors keyword matches
- `vectorWeight: 0.6` + `lexicalWeight: 0.4` -- favors semantic understanding
- `vectorWeight: 1.0` + `lexicalWeight: 0.0` -- pure semantic search
- `vectorWeight: 0.0` + `lexicalWeight: 1.0` -- pure keyword search

---

## Embedding Providers

The `embedder.provider` field controls which embedding API is used. The only supported providers are `azure` and `nella`.

### Azure (default)

Uses Azure OpenAI embedding API:

```typescript
embedder: {
  provider: 'azure',
  model: 'text-embedding-3-small',
  dimensions: 1536,
  apiKey: process.env.AZURE_EMBEDDING_API_KEY,
  endpoint: process.env.AZURE_ENDPOINT,
  deployment: process.env.AZURE_EMBEDDING_DEPLOYMENT,
}
```

### Nella

Uses the Nella-hosted embedding service:

```typescript
embedder: {
  provider: 'nella',
  model: 'text-embedding-3-small',
  dimensions: 1536,
  apiBase: process.env.NELLA_API_BASE,
}
```

### Known Model Dimensions

```typescript
import { MODEL_DIMENSIONS } from '@usenella/core';

// MODEL_DIMENSIONS = {
//   'text-embedding-3-small': 1536,
//   'text-embedding-3-large': 3072,
// }
```

---

## ContextManager Configuration

The `ContextManager` is initialized with a repository path. It creates internal components (`SessionStore`, `DependencyTracker`, `AssumptionTracker`, `ChangeLedger`) automatically.

```typescript
import { ContextManager } from '@usenella/core';

// ContextManager persists session data to .nella/ in the repo
const ctx = new ContextManager('/path/to/repo');
```

Session data is stored at `.nella/session.json` in the repository root. The session includes:
- Session ID and timestamps
- Change records (file modifications per run)
- Assumptions (typed beliefs about the codebase)
- Dependency snapshots (package.json state)

---

## Workspace Configuration

### WorkspaceRegistry

```typescript
import { createWorkspaceRegistry, DEFAULT_REGISTRY_SETTINGS } from '@usenella/core';

// Registry persists to workspaces.json at the given path
const registry = createWorkspaceRegistry('/path/to/.nella');

// Register with optional config
registry.register('my-project', '/path/to/repo', {
  indexConfig: {
    embedder: { provider: 'azure', model: 'text-embedding-3-small', dimensions: 1536 },
    chunking: { maxTokens: 1024, overlap: 50, strategy: 'ast' },
    search: { vectorWeight: 0.4, lexicalWeight: 0.6, rerankEnabled: true, topK: 10 },
    include: ['**/*.ts', '**/*.js'],
    exclude: ['**/node_modules/**'],
  },
});
```

### Workspace Options

```typescript
import { Workspace } from '@usenella/core';

const workspace = new Workspace(workspaceId, {
  registry,                // WorkspaceRegistry instance
  autoLoad: true,          // Auto-load index on creation
  watchEnabled: true,      // Enable file watching for re-indexing
  watchOptions: {
    debounceMs: 500,       // Debounce file change events
  },
});
```

### Default Workspace Config

```typescript
import { DEFAULT_WORKSPACE_CONFIG } from '@usenella/core';

// DEFAULT_WORKSPACE_CONFIG provides sensible defaults for
// indexing, file watching, and workspace behavior
```

---

## MCP Tool Handler Configuration

```typescript
import { createMcpToolHandler } from '@usenella/core';

const handler = createMcpToolHandler({
  workspace,                    // Required: Workspace instance
  authenticator: undefined,     // Optional: Authenticator for API key validation
  rateLimiter: undefined,       // Optional: RateLimiter for request throttling
  contextManager: undefined,    // Optional: shared context manager
  agentId: undefined,           // Optional: agent identifier
  apiKey: undefined,            // Optional: API key

  // Cache configuration (false to disable)
  cache: {
    maxSize: 100,
    ttlMs: 300_000,             // 5 minutes
  },

  // Telemetry configuration
  telemetry: {
    enabled: true,
    maxSpans: 1000,
  },
});
```

---

## Environment Variables

| Variable | Module | Description |
|----------|--------|-------------|
| `AZURE_EMBEDDING_API_KEY` | Indexing | Azure OpenAI embedding API key |
| `AZURE_ENDPOINT` | Indexing | Azure OpenAI endpoint URL |
| `AZURE_EMBEDDING_DEPLOYMENT` | Indexing | Azure OpenAI embedding deployment name |
| `AZURE_RERANK_API_KEY` | Indexing | Azure-hosted rerank API key |
| `AZURE_RERANK_ENDPOINT` | Indexing | Azure-hosted rerank endpoint URL |
| `NELLA_API_KEY` | CLI | Default API key for connect command |
| `NELLA_API_BASE` | Indexing | Nella-hosted embedding service base URL |
| `NELLA_LOG_LEVEL` | All | Log verbosity level |
| `SUPABASE_URL` | Sync, Auth | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Sync, Auth | Supabase service role key |
| `REDIS_URL` | Rate Limiting | Redis connection URL |
