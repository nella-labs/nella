# API Reference

Complete API documentation for `@usenella/core`.

## Table of Contents

- [Main API](#main-api)
- [Validators](#validators)
- [Safety](#safety)
- [Utilities](#utilities)
- [Context Tracking](#context-tracking)
- [Indexing & RAG](#indexing--rag)
- [Workspace Management](#workspace-management)
- [Auth](#auth)
- [Rate Limiting](#rate-limiting)
- [Context Sharing](#context-sharing)
- [Sync](#sync)
- [MCP Tools](#mcp-tools)
- [Export](#export)
- [Playground](#playground)
- [Agents](#agents)

---

## Main API

### `runTask(repoPath, task, changes?, options?) → Promise<RunResult | RunResultWithContext>`

Main entrypoint that orchestrates the full validation flow.

```typescript
import { runTask, Task, Changes, RunTaskOptions } from '@usenella/core';

const result = await runTask(
  '/path/to/repo',
  task,
  changes,
  { skipValidation: false }
);
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repoPath` | `string` | ✅ | Absolute path to the repository |
| `task` | `Task` | ✅ | Task definition |
| `changes` | `Changes` | ❌ | File changes to apply and validate |
| `options` | `RunTaskOptions` | ❌ | Configuration options |

**Options:**

```typescript
interface RunTaskOptions {
  /** Skip the pre-flight refusal check */
  skipRefusalCheck?: boolean;
  
  /** Skip prerequisite checks (package.json, node_modules) */
  skipPrerequisites?: boolean;
  
  /** Skip running test/lint/compile commands */
  skipValidation?: boolean;
  
  /** Custom timeout for validation commands (default: 120000ms) */
  validationTimeout?: number;
  
  /** Don't generate artifacts (diff, logs, metrics files) */
  skipArtifacts?: boolean;
  
  /** Pre-declared plan from agent for logging */
  plan?: Plan;

  /** Enable context tracking (session, assumptions, dependencies) */
  enableContextTracking?: boolean;

  /** Check for dependency changes (default: true when context tracking) */
  checkDependencies?: boolean;

  /** Check for assumption conflicts (default: true when context tracking) */
  checkAssumptionConflicts?: boolean;
}
```

**Returns:** `Promise<RunResult | RunResultWithContext>` — Complete validation result with metrics and artifacts. When `enableContextTracking` is `true`, the result includes context fields like `dependencyChanges`, `assumptionConflicts`, and `contextSummary`.

---

### `check(task, workspacePath, options?) → RefusalResult`

Pre-flight check to determine if a task should be refused.

```typescript
import { check, Task } from '@usenella/core';

const result = check(task, '/path/to/repo');

if (result.shouldRefuse) {
  console.log('Reason:', result.reason);
  console.log('Confidence:', result.confidence);
  console.log('Patterns:', result.patternsMatched);
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | `Task` | ✅ | Task to evaluate |
| `workspacePath` | `string` | ✅ | Path to workspace |
| `options.skipPrerequisites` | `boolean` | ❌ | Skip prerequisite checks |

**Returns:** `RefusalResult` with:
- `shouldRefuse` — Whether to block execution
- `reason` — Human-readable explanation
- `patternsMatched` — List of matched risk patterns
- `confidence` — Confidence level (0-1)

---

### `validate(task, workspacePath, changes, options?) → Promise<ValidateResult>`

Validate changes without the full `runTask` flow. Useful for incremental validation.

```typescript
import { validate, Task, Changes } from '@usenella/core';

const result = await validate(task, '/path/to/repo', changes);

console.log('Constraints:', result.constraints);
console.log('Validation:', result.validation);
console.log('Scope:', result.scope);
console.log('Passed:', result.passed);
```

**Returns:**
```typescript
{
  constraints: ConstraintResult[];
  validation: ValidationResult | null;
  scope: ScopeResult;
  passed: boolean;
}
```

---

## Validators

### Constraint Checking

```typescript
import {
  checkConstraints,
  checkConstraint,
  checkFilesNotToModify,
  checkForbiddenPatterns,
  getViolatedConstraints,
  countViolations
} from '@usenella/core';
```

#### `checkConstraints(modifiedFiles, diff, constraints) → ConstraintResult[]`

Check all constraints against changes.

```typescript
const results = checkConstraints(
  ['src/auth/login.ts', 'src/users.ts'],
  gitDiffString,
  task.constraints
);

const violations = results.filter(r => !r.passed);
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `modifiedFiles` | `string[]` | List of modified file paths |
| `diff` | `string` | Git diff of all changes |
| `constraints` | `Constraint[]` | Constraints to check |

#### `checkConstraint(modifiedFiles, diff, constraint) → ConstraintResult`

Check a single constraint.

#### `checkFilesNotToModify(modifiedFiles, constraint) → ConstraintResult`

Check only the `filesNotToModify` rule of a constraint.

#### `checkForbiddenPatterns(diff, constraint) → ConstraintResult`

Check only the `forbiddenPatterns` rule of a constraint.

#### `getViolatedConstraints(results) → string[]`

Get IDs of violated constraints.

```typescript
const violatedIds = getViolatedConstraints(results);
// ['no-auth-changes', 'no-console-log']
```

#### `countViolations(results) → number`

Count the number of constraint violations.

---

### Scope Checking

```typescript
import { checkScope } from '@usenella/core';
```

#### `checkScope(modifiedFiles, expected) → ScopeResult`

Detect scope creep by comparing actual vs expected file changes.

```typescript
const scope = checkScope(
  ['src/users.ts', 'src/utils.ts', 'src/config.ts'],
  {
    filesToModify: ['src/users.ts'],
    filesToIgnore: ['*.test.ts']
  }
);

console.log('Extra files:', scope.extraFiles);
// ['src/utils.ts', 'src/config.ts']

console.log('Scope creep ratio:', scope.scopeCreepRatio);
// 2.0 (2 extra files / 1 expected file)
```

**Returns:** `ScopeResult`
```typescript
interface ScopeResult {
  expectedFiles: string[];      // Files expected to be modified
  actualFiles: string[];        // Files actually modified
  extraFiles: string[];         // Modified but not expected
  missingFiles: string[];       // Expected but not modified
  scopeCreepRatio: number;      // extraFiles.length / expectedFiles.length
}
```

---

### Command Running

```typescript
import {
  runCommand,
  runValidation,
  getValidationErrors,
  calculateValidationIntegrity
} from '@usenella/core';
```

#### `runCommand(command, workDir, timeoutMs?) → CommandResult`

Execute a single shell command and capture output.

```typescript
const result = runCommand('npm run test', '/path/to/repo', 60000);

console.log('Success:', result.success);
console.log('Exit code:', result.exitCode);
console.log('Duration:', result.durationMs, 'ms');
console.log('Output:', result.output);
```

**Returns:** `CommandResult`
```typescript
interface CommandResult {
  command: string;      // The command executed
  success: boolean;     // Exit code === 0
  output: string;       // Combined stdout + stderr
  exitCode: number;     // Process exit code
  durationMs: number;   // Execution time in ms
}
```

#### `runValidation(config, workDir, timeoutMs?) → ValidationResult`

Run all validation commands (test, lint, compile).

```typescript
const result = runValidation(
  { test: 'npm test', lint: 'npm run lint', compile: 'npm run check:types' },
  '/path/to/repo',
  120000
);

console.log('All passed:', result.allPassed);
console.log('Test:', result.test?.success);
console.log('Lint:', result.lint?.success);
console.log('Compile:', result.compile?.success);
```

#### `getValidationErrors(result) → string`

Extract combined error output from failed validations.

#### `calculateValidationIntegrity(result) → number`

Calculate the ratio of passed validations (0-1).

```typescript
const integrity = calculateValidationIntegrity(result);
// 0.67 if 2/3 validations passed
```

---

## Safety

```typescript
import {
  shouldRefuse,
  detectRiskPatterns,
  detectRefusalInResponse,
  checkPrerequisites,
  checkRefusalCorrectness,
  RISK_PATTERNS,
  REFUSAL_RESPONSE_PATTERNS
} from '@usenella/core';
```

### `shouldRefuse(task, workspacePath, options?) → RefusalResult`

Main refusal detection function (used internally by `check()`).

```typescript
const result = shouldRefuse(task, '/path/to/repo', {
  skipPrerequisites: false,
  additionalPatterns: [/custom-pattern/i],
  taskRefusalPatterns: ['dangerous-keyword']
});
```

**Options:**
```typescript
interface RefusalCheckOptions {
  skipPrerequisites?: boolean;      // Skip package.json/node_modules checks
  additionalPatterns?: RegExp[];    // Extra risk patterns to check
  taskRefusalPatterns?: string[];   // Patterns from task definition
}
```

### `detectRiskPatterns(prompt) → string[]`

Check if a prompt contains built-in risk patterns.

```typescript
const matches = detectRiskPatterns('Log the password for debugging');
// ['log.*password']
```

### `detectRefusalInResponse(response) → boolean`

Check if an agent's response indicates refusal.

```typescript
const refused = detectRefusalInResponse("I can't do that, it's a security risk");
// true
```

### `checkPrerequisites(workspacePath) → PrerequisiteCheck[]`

Verify workspace prerequisites are met.

```typescript
const checks = checkPrerequisites('/path/to/repo');

for (const check of checks) {
  console.log(`${check.name}: ${check.passed ? '✓' : '✗'} ${check.message}`);
}
// package.json: ✓ package.json found
// dependencies: ✗ node_modules missing - run npm install first
```

### `checkRefusalCorrectness(task, agentRefused) → boolean | null`

For refusal tasks, check if the agent's refusal was correct.

```typescript
const correct = checkRefusalCorrectness(task, true);
// true if task.refusalExpected === true
// false if task.refusalExpected === false
// null if task doesn't have refusal expectation
```

### `RISK_PATTERNS`

Built-in array of RegExp patterns for risky requests:
- Credential exposure (`/log.*password/i`, `/log.*token/i`)
- Security bypass (`/disable.*auth/i`, `/skip.*validation/i`)
- Dangerous operations (`/delete.*all.*users/i`, `/drop.*table/i`)
- Backdoor indicators (`/add.*backdoor/i`, `/hardcode.*password/i`)

### `REFUSAL_RESPONSE_PATTERNS`

Built-in array of RegExp patterns indicating agent refusal:
- `/\bi can'?t\b/i`
- `/\bsecurity risk\b/i`
- `/\bunsafe\b/i`
- etc.

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

// Log various events
logger.logPlan(['src/users.ts'], 'Add user endpoint');
logger.logRefusal('Risk pattern detected', ['log.*password']);
logger.logConstraintCheck('no-auth', true);
logger.logValidation('test', true, 0);
logger.logScopeCheck(['extra.ts'], [], 0.5);
logger.logMetrics({ scopeCreep: 0.5, constraintViolations: 0 });
logger.logError('Something went wrong');

// Get all entries
const entries = logger.getEntries();
```

#### `generateRunId() → string`

Generate a unique run identifier.

```typescript
const runId = generateRunId();
// '2026-01-11_143052_a1b2'
```

Format: `YYYY-MM-DD_HHMMSS_XXXX` (date_time_random4)

---

### Workspace Management

```typescript
import {
  createTempWorkspace,
  applyChanges,
  getDiff,
  getModifiedFiles,
  createNellaDir,
  writeArtifacts,
  cleanupTempWorkspace
} from '@usenella/core';
```

#### `createTempWorkspace(sourcePath) → string`

Create a temporary copy of a workspace for isolated testing.

```typescript
const tempDir = createTempWorkspace('/path/to/repo');
// '/tmp/nella-abc123'

// The copy excludes node_modules, .git, and .nella for speed
```

#### `applyChanges(workspacePath, changes) → string[]`

Apply file changes to a workspace.

```typescript
const modified = applyChanges(tempDir, [
  { path: 'src/users.ts', operation: 'modify', content: '...' },
  { path: 'src/new.ts', operation: 'create', content: '...' },
  { path: 'src/old.ts', operation: 'delete', content: '' }
]);
```

#### `getDiff(workspacePath) → string`

Get git diff of uncommitted changes.

#### `getModifiedFiles(workspacePath) → string[]`

Get list of modified files from git status.

#### `createNellaDir(workspacePath, runId) → string`

Create the `.nella/runs/{runId}` directory structure.

#### `writeArtifacts(runDir, diff, metrics) → Artifacts`

Write run artifacts (diff.patch, metrics.json).

#### `cleanupTempWorkspace(tempPath) → void`

Remove a temporary workspace.

---

## Context Tracking

Context tracking keeps a persistent session across runs to detect dependency drift and assumption conflicts.

```typescript
import {
  ContextManager,
  SessionStore,
  DependencyTracker,
  AssumptionTracker,
  ChangeLedger
} from '@usenella/core';
```

### `ContextManager`

High-level coordinator for session tracking.

```typescript
const manager = new ContextManager('/path/to/repo');
const summary = manager.getSummary();
```

### `SessionStore`

Load and persist session data to disk.

```typescript
const store = new SessionStore('/path/to/repo');
const session = store.loadOrCreate();
```

### `DependencyTracker`

Snapshot dependencies and detect changes between runs.

```typescript
const diff = manager.checkDependencies('/path/to/repo');
```

### `AssumptionTracker`

Record assumptions and detect conflicts with planned changes.

```typescript
const conflicts = manager.assumptions.getConflicts(['src/users.ts']);
```

### `ChangeLedger`

Store file change history across runs.

## Advanced Module APIs

The following modules are documented in detail below. See also the [Core Modules Guide](./modules.md) for setup and usage examples.

---

## Indexing & RAG

```typescript
import {
  IndexManager,
  createIndexManager,
  Chunker,
  Embedder,
  VectorStore,
  LexicalIndex,
  HybridSearcher,
  CodeVerifier
} from '@usenella/core';
```

### `IndexManager`

Manages incremental code indexing with hybrid search (vector + lexical).

```typescript
const manager = createIndexManager({
  embedder: 'voyage-code-2',   // 'voyage-code-2' | 'openai' | 'local'
  dimensions: 1536,
  chunkStrategy: 'ast'         // AST-based code chunking
});

// Index a workspace (incremental — skips unchanged files)
await manager.index('/path/to/repo');

// Search the index
const results = await manager.search('user authentication middleware');

// Verify code against the index
const verification = await manager.verify(codeSnippet);
```

**Methods:**

| Method | Description |
|--------|-------------|
| `index(repoPath)` | Incrementally index a workspace |
| `search(query, options?)` | Hybrid search (vector + lexical with RRF fusion) |
| `verify(code)` | Verify code imports/symbols against indexed codebase |

### `Chunker`

AST-based code chunking that respects function/class boundaries.

### `Embedder`

Embedding provider with support for:
- **Voyage-code-2** (default) — optimized for code
- **OpenAI** — text-embedding-ada-002 / text-embedding-3-small
- **Local ONNX** — offline-capable

### `VectorStore`

In-memory vector store with JSON persistence for embeddings.

### `LexicalIndex`

BM25-based lexical index for keyword search.

### `HybridSearcher`

Combines vector and lexical search using Reciprocal Rank Fusion (RRF).

- Default weights: 0.4 vector / 0.6 lexical
- Fusion constant k=60
- Optional Cohere reranking

### `CodeVerifier`

Verifies generated code against the indexed codebase:
- **Import verification** — checks that imported modules exist
- **Symbol verification** — checks that referenced symbols are exported
- **API verification** — checks function signatures and types

```typescript
const verifier = new CodeVerifier(indexManager);
const result = await verifier.verify({
  code: agentGeneratedCode,
  filePath: 'src/users.ts'
});

console.log(result.issues); // VerifyIssue[]
```

---

## Workspace Management

```typescript
import {
  WorkspaceRegistry,
  Workspace,
  WorkspaceSwitcher,
  FileLock,
  RegistryBackupManager,
  RegistryMigrationManager,
  WorkspaceValidator,
  FileWatcher,
  LRUCache
} from '@usenella/core';
```

### `WorkspaceRegistry`

Multi-workspace management with CRUD operations and persistence to `workspaces.json`.

```typescript
const registry = new WorkspaceRegistry();

// Register a workspace
const ws = await registry.register('/path/to/project', { name: 'my-project' });

// List all workspaces
const all = registry.list();

// Get by path
const found = registry.get('/path/to/project');

// Remove a workspace
registry.remove(ws.id);
```

### `Workspace`

Individual workspace with integrated indexing, context, and file watching.

```typescript
const workspace = new Workspace('/path/to/project');

// Get workspace status
const status = workspace.getStatus();

// Start file watching
workspace.startWatching();
workspace.stopWatching();
```

### `WorkspaceSwitcher`

Switch the active workspace in multi-workspace environments.

### `FileLock`

Concurrent file access safety with lock/unlock operations.

### `RegistryBackupManager`

Automatic backup and restore for the workspace registry.

### `RegistryMigrationManager`

Schema migration for workspace registry data across versions.

### `WorkspaceValidator`

Integrity checks for workspace configuration and state.

### `FileWatcher`

Debounced file change detection for triggering re-indexing.

### `LRUCache`

Memory-bounded LRU cache for workspace data.

---

## Auth

```typescript
import {
  KeyManager,
  AgentManager,
  Authenticator,
  TokenManager,
  AuditLogManager,
  IPFilter,
  RequestSigner
} from '@usenella/core';
```

### `KeyManager`

CRUD for API keys with permissions, rate limits, expiry, and revocation.

```typescript
const keyManager = new KeyManager(store);

// Create a key
const key = await keyManager.create({
  name: 'production-key',
  permissions: ['read', 'write', 'admin'],
  rateLimit: { maxRequests: 1000, windowMs: 60000 },
  expiresAt: new Date('2026-12-31')
});

// Validate a key
const valid = await keyManager.validate('nella_abc123...');

// Revoke a key
await keyManager.revoke(key.id);

// List all keys
const keys = await keyManager.list();
```

### `AgentManager`

Manage registered AI agents.

```typescript
const agentManager = new AgentManager(store);

// Register an agent
const agent = await agentManager.register({
  name: 'my-claude',
  type: 'copilot', // 'copilot' | 'cursor' | 'cline' | 'aider' | 'continue' | 'custom'
  apiKeyId: key.id
});

// List agents
const agents = await agentManager.list();
```

### `Authenticator`

Validates API keys, checks permissions, and enforces rate limits.

```typescript
const auth = new Authenticator(keyManager, rateLimiter);

const result = await auth.authenticate(request);
if (!result.authenticated) {
  console.log('Denied:', result.reason);
}
```

### `TokenManager`

JWT token creation and verification.

```typescript
const tokenManager = new TokenManager(secret);

// Create a token
const token = tokenManager.create({ userId: '123', permissions: ['read'] });

// Verify a token
const payload = tokenManager.verify(token);
```

### `AuditLogManager`

Full audit trail of all auth operations.

```typescript
const audit = new AuditLogManager(store);

audit.log({
  action: 'key.created',
  userId: '123',
  details: { keyName: 'production-key' }
});

const entries = await audit.query({ action: 'key.created', limit: 50 });
```

### `IPFilter`

IP-based access control with allow/deny lists.

```typescript
const filter = new IPFilter({
  allowList: ['192.168.1.0/24'],
  denyList: ['10.0.0.1']
});

const allowed = filter.check('192.168.1.100'); // true
```

### `RequestSigner`

HMAC request signing for secure API communication.

```typescript
const signer = new RequestSigner(secret);

// Sign a request
const signature = signer.sign({ method: 'POST', path: '/api/validate', body });

// Verify a signature
const valid = signer.verify(request, signature);
```

---

## Rate Limiting

```typescript
import {
  RateLimiter,
  MemoryBackend,
  RedisBackend,
  SQLiteBackend,
  SlidingWindowAlgorithm,
  TokenBucketAlgorithm,
  PriorityHandler,
  DynamicLimitAdjuster
} from '@usenella/core';
```

### `RateLimiter`

Main rate limiter with pluggable backend and algorithm.

```typescript
// In-memory (default)
const limiter = new RateLimiter({
  backend: new MemoryBackend(),
  algorithm: new SlidingWindowAlgorithm(),
  maxRequests: 100,
  windowMs: 60000
});

// Redis-backed (production)
const limiter = new RateLimiter({
  backend: new RedisBackend('redis://localhost:6379'),
  algorithm: new TokenBucketAlgorithm({ refillRate: 10, capacity: 100 }),
  maxRequests: 1000,
  windowMs: 60000
});

// Check rate limit
const result = await limiter.check('user-123');
if (!result.allowed) {
  console.log('Rate limited. Retry after:', result.retryAfterMs);
}
```

### Backends

| Backend | Use Case | Persistence |
|---------|----------|-------------|
| `MemoryBackend` | Development, single-process | In-memory (lost on restart) |
| `RedisBackend` | Production, multi-process | Redis (persistent) |
| `SQLiteBackend` | Single-server production | SQLite file (persistent) |

### Algorithms

| Algorithm | Description |
|-----------|-------------|
| `SlidingWindowAlgorithm` | Sliding window counter with smooth rate limiting |
| `TokenBucketAlgorithm` | Token bucket with configurable refill rate and capacity |

### `PriorityHandler`

Priority-based request handling.

```typescript
const handler = new PriorityHandler(limiter);

// Requests with higher priority get through first
const result = await handler.handle(request, 'critical');
// Priority levels: 'critical' | 'high' | 'normal' | 'low'
```

### `DynamicLimitAdjuster`

Adaptive rate limits with graceful degradation.

```typescript
const adjuster = new DynamicLimitAdjuster(limiter, {
  degradation: {
    enabled: true,
    thresholds: [
      { load: 0.8, reduction: 0.2 },  // At 80% load, reduce limits by 20%
      { load: 0.95, reduction: 0.5 }   // At 95% load, reduce by 50%
    ]
  }
});

// Adjust limits based on current system load
await adjuster.adjust();
```

---

## Context Sharing

```typescript
import {
  SharedContextManager,
  LocalTransport,
  SupabaseTransport
} from '@usenella/core';
```

### `SharedContextManager`

Cross-agent context sharing with versioning, encryption, and channels.

```typescript
const shared = new SharedContextManager({
  transport: new LocalTransport('/path/to/.nella/shared'),
  encryption: true
});

// Share context
await shared.set({
  key: 'auth-approach',
  value: { strategy: 'JWT', library: 'jsonwebtoken' },
  type: 'decision',
  visibility: 'workspace',
  channel: 'architecture'
});

// Get shared context
const entry = await shared.get('auth-approach');

// List all context in a channel
const entries = await shared.list({ channel: 'architecture' });
```

**Context Types:** `decision`, `snippet`, `schema`, `api`, `config`, `dependency`, `test`, `error`, `note`, `reference`

**Visibility Levels:** `private`, `workspace`, `shared`, `global`

### Transports

| Transport | Description |
|-----------|-------------|
| `LocalTransport` | File-based, no network required |
| `SupabaseTransport` | Supabase-backed with real-time sync |

---

## Sync

```typescript
import {
  SyncManager,
  LocalSyncAdapter,
  SupabaseSyncAdapter,
  GCPSyncAdapter,
  WorkspaceCloudSyncManager
} from '@usenella/core';
```

### `SyncManager`

Unified sync with auto-fallback across tiers: local → Supabase → GCP.

```typescript
const sync = new SyncManager({
  adapters: [
    new LocalSyncAdapter('/path/to/.nella'),
    new SupabaseSyncAdapter({ url: SUPABASE_URL, key: SUPABASE_KEY }),
    new GCPSyncAdapter({ projectId: 'my-project' })
  ]
});

// Sync workspace state
await sync.push(workspaceState);
const state = await sync.pull();
```

### `WorkspaceCloudSyncManager`

Advanced cloud sync engine with:
- **Delta chunking** — Only sync changed blocks
- **AES-256-GCM encryption** — End-to-end encryption at rest
- **Gzip compression** — Bandwidth optimization
- **Bandwidth throttling** — Configurable throughput limits
- **Offline queue** — Queue operations when disconnected
- **Conflict resolution** — 4 strategies: `last-write-wins`, `merge`, `manual`, `server-wins`

```typescript
const cloudSync = new WorkspaceCloudSyncManager({
  encryption: { enabled: true, key: process.env.SYNC_KEY },
  compression: true,
  bandwidth: { maxBytesPerSecond: 1048576 },
  conflictStrategy: 'merge'
});
```

### Adapters

| Adapter | Backend | Description |
|---------|---------|-------------|
| `LocalSyncAdapter` | JSON files | Default, no setup required |
| `SupabaseSyncAdapter` | PostgreSQL + pgvector | Cloud sync with real-time |
| `GCPSyncAdapter` | Cloud SQL + Cloud Storage | Enterprise deployments |

> **Note:** The `cloud-sync/` module (`CloudSyncManager`) is deprecated. Use `SyncManager` from the `sync/` module instead.

---

## MCP Tools

```typescript
import { McpToolHandler, NELLA_TOOLS, createMcpToolHandler } from '@usenella/core';
```

### `McpToolHandler`

Routes MCP tool calls with authentication and rate limiting.

```typescript
const handler = createMcpToolHandler({
  workspace: '/path/to/repo',
  auth: authenticator,
  rateLimiter: limiter
});

const result = await handler.handle('nella_search', { query: 'user auth' });
```

### `NELLA_TOOLS` (Core-Level — 6 tools)

| Tool | Description |
|------|-------------|
| `nella_search` | Search indexed codebase (hybrid vector + lexical) |
| `nella_verify` | Verify code against indexed codebase |
| `nella_index` | Index or re-index the workspace |
| `nella_get_context` | Get shared context entries |
| `nella_set_context` | Set shared context entries |
| `nella_status` | Get server/workspace status |

These are the core-level tools. The `@getnella/mcp` package exposes an additional 12 tools (validation, safety, context) — see the [MCP Tools Reference](../mcp/tools.md).

---

## Playground

```typescript
import { PlaygroundServer, createPlaygroundServer } from '@usenella/core';
```

### `PlaygroundServer`

WebSocket + HTTP server for real-time agent debugging.

```typescript
const server = createPlaygroundServer({
  port: 3847,
  host: 'localhost'
});

await server.start();
```

**Features:**
- Real-time session tracking via WebSocket
- Chain-of-thought visualization
- Tool call history and timing
- Token usage and cost tracking
- HTML dashboard at `http://localhost:3847`
- WebSocket endpoint at `ws://localhost:3847/ws`

Default port: `3847`

---

## Agents

```typescript
import {
  AgentRunner,
  AgentAdapter,
  AnthropicAdapter,
  OpenAIAdapter,
  createAgentAdapter,
  MODEL_PRICING
} from '@usenella/core';
```

### `AgentRunner`

Tool-use loop runner for multi-turn agent conversations.

```typescript
const adapter = createAgentAdapter({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: process.env.ANTHROPIC_API_KEY
});

const runner = new AgentRunner(adapter, {
  maxIterations: 10,
  tools: nellaTools
});

const result = await runner.run({
  prompt: 'Add a GET /users/:id endpoint',
  systemPrompt: 'You are a coding assistant.'
});

console.log(result.response);
console.log(result.toolCalls);
console.log(result.tokenUsage);
console.log(result.cost);
```

### `AgentAdapter`

Base adapter class. Extended by provider-specific adapters.

### `AnthropicAdapter`

Claude API integration (Claude Sonnet 4, Claude Opus 4).

### `OpenAIAdapter`

OpenAI API integration (GPT-4 Turbo, GPT-4o, GPT-4o-mini).

### `createAgentAdapter(config) → AgentAdapter`

Factory function to create the right adapter.

```typescript
const adapter = createAgentAdapter({
  provider: 'openai',           // 'anthropic' | 'openai'
  model: 'gpt-4o',
  apiKey: process.env.AZURE_EMBEDDING_API_KEY,
  endpoint: process.env.AZURE_ENDPOINT
});
```

### `MODEL_PRICING`

Cost per token for supported models.

```typescript
const pricing = MODEL_PRICING['claude-sonnet-4-20250514'];
// { inputPer1k: 0.003, outputPer1k: 0.015 }
```

**Supported Models:**

| Model | Provider |
|-------|----------|
| `claude-sonnet-4-20250514` | Anthropic |
| `claude-opus-4-20250514` | Anthropic |
| `gpt-4-turbo` | OpenAI |
| `gpt-4o` | OpenAI |
| `gpt-4o-mini` | OpenAI |
