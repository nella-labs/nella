# Types Reference

Complete type definitions for `@usenella/core`.

## Table of Contents

- [Task Types](#task-types)
- [Result Types](#result-types)
- [Agent Types](#agent-types)
- [Context Types](#context-types)
- [Indexing Types](#indexing-types)
- [Auth Types](#auth-types)
- [Rate Limiting Types](#rate-limiting-types)
- [Context Sharing Types](#context-sharing-types)
- [Sync Types](#sync-types)
- [Workspace Types](#workspace-types)
- [Export Types](#export-types)
- [Playground Types](#playground-types)
- [Agent Runner Types](#agent-runner-types)

---

## Task Types

```typescript
import type {
  Task,
  TaskCategory,
  TaskDifficulty,
  Constraint,
  ValidationConfig,
  ExpectedChanges,
  RawTaskYaml
} from '@usenella/core';
```

### `Task`

Main task definition interface.

```typescript
interface Task {
  id: string;                      // Unique identifier
  name: string;                    // Human-readable name
  prompt: string;                  // Prompt given to agent
  category: TaskCategory;          // 'feature' | 'bug-fix' | 'refactor' | 'edge-case' | 'refusal'
  difficulty: TaskDifficulty;      // 'easy' | 'medium' | 'hard'
  fixture: string;                 // Target repo/fixture name
  constraints: Constraint[];       // Rules agent must follow
  validation: ValidationConfig;    // Test/lint/compile commands
  expected: ExpectedChanges;       // Expected file modifications
  refusalExpected?: boolean;       // Should agent refuse?
  refusalPatterns?: string[];      // Patterns indicating correct refusal
  timeoutSeconds?: number;         // Time limit
}
```

### `TaskCategory`

```typescript
type TaskCategory =
  | 'feature'     // New functionality
  | 'bug-fix'     // Fix existing bug
  | 'refactor'    // Code improvement
  | 'edge-case'   // Handle edge cases
  | 'refusal';    // Task agent should refuse
```

### `TaskDifficulty`

```typescript
type TaskDifficulty = 'easy' | 'medium' | 'hard';
```

### `Constraint`

Constraint rule definition.

```typescript
interface Constraint {
  id: string;                      // Constraint identifier
  description: string;             // Human-readable description
  rule: string;                    // Rule statement
  filesNotToModify?: string[];     // Glob patterns for forbidden files
  forbiddenPatterns?: string[];    // Regex patterns forbidden in diffs
}
```

**Example:**
```typescript
const constraint: Constraint = {
  id: 'no-auth-changes',
  description: 'Do not modify authentication logic',
  rule: 'Files in src/auth/ must not be touched',
  filesNotToModify: ['src/auth/**', 'src/middlewares/auth*.ts'],
  forbiddenPatterns: ['password\\s*=', 'token\\s*=']
};
```

### `ValidationConfig`

```typescript
interface ValidationConfig {
  test?: string;      // e.g., 'npm run test'
  lint?: string;      // e.g., 'npm run lint'
  compile?: string;   // e.g., 'npm run check:types'
}
```

### `ExpectedChanges`

```typescript
interface ExpectedChanges {
  filesToModify: string[];         // Files that should be modified
  filesToIgnore: string[];         // Files to ignore in scope analysis
  expectedLineCount?: number;      // Approximate lines expected to change
}
```

### `RawTaskYaml`

Raw YAML structure before transformation (snake_case).

```typescript
interface RawTaskYaml {
  id: string;
  name: string;
  prompt: string;
  category: string;
  difficulty: string;
  fixture: string;
  constraints?: Array<{
    id: string;
    description: string;
    rule: string;
    files_not_to_modify?: string[];
    forbidden_patterns?: string[];
  }>;
  validation?: {
    test?: string;
    lint?: string;
    compile?: string;
  };
  expected?: {
    files_to_modify?: string[];
    files_to_ignore?: string[];
    expected_line_count?: number;
  };
  refusal_expected?: boolean;
  refusal_patterns?: string[];
  timeout_seconds?: number;
}
```

---

## Result Types

```typescript
import type {
  RunResult,
  RunResultWithContext,
  CommandResult,
  ValidationResult,
  ConstraintResult,
  RefusalResult,
  ScopeResult,
  Metrics,
  Artifacts,
  Plan,
  PlanStep,
  AssumptionConflict,
  DependencyDiff,
  LogEntry,
  LogEntryType
} from '@usenella/core';
```

### `RunResult`

Complete result of a task run — the main output of Core.

```typescript
interface RunResult {
  runId: string;                   // Unique run identifier
  timestamp: string;               // ISO timestamp
  taskId: string;                  // Task that was executed
  plan: Plan | null;               // Agent's declared plan
  constraints: ConstraintResult[]; // Constraint check results
  refusal: RefusalResult | null;   // Refusal result
  validation: ValidationResult | null;  // Test/lint/compile results
  scope: ScopeResult | null;       // Scope analysis
  metrics: Metrics;                // Computed metrics
  passed: boolean;                 // Overall pass/fail
  artifacts: Artifacts | null;     // Generated artifact paths
  errors: string[];                // Any errors that occurred
}
```

### `RunResultWithContext`

Extended run result when context tracking is enabled.

```typescript
interface RunResultWithContext extends RunResult {
  dependencyChanges?: DependencyDiff | null;
  invalidatedAssumptions?: number;
  assumptionConflicts?: AssumptionConflict[];
  contextSummary?: string;
}
```

### `CommandResult`

Result of running a single command.

```typescript
interface CommandResult {
  command: string;      // The command executed
  success: boolean;     // Exit code === 0
  output: string;       // Combined stdout + stderr
  exitCode: number;     // Process exit code
  durationMs: number;   // Execution time in ms
}
```

### `ValidationResult`

Results from running validation commands.

```typescript
interface ValidationResult {
  test: CommandResult | null;      // Test command result
  lint: CommandResult | null;      // Lint command result
  compile: CommandResult | null;   // Compile/typecheck result
  allPassed: boolean;              // All configured validations passed
}
```

### `ConstraintResult`

Result of checking a single constraint.

```typescript
interface ConstraintResult {
  id: string;                      // Constraint ID
  passed: boolean;                 // Whether constraint passed
  violationDetails?: string;       // Details if failed
}
```

### `RefusalResult`

Result of refusal detection.

```typescript
interface RefusalResult {
  shouldRefuse: boolean;           // Whether to block execution
  reason: string;                  // Reason for refusal
  patternsMatched: string[];       // Risk patterns matched
  confidence: number;              // Confidence level (0-1)
}
```

### `ScopeResult`

Result of scope creep detection.

```typescript
interface ScopeResult {
  expectedFiles: string[];         // Files expected to be modified
  actualFiles: string[];           // Files actually modified
  extraFiles: string[];            // Modified but not expected
  missingFiles: string[];          // Expected but not modified
  scopeCreepRatio: number;         // extraFiles.length / expectedFiles.length
}
```

### `Plan`

Agent's declared execution plan.

```typescript
interface Plan {
  summary: string;                 // Summary of intent
  steps: PlanStep[];               // Steps to execute
  filesToModify: string[];         // Files that will be modified
  packagesAdded: string[];         // Packages to be added
  riskLevel: 'low' | 'medium' | 'high';
}
```

### `PlanStep`

A single step in the execution plan.

```typescript
interface PlanStep {
  file: string;                    // File to be modified
  action: 'create' | 'modify' | 'delete';
  reason: string;                  // Reason for this change
}
```

### `Metrics`

Computed quality metrics.

```typescript
interface Metrics {
  scopeCreep: number;              // Extra files / expected files
  constraintViolations: number;    // Count of violated constraints
  validationIntegrity: number;     // Ratio of validations passed (0-1)
  refusalCorrectness: boolean | null;  // null if not a refusal task
}
```

### `Artifacts`

Paths to generated artifacts.

```typescript
interface Artifacts {
  diffPath: string;    // Path to diff.patch
  logsPath: string;    // Path to logs.jsonl
  metricsPath: string; // Path to metrics.json
  runDir: string;      // Run directory path
}
```

### `LogEntry`

A single log entry in the run record.

```typescript
interface LogEntry {
  ts: string;                      // ISO timestamp
  type: LogEntryType;              // Entry type
  data: Record<string, unknown>;   // Entry data
}
```

### `LogEntryType`

```typescript
type LogEntryType =
  | 'plan'
  | 'refusal'
  | 'constraint_check'
  | 'validation'
  | 'scope_check'
  | 'metrics'
  | 'error'
  | 'dependency_change'
  | 'assumption_conflict'
  | 'assumptions_invalidated';
```

---

## Agent Types

```typescript
import type {
  FileChange,
  AgentResponse,
  Changes
} from '@usenella/core';
```

### `FileChange`

A file change proposed by an agent.

```typescript
interface FileChange {
  path: string;                           // Relative path from repo root
  operation: 'create' | 'modify' | 'delete';
  content: string;                        // New content (empty for delete)
}
```

**Example:**
```typescript
const changes: FileChange[] = [
  { path: 'src/users.ts', operation: 'modify', content: '/* new content */' },
  { path: 'src/new-file.ts', operation: 'create', content: 'export const x = 1;' },
  { path: 'src/old-file.ts', operation: 'delete', content: '' }
];
```

### `AgentResponse`

Structured response from an agent.

```typescript
interface AgentResponse {
  action: 'edit' | 'refuse';       // Whether agent edited or refused
  files: FileChange[];             // Files to change (empty for refuse)
  explanation: string;             // Agent's explanation/reasoning
  reason?: string;                 // Reason for refusal (if action is refuse)
}
```

### `Changes`

Input for validation.

```typescript
interface Changes {
  files: FileChange[];             // Files that were modified
  diff?: string;                   // Git diff (optional, computed if missing)
}
```

---

## Context Types

```typescript
import type {
  Session,
  SessionMetadata,
  ChangeRecord,
  FileChangeHistory,
  Assumption,
  AssumptionType,
  AssumptionCheckResult,
  AssumptionConflict,
  DependencySnapshot,
  DependencyDiff
} from '@usenella/core';
```

### `Session`

```typescript
interface Session {
  id: string;
  startedAt: string;
  repoPath: string;
  changes: ChangeRecord[];
  assumptions: Assumption[];
  dependencySnapshot: DependencySnapshot | null;
  metadata: SessionMetadata;
}
```

### `ChangeRecord`

```typescript
interface ChangeRecord {
  id: string;
  timestamp: string;
  runId: string;
  file: string;
  operation: "create" | "modify" | "delete";
  reason: string;
  dependsOn: string[];
  assumptionIds: string[];
  contentHash?: string;
}
```

### `Assumption`

```typescript
interface Assumption {
  id: string;
  createdAt: string;
  description: string;
  type: AssumptionType;
  relatedFiles: string[];
  valid: boolean;
  invalidatedAt?: string;
  invalidatedBy?: string;
  invalidationReason?: string;
  confidence: number;
}
```

### `DependencyDiff`

```typescript
interface DependencyDiff {
  hasChanges: boolean;
  changes: Array<{
    name: string;
    from?: string;
    to?: string;
    type: "added" | "removed" | "updated";
  }>;
}
```

---

## Indexing Types

```typescript
import type {
  CodeChunk,
  ChunkType,
  CodeSymbol,
  SearchQuery,
  SearchFilter,
  SearchResponse,
  SearchResult,
  VerifyCodeRequest,
  VerifyCodeResult,
  VerifyIssue,
  IndexConfig
} from '@usenella/core';
```

### `CodeChunk`

A chunk of code produced by the AST-based chunker.

```typescript
interface CodeChunk {
  id: string;                      // Unique chunk identifier
  filePath: string;                // Source file path
  content: string;                 // Chunk content
  type: ChunkType;                 // Type of code element
  name: string;                    // Symbol name (function, class, etc.)
  startLine: number;               // Start line in source file
  endLine: number;                 // End line in source file
  symbols: CodeSymbol[];           // Symbols defined in chunk
  embedding?: number[];            // Vector embedding (if computed)
}
```

### `ChunkType`

```typescript
type ChunkType =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'import'
  | 'export'
  | 'module'
  | 'other';
```

### `CodeSymbol`

```typescript
interface CodeSymbol {
  name: string;                    // Symbol name
  kind: string;                    // Symbol kind (function, class, etc.)
  exported: boolean;               // Whether the symbol is exported
  filePath: string;                // File where symbol is defined
  line: number;                    // Line number
}
```

### `SearchQuery`

```typescript
interface SearchQuery {
  query: string;                   // Search text
  filter?: SearchFilter;           // Optional filter criteria
  limit?: number;                  // Max results (default: 10)
  hybrid?: boolean;                // Use hybrid search (default: true)
}
```

### `SearchFilter`

```typescript
interface SearchFilter {
  filePatterns?: string[];         // Glob patterns to include
  excludePatterns?: string[];      // Glob patterns to exclude
  chunkTypes?: ChunkType[];        // Filter by chunk type
  minScore?: number;               // Minimum relevance score
}
```

### `SearchResponse`

```typescript
interface SearchResponse {
  results: SearchResult[];
  totalCount: number;
  queryTimeMs: number;
}
```

### `VerifyCodeRequest`

```typescript
interface VerifyCodeRequest {
  code: string;                    // Code to verify
  filePath?: string;               // File context
  checkImports?: boolean;          // Verify imports exist
  checkSymbols?: boolean;          // Verify symbols exist
  checkAPIs?: boolean;             // Verify API signatures
}
```

### `VerifyCodeResult`

```typescript
interface VerifyCodeResult {
  valid: boolean;                  // Overall validity
  issues: VerifyIssue[];           // List of issues found
  checkedImports: number;          // Number of imports checked
  checkedSymbols: number;          // Number of symbols checked
}
```

### `VerifyIssue`

```typescript
interface VerifyIssue {
  type: 'missing-import' | 'missing-symbol' | 'wrong-signature' | 'deprecated';
  message: string;
  line?: number;
  suggestion?: string;
}
```

### `DEFAULT_INDEX_CONFIG`

```typescript
const DEFAULT_INDEX_CONFIG: IndexConfig = {
  embedder: 'voyage-code-2',
  dimensions: 1536,
  chunkStrategy: 'ast',
  hybridWeights: { vector: 0.4, lexical: 0.6 },
  fusionK: 60,
  reranker: 'cohere'
};
```

---

## Auth Types

```typescript
import type {
  ApiKey,
  ApiKeyPermission,
  AgentConfig,
  AgentType,
  AuditEntry,
  TokenPayload
} from '@usenella/core';
```

### `ApiKey`

```typescript
interface ApiKey {
  id: string;
  name: string;
  key: string;                     // Prefixed with 'nella_'
  permissions: ApiKeyPermission[];
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };
  expiresAt?: Date;
  revoked: boolean;
  createdAt: string;
  lastUsedAt?: string;
}
```

### `ApiKeyPermission`

```typescript
type ApiKeyPermission = 'read' | 'write' | 'admin';
```

### `AgentConfig`

```typescript
interface AgentConfig {
  id: string;
  name: string;
  type: AgentType;
  apiKeyId: string;
  metadata?: Record<string, unknown>;
}
```

### `AgentType`

```typescript
type AgentType = 'copilot' | 'cursor' | 'cline' | 'aider' | 'continue' | 'custom';
```

### `AuditEntry`

```typescript
interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  userId?: string;
  apiKeyId?: string;
  details: Record<string, unknown>;
  ip?: string;
}
```

### `TokenPayload`

```typescript
interface TokenPayload {
  userId: string;
  permissions: ApiKeyPermission[];
  exp: number;                     // Expiry timestamp
  iat: number;                     // Issued at timestamp
}
```

---

## Rate Limiting Types

```typescript
import type {
  RateLimitConfig,
  RateLimitResult,
  PriorityLevel,
  GracefulDegradationConfig
} from '@usenella/core';
```

### `RateLimitConfig`

```typescript
interface RateLimitConfig {
  maxRequests: number;             // Maximum requests per window
  windowMs: number;                // Window size in milliseconds
  backend: 'memory' | 'redis' | 'sqlite';
  algorithm: 'sliding-window' | 'token-bucket';
}
```

### `RateLimitResult`

```typescript
interface RateLimitResult {
  allowed: boolean;                // Whether the request is allowed
  remaining: number;               // Remaining requests in window
  resetMs: number;                 // Time until window reset (ms)
  retryAfterMs?: number;           // Time to wait before retrying
}
```

### `PriorityLevel`

```typescript
type PriorityLevel = 'critical' | 'high' | 'normal' | 'low';
```

### `GracefulDegradationConfig`

```typescript
interface GracefulDegradationConfig {
  enabled: boolean;
  thresholds: Array<{
    load: number;                  // Load threshold (0.0-1.0)
    reduction: number;             // Limit reduction factor (0.0-1.0)
  }>;
}
```

---

## Context Sharing Types

```typescript
import type {
  ContextEntry,
  ContextType,
  ContextVisibility,
  ContextChannel
} from '@usenella/core';
```

### `ContextEntry`

```typescript
interface ContextEntry {
  key: string;                     // Unique key
  value: unknown;                  // Context data
  type: ContextType;               // Entry type
  visibility: ContextVisibility;   // Access scope
  channel?: string;                // Optional channel for grouping
  etag?: string;                   // Version tag for conflict detection
  encrypted?: boolean;             // Whether value is encrypted
  createdAt: string;
  updatedAt: string;
  createdBy?: string;              // Agent/user ID
}
```

### `ContextType`

```typescript
type ContextType =
  | 'decision'      // Architectural decisions
  | 'snippet'       // Code snippets
  | 'schema'        // Schema information
  | 'api'           // API definitions
  | 'config'        // Configuration values
  | 'dependency'    // Dependency information
  | 'test'          // Test-related context
  | 'error'         // Error patterns
  | 'note'          // General notes
  | 'reference';    // External references
```

### `ContextVisibility`

```typescript
type ContextVisibility =
  | 'private'       // Only the creating agent
  | 'workspace'     // All agents in the workspace
  | 'shared'        // Explicitly shared agents
  | 'global';       // All agents everywhere
```

### `ContextChannel`

```typescript
interface ContextChannel {
  name: string;
  description?: string;
  subscribers: string[];           // Agent/user IDs
}
```

---

## Sync Types

```typescript
import type {
  SyncTier,
  SyncConfig,
  ConflictStrategy,
  SyncState
} from '@usenella/core';
```

### `SyncTier`

```typescript
type SyncTier = 'local' | 'supabase' | 'gcp';
```

### `SyncConfig`

```typescript
interface SyncConfig {
  tiers: SyncTier[];               // Ordered list (auto-fallback)
  encryption?: {
    enabled: boolean;
    key?: string;                  // AES-256-GCM key
  };
  compression?: boolean;           // Gzip compression
  bandwidth?: {
    maxBytesPerSecond: number;
  };
  conflictStrategy: ConflictStrategy;
}
```

### `ConflictStrategy`

```typescript
type ConflictStrategy =
  | 'last-write-wins'
  | 'merge'
  | 'manual'
  | 'server-wins';
```

### `SyncState`

```typescript
interface SyncState {
  lastSyncAt: string;
  pendingChanges: number;
  offlineQueue: number;
  currentTier: SyncTier;
}
```

---

## Workspace Types

```typescript
import type {
  WorkspaceConfig,
  WorkspaceState,
  WorkspaceInfo
} from '@usenella/core';
```

### `WorkspaceConfig`

```typescript
interface WorkspaceConfig {
  name?: string;
  path: string;
  indexConfig?: IndexConfig;
  syncConfig?: SyncConfig;
  watchEnabled?: boolean;
}
```

### `WorkspaceState`

```typescript
interface WorkspaceState {
  id: string;
  path: string;
  name: string;
  indexed: boolean;
  lastIndexedAt?: string;
  fileCount: number;
  chunkCount: number;
}
```

### `WorkspaceInfo`

```typescript
interface WorkspaceInfo {
  id: string;
  path: string;
  name: string;
  createdAt: string;
  lastAccessedAt: string;
  state: WorkspaceState;
}
```

---

## Export Types

```typescript
import type {
  ExportFormat,
  ExportOptions,
  ExportBundle
} from '@usenella/core';
```

### `ExportFormat`

```typescript
type ExportFormat = 'json' | 'csv' | 'markdown' | 'html';
```

### `ExportOptions`

```typescript
interface ExportOptions {
  format: ExportFormat;
  outputPath?: string;
  includeTimestamps?: boolean;
  includeMetrics?: boolean;
}
```

### `ExportBundle`

```typescript
interface ExportBundle {
  toolCalls: unknown[];
  searches: unknown[];
  verifications: unknown[];
  exportedAt: string;
  format: ExportFormat;
}
```

---

## Playground Types

```typescript
import type {
  PlaygroundMessage,
  PlaygroundSession,
  PlaygroundOptions
} from '@usenella/core';
```

### `PlaygroundMessage`

```typescript
interface PlaygroundMessage {
  type: 'session-start' | 'tool-call' | 'tool-result' | 'chain-of-thought' | 'cost-update' | 'session-end';
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
}
```

### `PlaygroundSession`

```typescript
interface PlaygroundSession {
  id: string;
  startedAt: string;
  endedAt?: string;
  toolCalls: number;
  tokenUsage: { input: number; output: number };
  cost: number;
}
```

### `PlaygroundOptions`

```typescript
interface PlaygroundOptions {
  port?: number;                   // Default: 3847
  host?: string;                   // Default: 'localhost'
  workspace?: string;
  repo?: string;
}
```

---

## Agent Runner Types

```typescript
import type {
  AgentAdapterConfig,
  AgentRunResult,
  ModelPricing
} from '@usenella/core';
```

### `AgentAdapterConfig`

```typescript
interface AgentAdapterConfig {
  provider: 'anthropic' | 'openai';
  model: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
}
```

### `AgentRunResult`

```typescript
interface AgentRunResult {
  response: string;
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    output: unknown;
  }>;
  iterations: number;
  tokenUsage: { input: number; output: number };
  cost: number;
  durationMs: number;
}
```

### `ModelPricing`

```typescript
interface ModelPricing {
  inputPer1k: number;              // Cost per 1K input tokens
  outputPer1k: number;             // Cost per 1K output tokens
}
```
