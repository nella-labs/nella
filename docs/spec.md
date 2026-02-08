# Nella Specification

Complete specification for the Nella reliability layer for coding agents.

> **Version:** 0.0.0  
> **Last Updated:** February 8, 2026  
> **License:** Apache-2.0

---

## Overview

Nella is a **reliability layer for coding agents** that makes agent-made code changes safer, verifiable, and auditable. It sits between AI coding agents and your codebase, enforcing behavioral contracts.

### Core Principles

1. **Agent-agnostic** — Works with any agent (Claude, GPT, etc.) via CLI, library, or MCP
2. **Defense in depth** — Multiple layers of validation (refusal, constraints, scope, tests)
3. **Structured output** — All results are machine-readable JSONL for analysis
4. **Zero trust** — Validates everything, trusts nothing from the agent

### Core Objectives

| Objective | Problem | Nella Solution | Key Components |
|-----------|---------|----------------|----------------|
| **Reduce Hallucinations** | Agents reference non-existent imports, symbols, APIs | Index the real codebase; verify generated code against it | `CodeVerifier`, `nella_verify`, `nella_search` |
| **Increase Context** | Agents lose prior decisions and assumptions across turns | Persistent session state with assumptions, change history, dependency snapshots | `ContextManager`, `SessionStore`, `ChangeLedger`, `AssumptionTracker`, `DependencyTracker` |
| **Prompt Injection Protection** | Malicious prompts trigger dangerous operations | Scan prompts for risk patterns; recommend refusal; enforce constraints | `shouldRefuse`, `detectRiskPatterns`, `RISK_PATTERNS`, `nella_detect_risks` |
| **Prevent Contradictions** | Agents contradict prior intent or generate code not grounded in codebase | Track assumptions and detect conflicts; verify symbols exist; enforce scope | `AssumptionTracker.getConflicts()`, `CodeVerifier`, `checkScope` |

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Coding Agent   │────▶│   Nella Core    │────▶│   Your Repo     │
│  (Claude, GPT)  │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │
        │                       ▼
        │               ┌─────────────────┐
        │               │  Run Records    │
        │               │  (JSONL logs)   │
        │               └─────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Integration Points                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│  @usenella/nella        CLI + MCP server (stdio & HTTP)                    │
│  @usenella/core         TypeScript library (runTask, check, validate)      │
│  @usenella/benchmark    Agent evaluation & benchmarking suite              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Packages

| Package | Purpose | Binary |
|---------|---------|--------|
| `@usenella/core` | Core validation & reliability engine | — |
| `@usenella/nella` | CLI + MCP server (local & hosted) | `nella` |
| `@usenella/benchmark` | Agent benchmarking & evaluation suite | `nella-benchmark` |

### Data Flow

1. **Agent receives task** → Parses prompt, constraints, expected changes
2. **Pre-flight check** → Nella checks for refusal conditions
3. **Agent makes changes** → Generates file modifications
4. **Changes submitted to Nella** → Via CLI, library, or MCP
5. **Nella validates** → Constraints, scope, validation commands
6. **Result returned** → Pass/fail with metrics and artifacts

---

## Core Modules

