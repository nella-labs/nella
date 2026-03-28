# API Reference

Complete API documentation for `@usenella/core`.

## Table of Contents

- [Indexing & RAG](#indexing--rag)
- [Context Tracking](#context-tracking)
- [Workspace Management](#workspace-management)
- [MCP Tools](#mcp-tools)
- [Services](#services)
- [Utilities](#utilities)
- [Playground](#playground)
- [Content Security](#content-security)

---

## Indexing & RAG

```typescript
import {
  IndexManager,
  createIndexManager,
  DEFAULT_INDEX_CONFIG,
  DEFAULT_EMBEDDING_MODEL,
  MODEL_DIMENSIONS,
  HybridSearcher,
  createHybridSearcher,
  CodeVerifier,
  createCodeVerifier,
} from '@usenella/core';
```

### `IndexManager`

Main orchestrator for the RAG indexing system. Manages document loading, chunking, embedding, and hybrid search (vector + lexical with RRF fusion).

```typescript
const manager = createIndexManager({
  workspaceId: 'my-project',
  workspacePath: '/path/to/repo',
  storagePath: '/path/to/repo/.nella/index',
  embedder: {
    provider: 'azure',       // 'azure' | 'nella'
    model: 'text-embedding-3-small',
    dimensions: 1536,
  },
  chunking: {
    maxTokens: 1024,
    overlap: 50,
    strategy: 'ast',         // 'ast' | 'recursive' | 'fixed'
  },
  search: {
    vectorWeight: 0.4,
    lexicalWeight: 0.6,
    rerankEnabled: true,
    topK: 10,
  },
  include: ['**/*.ts', '**/*.js', '**/*.py'],
  exclude: ['**/node_modules/**', '**/dist/**'],
});
```

**Constructor:** `new IndexManager(config: IndexManagerConfig)`

**Factory:** `createIndexManager(config: IndexManagerConfig): IndexManager`

**Key Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `index(options?)` | `Promise<IndexMetadata>` | Index the workspace. Options: `{ force?: boolean; paths?: string[] }`. Incremental by default (skips unchanged files). |
| `search(query)` | `Promise<SearchResponse>` | Hybrid search (vector + lexical with RRF fusion). Takes a `SearchQuery` object. |
| `verify(request)` | `VerifyCodeResult` | Verify code imports, symbols, and API usage against the indexed codebase. |
| `getChunk(chunkId)` | `CodeChunk \| null` | Get a specific chunk by ID. |
| `getChunksForFile(filePath)` | `CodeChunk[]` | Get all indexed chunks for a file. |
| `getAllChunks()` | `CodeChunk[]` | Get all indexed chunks. |
| `getMetadata()` | `IndexMetadata \| null` | Get index metadata (stats, config, timestamps). |
| `getStatus()` | `{ ready, stats, lastUpdated }` | Get index readiness status. |
| `clear()` | `void` | Clear the index and all persisted files. |
| `onEvent(handler)` | `void` | Subscribe to index events (progress, errors, etc.). |

**`SearchQuery`:**

```typescript
interface SearchQuery {
  query: string;
  filter?: SearchFilter;
  limit?: number;
  mode?: 'hybrid' | 'semantic' | 'lexical';
  includeEmbedding?: boolean;
}
```

**`SearchResponse`:**

```typescript
interface SearchResponse {
  results: SearchResult[];
  query: string;
  totalMatches: number;
  searchTime: number;
  tokensUsed: number;
  cost: number;
  confidence: number;
  suggestion: 'use_results' | 'query_unclear' | 'no_matches' | 'low_confidence';
}
```

### `HybridSearcher`

Combines vector and lexical search using Reciprocal Rank Fusion (RRF).

- Default weights: 0.4 vector / 0.6 lexical
- Fusion constant k=60
- Optional reranking

**Factory:** `createHybridSearcher(vectorStore, lexicalIndex, embedder, options)`

### `CodeVerifier`

Verifies generated code against the indexed codebase:
- **Import verification** -- checks that imported modules exist
- **Symbol verification** -- checks that referenced symbols are exported
- **API verification** -- checks function signatures and types

**Factory:** `createCodeVerifier(lexicalIndex)`

```typescript
const result = manager.verify({
  code: agentGeneratedCode,
  filePath: 'src/users.ts',
  checkImports: true,
  checkSymbols: true,
});

console.log(result.valid);   // boolean
console.log(result.issues);  // VerifyIssue[]
```

### Constants

| Export | Value | Description |
|--------|-------|-------------|
| `DEFAULT_INDEX_CONFIG` | `IndexConfig` | Default config: azure embedder, AST chunking, 0.4/0.6 search weights |
| `DEFAULT_EMBEDDING_MODEL` | `'text-embedding-3-small'` | Default embedding model name |
| `MODEL_DIMENSIONS` | `Record<string, number>` | Map of model name to embedding dimensions |

---

## Context Tracking

```typescript
import {
  ContextManager,
  SessionStore,
  DependencyTracker,
  AssumptionTracker,
  ChangeLedger,
} from '@usenella/core';
```

### `ContextManager`

High-level coordinator for all context tracking features. Provides session persistence, assumption tracking, dependency drift detection, and change history.

**Constructor:** `new ContextManager(repoPath: string)`

```typescript
const ctx = new ContextManager('/path/to/repo');
```

**Public Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `session` | `SessionStore` | Session persistence |
| `dependencies` | `DependencyTracker` | Dependency snapshot and diff |
| `assumptions` | `AssumptionTracker` | Assumption tracking and invalidation |
| `changes` | `ChangeLedger` | File change history |

**Key Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `getContext(recentChangesLimit?)` | `AgentContext` | Full context for the agent: session, changes, assumptions, dependencies |
| `getStats()` | `ContextStats` | Statistics: total changes, hotspots, assumption counts, session duration |
| `checkDependencies(repoPath)` | `DependencyDiff \| null` | Snapshot dependencies and detect drift since last check |
| `recordRunChanges(runId, changes, checkInvalidations?)` | `{ recorded, invalidated }` | Record file changes and optionally invalidate assumptions |
| `preflightCheck(plannedFiles)` | `{ conflicts, impactAnalysis, dependencyDrift }` | Pre-flight check for conflicts before applying changes |
| `getSummary()` | `string` | Human-readable summary for logging |
| `save()` | `void` | Persist session to disk |
| `reset()` | `void` | Reset the session (start fresh) |

### `SessionStore`

Load and persist session data to disk.

```typescript
const store = new SessionStore('/path/to/repo');
const session = store.getSession();
```

### `DependencyTracker`

Snapshot `package.json` dependencies and detect changes between runs.

### `AssumptionTracker`

Record what the agent believes about the codebase. Assumptions are automatically invalidated when related files change.

```typescript
ctx.assumptions.addAssumption(
  'User table has email column',
  ['prisma/schema.prisma'],
  'schema'
);

const conflicts = ctx.assumptions.getConflicts(['src/users.ts']);
const valid = ctx.assumptions.getValidAssumptions();
```

### `ChangeLedger`

Store file change history across runs with impact analysis.

---

## Workspace Management

```typescript
import {
  WorkspaceRegistry,
  getWorkspaceRegistry,
  createWorkspaceRegistry,
  Workspace,
  WorkspaceSwitcher,
  getWorkspaceSwitcher,
  createWorkspaceSwitcher,
  DEFAULT_WORKSPACE_CONFIG,
  DEFAULT_REGISTRY_SETTINGS,
} from '@usenella/core';
```

### `WorkspaceRegistry`

Multi-workspace management with CRUD operations and persistence.

**Factory:** `createWorkspaceRegistry(storagePath?: string)`

**Singleton:** `getWorkspaceRegistry()`

```typescript
const registry = createWorkspaceRegistry('/path/to/.nella');

// Register a workspace
const entry = registry.register('my-project', '/path/to/repo');

// List all workspaces
const all = registry.list();

// Get by ID
const found = registry.get(entry.id);

// Remove
registry.remove(entry.id);
```

**Key Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `register(name, path, config?)` | `WorkspaceEntry` | Register a new workspace |
| `list()` | `WorkspaceEntry[]` | List all registered workspaces |
| `get(id)` | `WorkspaceEntry \| undefined` | Get workspace by ID |
| `update(id, updates)` | `void` | Update workspace entry |
| `remove(id)` | `void` | Remove a workspace |

### `Workspace`

Individual workspace with integrated `IndexManager`, file watching, and shared context.

**Constructor:** `new Workspace(workspaceId: string, options?: WorkspaceOptions)`

```typescript
const workspace = new Workspace(entry.id, {
  registry,
  watchEnabled: true,
});
```

### `WorkspaceSwitcher`

Switch the active workspace in multi-workspace environments.

**Factory:** `createWorkspaceSwitcher(options?: SwitcherOptions)`

**Singleton:** `getWorkspaceSwitcher()`

---

## MCP Tools

```typescript
import {
  McpToolHandler,
  createMcpToolHandler,
  NELLA_TOOLS,
  validateToolInput,
  ToolRegistry,
  createToolRegistry,
  ToolResultCache,
  TelemetryManager,
  createTelemetryManager,
  retryWithBackoff,
} from '@usenella/core';
```

### `McpToolHandler`

Routes MCP tool calls to appropriate services. Includes validation, caching, timeouts, retry, chaining, and telemetry.

**Factory:** `createMcpToolHandler(config: ToolHandlerConfig)`

```typescript
const handler = createMcpToolHandler({
  workspace,
  authenticator,  // optional
  rateLimiter,    // optional
});

const result = await handler.handle('nella_search', {
  query: 'user authentication',
});
```

### `NELLA_TOOLS` (7 tools)

The MCP tool definitions shipped by `@getnella/mcp`:

| Tool | Category | Description |
|------|----------|-------------|
| `nella_index` | indexing | Index or re-index the workspace codebase |
| `nella_search` | search | Hybrid search (vector + lexical) over the indexed codebase |
| `nella_get_context` | context | Get session state, recent changes, and active assumptions |
| `nella_add_assumption` | context | Record an assumption about the codebase |
| `nella_check_assumptions` | context | Review all tracked assumptions and their validity |
| `nella_check_dependencies` | context | Detect dependency drift in package.json |
| `nella_heartbeat` | security | Challenge-response trust chain verification |

See the [MCP Tools Reference](../mcp/tools.md) for full parameter documentation.

### Validation & Error Handling

```typescript
import {
  validateToolInput,
  assertValidToolInput,
  McpError,
  ToolValidationError,
  ToolTimeoutError,
  UnknownToolError,
  ChainDepthError,
  RetryExhaustedError,
} from '@usenella/core';

// Validate tool input before calling
const validation = validateToolInput('nella_search', { query: 'test' });
if (!validation.valid) {
  console.log(validation.errors);
}

// Or throw on invalid input
assertValidToolInput('nella_search', { query: 'test' });
```

### `ToolRegistry`

Register and discover tools with filtering by category, tags, and version.

**Factory:** `createToolRegistry()`

### `ToolResultCache`

LRU cache for tool results with TTL and configurable size.

### `TelemetryManager`

Collect and report tool usage metrics.

**Factory:** `createTelemetryManager(config: TelemetryConfig)`

---

## Services

High-level business logic services consumed by both the REST API and MCP tool handlers. Each service wraps core modules with simplified interfaces and atomic operations.

```typescript
import {
  SearchService,
  ContextService,
  WorkspaceService,
  AuthService,
} from '@usenella/core';
```

### `SearchService`

Wraps `IndexManager` for workspace indexing, hybrid search, and code verification.

```typescript
const searchService = new SearchService();

// Index a workspace
await searchService.indexWorkspace('my-project', {
  workspacePath: '/path/to/repo',
  storagePath: '/path/to/.nella/index',
});

// Search
const results = await searchService.search(
  { workspaceId: 'my-project', query: 'user auth', mode: 'hybrid', topK: 10 },
  { workspacePath: '/path/to/repo', storagePath: '/path/to/.nella/index' }
);

// Verify code
const verification = await searchService.verifyCode(
  'my-project',
  'import { UserService } from "./services/user";',
  { workspacePath: '/path/to/repo', storagePath: '/path/to/.nella/index' }
);
```

**Key Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `indexWorkspace(workspaceId, config, onProgress?)` | `Promise<IndexMetadata>` | Index a workspace |
| `search(params, config)` | `Promise<SearchResponse>` | Search (hybrid/semantic/lexical) |
| `verifyCode(workspaceId, code, config, options?)` | `Promise<VerifyCodeResult>` | Verify code against index |
| `removeWorkspace(workspaceId)` | `void` | Remove cached IndexManager |

### `ContextService`

Wraps `ContextManager` with atomic operations (record + invalidate + save in one call).

```typescript
const ctxService = new ContextService(contextManager);

// Get full context
const context = ctxService.getContext();

// Add assumption with auto-save
await ctxService.addAssumption({
  type: 'schema',
  description: 'User table has email column',
  relatedFiles: ['prisma/schema.prisma'],
});

// Record changes with automatic invalidation
await ctxService.recordChanges({
  files: ['src/users.ts'],
  operation: 'modify',
  reason: 'Added email validation',
});

// Pre-flight check
const preflight = ctxService.preflightCheck('/path/to/repo');
```

**Key Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `getContext(recentChangesLimit?)` | `AgentContext` | Full session context |
| `addAssumption(params)` | `Promise<Assumption>` | Add assumption with auto-save |
| `getAssumptionStatus()` | `{ valid, invalidated, summary }` | Assumption breakdown |
| `getFileHistory(filePath)` | `FileChangeHistory` | File change history |
| `checkDependencies(workspacePath)` | `DependencyDiff \| null` | Detect dependency drift |
| `recordChanges(params)` | `Promise<RecordChangesResult>` | Record + invalidate + save atomically |
| `preflightCheck(workspacePath)` | `{ hasDependencyChanges, dependencyDiff, conflictingAssumptions }` | Pre-flight check |

### `WorkspaceService`

Wraps `WorkspaceRegistry` for CRUD and index triggering.

```typescript
const wsService = new WorkspaceService('/path/to/.nella');

const ws = await wsService.create({ name: 'my-project', path: '/path/to/repo' });
const { workspaces, total } = await wsService.list();
await wsService.remove(ws.id);
```

### `AuthService`

Authentication service for API key management.

---

## Utilities

### Logging

```typescript
import { RunLogger, generateRunId } from '@usenella/core';
```

#### `RunLogger`

Structured JSONL logger for run records.

```typescript
const runId = generateRunId();
const runDir = createNellaDir('/path/to/repo', runId);
const logger = new RunLogger(runDir);

logger.logPlan(['src/users.ts'], 'Add user endpoint');
logger.logConstraintCheck('no-auth', true);
logger.logValidation('test', true, 0);
logger.logScopeCheck(['extra.ts'], [], 0.5);
logger.logMetrics({ scopeCreep: 0.5, constraintViolations: 0 });
logger.logError('Something went wrong');
```

#### `generateRunId() → string`

Generate a unique run identifier. Format: `YYYY-MM-DD_HHMMSS_XXXX`

### Workspace Utilities

```typescript
import {
  createTempWorkspace,
  applyChanges,
  getDiff,
  getModifiedFiles,
  createNellaDir,
  writeArtifacts,
  cleanupTempWorkspace,
} from '@usenella/core';
```

| Function | Description |
|----------|-------------|
| `createTempWorkspace(sourcePath)` | Create a temporary copy (excludes node_modules, .git, .nella) |
| `applyChanges(workspacePath, changes)` | Apply file changes to a workspace |
| `getDiff(workspacePath)` | Get git diff of uncommitted changes |
| `getModifiedFiles(workspacePath)` | Get list of modified files from git status |
| `createNellaDir(workspacePath, runId)` | Create `.nella/runs/{runId}` directory |
| `writeArtifacts(runDir, diff, metrics)` | Write run artifacts (diff.patch, metrics.json) |
| `cleanupTempWorkspace(tempPath)` | Remove a temporary workspace |

---

## Playground

```typescript
import {
  PlaygroundServer,
  createPlaygroundServer,
  DEFAULT_SERVER_CONFIG,
  DEFAULT_COST_CONFIG,
} from '@usenella/core';
```

### `PlaygroundServer`

WebSocket + HTTP server for real-time agent debugging.

**Factory:** `createPlaygroundServer(config: PlaygroundServerConfig)`

```typescript
const server = createPlaygroundServer({
  port: 3847,
  host: 'localhost',
});

await server.start();
// Dashboard: http://localhost:3847
// WebSocket: ws://localhost:3847/ws
```

**Features:**
- Real-time session tracking via WebSocket
- Chain-of-thought visualization
- Tool call history and timing
- Token usage and cost tracking

---

## Content Security

Prompt injection defense and HMAC signing for result integrity.

```typescript
import {
  scanContent,
  formatInjectionWarning,
  scoreInjectionRisk,
  deriveHmacKey,
  signResultHmac,
  verifyResultHmac,
  signResponseHmac,
  verifyResponseHmac,
  buildDependencyGraph,
} from '@usenella/core';
```

### Content Scanning

| Function | Description |
|----------|-------------|
| `scanContent(content)` | Scan content for prompt injection patterns |
| `formatInjectionWarning(result)` | Format scan result as a human-readable warning |
| `scoreInjectionRisk(chunk)` | Compute injection risk score for a code chunk (0.0-1.0) |

### HMAC Signing

| Function | Description |
|----------|-------------|
| `deriveHmacKey(secret)` | Derive an HMAC key from a secret |
| `signResultHmac(result, key)` | Sign a search result for integrity |
| `verifyResultHmac(result, key)` | Verify a signed search result |
| `signResponseHmac(response, key)` | Sign a full search response |
| `verifyResponseHmac(response, key)` | Verify a signed search response |

### Dependency Graph

| Function | Description |
|----------|-------------|
| `buildDependencyGraph(options)` | Build a file dependency graph from imports |
| `dependencyGraphToArchgraphModel(graph)` | Convert dependency graph to archgraph C4 model |
