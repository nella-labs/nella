# TypeScript Library

Use Nella programmatically in your TypeScript projects.

The `@usenella/core` package provides TypeScript classes for code indexing, hybrid search, session tracking, assumption management, and workspace management that you can use in your own tools and workflows.

## Installation

```bash
npm install @usenella/core
```

Or with pnpm:

```bash
pnpm add @usenella/core
```

## Main Entry Points

### IndexManager -- Indexing and Search

The `IndexManager` is the main entry point for code indexing and search. It manages document loading, AST-based chunking, embedding generation, and hybrid search (vector + lexical with RRF fusion).

```typescript
import {
  createIndexManager,
  DEFAULT_INDEX_CONFIG,
  DEFAULT_EMBEDDING_MODEL,
  MODEL_DIMENSIONS,
} from '@usenella/core';

const manager = createIndexManager({
  workspaceId: 'my-project',
  workspacePath: '/path/to/repo',
  storagePath: '/path/to/repo/.nella/index',
  ...DEFAULT_INDEX_CONFIG,
  embedder: {
    provider: 'azure',                               // 'azure' | 'nella'
    model: DEFAULT_EMBEDDING_MODEL,                   // 'text-embedding-3-small'
    dimensions: MODEL_DIMENSIONS[DEFAULT_EMBEDDING_MODEL], // 1536
  },
});

// Index the workspace (incremental by default)
const metadata = await manager.index();
console.log(`Indexed ${metadata.stats.filesIndexed} files, ${metadata.stats.chunksCount} chunks`);

// Search
const response = await manager.search({
  query: 'user authentication middleware',
  mode: 'hybrid',  // 'hybrid' | 'semantic' | 'lexical'
  limit: 10,
});

for (const result of response.results) {
  console.log(`[${result.score.toFixed(2)}] ${result.chunk.filePath}:${result.chunk.lines[0]}`);
}

// Verify generated code against the index
const verification = manager.verify({
  code: `import { UserService } from './services/user';`,
  checkImports: true,
  checkSymbols: true,
});

if (!verification.valid) {
  for (const issue of verification.issues) {
    console.log(`${issue.severity}: ${issue.message}`);
  }
}
```

### ContextManager -- Session Tracking

The `ContextManager` provides persistent session tracking across conversations. It tracks assumptions, detects dependency drift, and maintains a change ledger.

```typescript
import { ContextManager } from '@usenella/core';

const ctx = new ContextManager('/path/to/repo');

// Get full agent context (session, changes, assumptions, dependencies)
const context = ctx.getContext();
console.log('Session:', context.session.sessionId);
console.log('Valid assumptions:', context.validAssumptions.length);

// Track assumptions about the codebase
ctx.assumptions.addAssumption(
  'User model has email and name fields',
  ['prisma/schema.prisma'],
  'schema'
);

// Pre-flight check before applying changes
const preflight = ctx.preflightCheck(['src/users.ts']);
if (preflight.conflicts.length > 0) {
  console.warn('Conflicts:', preflight.conflicts);
}
if (preflight.dependencyDrift) {
  console.warn('Dependencies have drifted since last check');
}

// Detect dependency changes
const diff = ctx.checkDependencies('/path/to/repo');
if (diff && diff.hasChanges) {
  console.log('Changed packages:', diff.changes);
}

// Record file changes and invalidate related assumptions
ctx.recordRunChanges('run_001', [
  { file: 'src/users.ts', operation: 'modify', reason: 'Added validation' },
]);

ctx.save();
```

### WorkspaceRegistry -- Multi-Workspace Management

Manage multiple project workspaces with isolated indexing and context:

```typescript
import {
  createWorkspaceRegistry,
  createWorkspaceSwitcher,
  Workspace,
} from '@usenella/core';

const registry = createWorkspaceRegistry('/path/to/.nella');

// Register workspaces
const backend = registry.register('Backend API', '/repos/backend');
const frontend = registry.register('Frontend App', '/repos/frontend');

// List and iterate
for (const ws of registry.list()) {
  console.log(`${ws.name}: ${ws.path}`);
}

// Create a Workspace instance with integrated IndexManager
const workspace = new Workspace(backend.id, {
  registry,
  watchEnabled: true,
});

// Switch between workspaces
const switcher = createWorkspaceSwitcher({ registry });
```

## Services Layer

The service layer provides simplified, atomic operations on top of the core modules:

```typescript
import {
  SearchService,
  ContextService,
  WorkspaceService,
  ContextManager,
} from '@usenella/core';

// SearchService wraps IndexManager
const searchService = new SearchService();
const results = await searchService.search(
  { workspaceId: 'my-project', query: 'auth middleware', topK: 5 },
  { workspacePath: '/path/to/repo', storagePath: '/path/to/.nella/index' }
);

// ContextService wraps ContextManager with auto-save
const ctxService = new ContextService(new ContextManager('/path/to/repo'));
await ctxService.addAssumption({
  type: 'schema',
  description: 'Users table has email column',
  relatedFiles: ['prisma/schema.prisma'],
});

// Record changes atomically (record + invalidate + save)
await ctxService.recordChanges({
  files: ['src/users.ts'],
  operation: 'modify',
  reason: 'Added validation',
});

// WorkspaceService wraps WorkspaceRegistry
const wsService = new WorkspaceService('/path/to/.nella');
const ws = await wsService.create({ name: 'my-project', path: '/path/to/repo' });
const { workspaces } = await wsService.list();
```

## MCP Tool Handler

Create an MCP tool handler to expose Nella's capabilities via the Model Context Protocol:

```typescript
import { createMcpToolHandler, NELLA_TOOLS, Workspace } from '@usenella/core';

// The handler routes tool calls to appropriate services
const handler = createMcpToolHandler({
  workspace,  // Workspace instance
});

// Handle a tool call
const result = await handler.handle('nella_search', {
  query: 'user authentication',
  mode: 'hybrid',
  limit: 5,
});

// Available tools
for (const tool of NELLA_TOOLS) {
  console.log(`${tool.name}: ${tool.description}`);
}
```

## Type Definitions

Key types you can import:

```typescript
import type {
  // Indexing
  IndexManagerConfig,
  IndexConfig,
  IndexMetadata,
  CodeChunk,
  SearchQuery,
  SearchFilter,
  SearchResult,
  SearchResponse,
  VerifyCodeRequest,
  VerifyCodeResult,
  VerifyIssue,

  // Context
  AgentContext,
  ContextStats,
  Session,
  Assumption,
  AssumptionType,
  DependencyDiff,
  DependencySnapshot,
  ChangeRecord,
  FileChangeHistory,

  // Workspace
  WorkspaceEntry,
  WorkspaceConfig,

  // MCP
  McpTool,
  McpToolCall,
  McpToolResult,

  // Services
  SearchParams,
  SearchServiceConfig,
  AddAssumptionParams,
  RecordChangesParams,
} from '@usenella/core';
```

## Related Packages

- [`@getnella/mcp`](https://www.npmjs.com/package/@getnella/mcp) -- CLI + MCP server
- [`@usenella/benchmark`](https://www.npmjs.com/package/@usenella/benchmark) -- Benchmarking tools