| Module | Purpose | Key Classes |
|--------|---------|-------------|
| **Validation** | Task validation pipeline | `runTask`, `check`, `validate` |
| **Validators** | Constraint & scope checking | `checkConstraints`, `checkScope`, `runValidation` |
| **Safety** | Refusal detection & risk scanning | `shouldRefuse`, `detectRiskPatterns`, `RISK_PATTERNS` |
| **Context** | Session persistence & tracking | `ContextManager`, `SessionStore`, `ChangeLedger`, `AssumptionTracker`, `DependencyTracker` |
| **Indexing/RAG** | Code indexing & hybrid search | `IndexManager`, `Chunker`, `Embedder`, `VectorStore`, `LexicalIndex`, `HybridSearcher`, `CodeVerifier` |
| **Workspace** | Multi-workspace management | `WorkspaceRegistry`, `Workspace`, `WorkspaceSwitcher`, `FileLock`, `FileWatcher` |
| **Auth** | API key management & access control | `KeyManager`, `AgentManager`, `Authenticator`, `TokenManager`, `AuditLogManager`, `IPFilter`, `RequestSigner` |
| **Rate Limiting** | Request throttling with pluggable backends | `RateLimiter`, `MemoryBackend`, `RedisBackend`, `SQLiteBackend`, `PriorityHandler`, `DynamicLimitAdjuster` |
| **Context Sharing** | Cross-agent context with channels & encryption | `SharedContextManager`, `LocalTransport`, `SupabaseTransport` |
| **Sync** | Cloud sync with delta chunking & encryption | `SyncManager`, `LocalSyncAdapter`, `SupabaseSyncAdapter`, `GCPSyncAdapter`, `WorkspaceCloudSyncManager` |
| **MCP** | MCP tool handler (core-level) | `McpToolHandler`, `NELLA_TOOLS` |
| **Export** | Export data in multiple formats | `ExportManager` |
| **Playground** | Real-time debugging dashboard | `PlaygroundServer`, `createPlaygroundServer` |
| **Agents** | Built-in LLM agent runners | `AgentRunner`, `AnthropicAdapter`, `OpenAIAdapter`, `MODEL_PRICING` |
| **GCP** | Google Cloud backend (Cloud SQL + Storage) | `GCPSyncAdapter`, pgvector search |
| **Supabase** | Supabase backend (auth, realtime, sync) | `SupabaseSyncAdapter`, `SupabaseTransport` |

---

## Task Definition

Tasks are defined in YAML files with the following schema:

```yaml
# Required fields
id: string              # Unique identifier (kebab-case)
name: string            # Human-readable name
prompt: string          # Full task prompt for the agent

# Optional categorization
category: feature | bug-fix | refactor | edge-case | refusal
difficulty: easy | medium | hard

# Fixture/repo name
fixture: string

# Constraints (what the agent must NOT do)
constraints:
  - id: string
    description: string
    rule: string
    files_not_to_modify:
      - string[]
    forbidden_patterns:
      - string[]

# Expected changes (for scope validation)
expected:
  files_to_modify:
    - string[]
  files_to_ignore:
    - string[]
  expected_line_count: number

# Validation commands
validation:
  test: string
  lint: string
  compile: string

# Refusal configuration
refusal_expected: boolean
refusal_patterns: string[]
timeout_seconds: number
```

---

## Core API

### `runTask(repoPath, task, changes?, options?) → RunResult`

Main entrypoint. Orchestrates the full validation flow.

```typescript
interface RunTaskOptions {
  skipRefusalCheck?: boolean;
  skipPrerequisites?: boolean;
  skipValidation?: boolean;
  validationTimeout?: number;
  skipArtifacts?: boolean;
  plan?: Plan;
  enableContextTracking?: boolean;
  checkDependencies?: boolean;
  checkAssumptionConflicts?: boolean;
}
```

### `check(task, workspacePath, options?) → RefusalResult`

Pre-flight check. Returns whether the task should be refused.

### `validate(task, workspacePath, changes, options?) → ValidateResult`

Validate changes without the full `runTask` flow.

---

## Context Tracking

Persistent session across runs to detect dependency drift and assumption conflicts.

```typescript
const result = await runTask('/path/to/repo', task, changes, {
  enableContextTracking: true,
  checkDependencies: true,
  checkAssumptionConflicts: true
});
```

---

## Metrics

### Core Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `scopeCreep` | number | Ratio of unexpected file changes (0.0-1.0) |
| `constraintViolations` | number | Count of violated constraints |
| `validationIntegrity` | number | Ratio of validation commands that passed (0.0-1.0) |
| `refusalCorrectness` | boolean \| null | Correctly refused (if applicable) |

### Benchmark Metrics

| Metric | Abbr | Description |
|--------|------|-------------|
| Build/Test Pass | BTP | Whether the build and tests pass after agent changes |
| Validation Integrity | VI | Ratio of passed validation commands |
| Constraint Violation Rate | CVR | Fraction of constraints violated |
| Scope Creep | SC | Ratio of unexpected file modifications |
| Refusal Correctness | RC | Whether the agent correctly refused a dangerous task |
| Time to Green | TTG | Time in seconds until first passing run |
| Iteration Count | IC | Number of agent iterations before success |
| Diff Accuracy | DA | Similarity between agent diff and reference diff |

---

## Refusal Detection

31 risk patterns across categories:
- **Credential exposure** — logging passwords, tokens, secrets
- **Security bypass** — disabling auth, skipping validation
- **Dangerous operations** — DROP TABLE, DELETE all users, rm -rf
- **Data exposure** — exposing PII, leaking API keys
- **Backdoor indicators** — hardcoded passwords, admin backdoors

16 agent response refusal patterns detect phrases like "I can't", "security risk", "not safe", etc.

---

## CLI Reference

### Commands

| Command | Description |
|---------|-------------|
| `nella check` | Pre-flight check: can the task proceed? |
| `nella validate` | Validate changes against constraints |
| `nella run` | Full run: check + validate + metrics |
| `nella mcp` | Start MCP server (stdio transport) |
| `nella serve` | Start hosted MCP server (Streamable HTTP) |
| `nella connect` | Configure MCP clients to use Nella |
| `nella auth` | Manage authentication (login/logout/status) |
| `nella playground` | Start playground server with real-time dashboard |
| `nella help` | Show help |

### Options

| Option | Short | Description |
|--------|-------|-------------|
| `--task` | `-t` | Path to task.yaml or task directory |
| `--repo` | `-r` | Path to repository |
| `--changes` | `-c` | Path to changes.json file |
| `--workspace` | `-w` | Workspace path for mcp/playground |
| `--port` | `-p` | Port for serve/playground (default: 3847) |
| `--host` | | Host for serve/playground (default: localhost) |
| `--api-key` | `-k` | API key for connect command |
| `--server-url` | `-u` | Server URL for connect (default: production) |
| `--client` | | Target MCP client: claude, vscode, or all |
| `--skip-validation` | | Skip running test/lint/compile |
| `--skip-prerequisites` | | Skip prerequisite checks |
| `--json` | | Output as JSON |

---

## MCP Tools

### Nella Package MCP Tools (12)

**Validation:** `nella_check`, `nella_validate`, `nella_run`

**Safety:** `nella_detect_risks`, `nella_should_refuse`, `nella_check_prerequisites`

**Context:** `nella_get_context`, `nella_add_assumption`, `nella_check_assumptions`, `nella_get_file_history`, `nella_check_dependencies`, `nella_record_change`

### Core MCP Tools (6)

`nella_search`, `nella_verify`, `nella_index`, `nella_get_context`, `nella_set_context`, `nella_status`

---

## Auth System

- **API Key Management** — CRUD for API keys with permissions, rate limits, expiry, revocation
- **Agent Management** — Manage agents (copilot, cursor, cline, aider, continue, custom)
- **JWT Tokens** — Token creation and verification
- **Audit Logging** — Full audit trail of operations
- **IP Filtering** — IP-based access control
- **Request Signing** — HMAC request signing
- **CLI Auth** — Browser-based login via `nella auth login`, session at `~/.nella/auth.json`

---

## Sync & Cloud

### Sync Tiers (auto-fallback)

| Tier | Backend | Description |
|------|---------|-------------|
| Local | JSON files | Default, no setup required |
| Supabase | PostgreSQL + pgvector | Cloud sync with real-time |
| GCP | Cloud SQL + Cloud Storage | Enterprise deployments |

### Cloud Sync Features

- Delta chunking, AES-256-GCM encryption, gzip compression
- Bandwidth throttling, offline queue
- Conflict resolution: last-write-wins, merge, manual, server-wins

---

## Benchmark Suite

`@usenella/benchmark` evaluates coding agents against 10 standardized tasks.

### Agent Adapters

Claude Sonnet 4, Claude Opus 4, GPT-4 Turbo, GPT-4o, GPT-4o-mini

### Nella Comparison Mode

Run benchmarks with and without Nella to measure reliability improvement.

---

## Deprecated Modules

| Module | Status | Replacement |
|--------|--------|-------------|
| `cloud-sync/` | Deprecated | Use `sync/` module instead |
