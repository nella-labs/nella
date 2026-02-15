# Core Modules

The `@usenella/core` package contains all of Nella's validation, safety, and tracking logic. This page covers the run engine, validators, context management, workspace management, and the event system.

## Module Architecture

```mermaid
graph TB
    subgraph orchestration["Orchestration"]
        run["run.ts<br/>runTask() | check() | validate()"]
    end

    subgraph validators["Validators"]
        constraint["constraint-checker.ts<br/>checkConstraints()"]
        scope["scope-checker.ts<br/>checkScope()"]
        cmdRunner["command-runner.ts<br/>runValidation()"]
    end

    subgraph safety["Safety"]
        refusal["refusal-detector.ts<br/>shouldRefuse() | detectRiskPatterns()"]
    end

    subgraph context["Context"]
        sessionStore["session-store.ts"]
        changeLedger["change-ledger.ts"]
        assumptionTracker["assumption-tracker.ts"]
        depTracker["dependency-tracker.ts"]
        ctxManager["ContextManager"]
    end

    subgraph workspace["Workspace"]
        registry["registry.ts"]
        ws["workspace.ts"]
        switcher["switcher.ts"]
        fileWatcher["file-watcher.ts"]
        fileLock["file-lock.ts"]
        backup["backup.ts"]
        migration["migration.ts"]
    end

    run --> constraint
    run --> scope
    run --> cmdRunner
    run --> refusal
    run --> ctxManager
    ctxManager --> sessionStore
    ctxManager --> changeLedger
    ctxManager --> assumptionTracker
    ctxManager --> depTracker

    style orchestration fill:#6366f1,color:#fff
    style validators fill:#8b5cf6,color:#fff
    style safety fill:#ef4444,color:#fff
    style context fill:#10b981,color:#fff
    style workspace fill:#f59e0b,color:#fff
```

## Task Execution Pipeline

Every `runTask()` call follows this sequence — from receiving the task to returning validated results:

```mermaid
sequenceDiagram
    participant C as Client (CLI/MCP)
    participant R as runTask()
    participant RF as RefusalDetector
    participant CTX as ContextManager
    participant TW as TempWorkspace
    participant CC as ConstraintChecker
    participant SC as ScopeChecker
    participant CR as CommandRunner
    participant A as ArtifactWriter

    C->>R: runTask(repoPath, task, changes, options)
    R->>R: generateRunId(), createNellaDir()

    opt Context Tracking Enabled
        R->>CTX: new ContextManager(repoPath)
        R->>CTX: checkDependencies(repoPath)
        CTX-->>R: DependencyDiff | null
        R->>CTX: getConflicts(plannedFiles)
        CTX-->>R: AssumptionConflict[]
    end

    opt Refusal Check
        R->>RF: shouldRefuse(task, repoPath)
        RF-->>R: RefusalResult
        alt Should Refuse
            R->>R: calculateMetrics(refused=true)
            R-->>C: RunResult {passed: false, refusal}
        end
    end

    alt No Changes Provided
        R->>R: calculateMetrics(check-only)
        R-->>C: RunResult {passed: true}
    end

    R->>TW: createTempWorkspace(repoPath)
    TW-->>R: tempDir
    R->>TW: applyChanges(tempDir, files)
    R->>TW: getDiff(tempDir)
    TW-->>R: diff string

    R->>CC: checkConstraints(modifiedFiles, diff, constraints)
    CC-->>R: ConstraintResult[]

    R->>SC: checkScope(modifiedFiles, expected)
    SC-->>R: ScopeResult

    opt Validation Not Skipped
        R->>CR: runValidation(test/lint/compile, tempDir)
        CR-->>R: ValidationResult
    end

    R->>R: passed = constraints OK && validation OK
    R->>R: calculateMetrics(constraints, validation, scope)

    opt Artifacts Enabled
        R->>A: writeArtifacts(runDir, diff, metrics)
    end

    opt Context Tracking & Passed
        R->>CTX: recordRunChanges(runId, changes)
        CTX-->>R: invalidated assumptions count
    end

    R->>TW: cleanupTempWorkspace(tempDir)
    R-->>C: RunResult | RunResultWithContext
```

### Pipeline Steps

1. **Run ID generation** — Creates a unique identifier and the `.nella/` working directory
2. **Context preflight** (optional) — Checks for dependency drift and assumption conflicts before proceeding
3. **Refusal check** (optional) — Scans the task description for dangerous patterns; refuses if risk is detected
4. **Workspace setup** — Clones the repo into a temp directory and applies the proposed changes
5. **Diff generation** — Computes the unified diff between original and modified files
6. **Constraint checking** — Validates against protected files, forbidden patterns, and custom constraints
7. **Scope checking** — Compares modified files against expected files to detect scope creep
8. **Validation** — Runs test/lint/compile commands in the temp workspace
9. **Metrics** — Calculates pass/fail, violation rates, scope creep ratio, and timing
10. **Context recording** (optional) — Persists changes and invalidates stale assumptions

## Context Management

The `ContextManager` orchestrates four tracking subsystems that persist across agent turns:

```mermaid
classDiagram
    class ContextManager {
        +session: SessionStore
        +changes: ChangeLedger
        +assumptions: AssumptionTracker
        +dependencies: DependencyTracker
        +getContext(limit?) AgentContext
        +getStats() ContextStats
        +checkDependencies(repoPath) DependencyDiff
        +recordRunChanges(runId, changes, checkInvalidations) Result
        +preflightCheck(plannedFiles) PreflightResult
        +getSummary() string
        +save()
        +reset()
    }

    class SessionStore {
        +id: string
        +repoPath: string
        +startedAt: string
        +runCount: number
        +getDependencySnapshot() DependencySnapshot
        +save()
    }

    class ChangeLedger {
        +records: ChangeRecord[]
        +recordChanges(runId, changes) ChangeRecord[]
        +getFileHistory(path) FileHistory
        +getHotspotFiles(limit) HotspotFile[]
        +getImpactAnalysis(files) ImpactAnalysis
    }

    class AssumptionTracker {
        +assumptions: Assumption[]
        +addAssumption(desc, files, type, confidence) Assumption
        +getValidAssumptions() Assumption[]
        +getRecentlyInvalidated(limit) Assumption[]
        +checkInvalidations(files, runId) Assumption[]
        +getConflicts(plannedFiles) AssumptionConflict[]
        +getSummary() AssumptionSummary
    }

    class DependencyTracker {
        +snapshots: DependencySnapshot[]
        +takeSnapshot(repoPath) DependencySnapshot
        +diff(repoPath) DependencyDiff
        +summarizeChanges(changes) string
    }

    ContextManager *-- SessionStore
    ContextManager *-- ChangeLedger
    ContextManager *-- AssumptionTracker
    ContextManager *-- DependencyTracker
```

| Subsystem | Purpose | Key Methods |
|-----------|---------|-------------|
| **SessionStore** | Tracks session identity, repo path, run count, and timing | `save()`, `getDependencySnapshot()` |
| **ChangeLedger** | Records every file modification with run ID, operation type, and reason | `getFileHistory()`, `getHotspotFiles()`, `getImpactAnalysis()` |
| **AssumptionTracker** | Manages assumptions with conflict detection and automatic invalidation | `addAssumption()`, `getConflicts()`, `checkInvalidations()` |
| **DependencyTracker** | Snapshots `package.json` + lockfile state and computes diffs | `takeSnapshot()`, `diff()`, `summarizeChanges()` |

### Assumption Lifecycle

Assumptions transition through three states based on file changes and agent actions:

```mermaid
stateDiagram-v2
    [*] --> Valid: addAssumption()

    Valid --> Valid: no changes to related files

    Valid --> Invalidated: related file modified
    Valid --> Invalidated: dependency changed
    Valid --> Invalidated: explicit invalidation

    Valid --> Conflicted: planned changes overlap<br/>with related files

    Conflicted --> Invalidated: changes applied

    Invalidated --> [*]: acknowledged

    state Valid {
        [*] --> Active
        Active: type, description,<br/>relatedFiles, confidence
    }

    state Invalidated {
        [*] --> Stale
        Stale: invalidationReason,<br/>invalidatedAt, invalidatedBy
    }
```

## Workspace Management

```mermaid
graph TB
    subgraph registry_layer["Registry Layer"]
        Registry["WorkspaceRegistry<br/>(workspaces.json)"]
        Backup["BackupManager<br/>(auto-backup/restore)"]
        Migration["MigrationManager<br/>(schema migration)"]
        Validator["Validator<br/>(integrity checks)"]
    end

    subgraph workspace_layer["Workspace Layer"]
        WS1["Workspace A"]
        WS2["Workspace B"]
        WS3["Workspace C"]
    end

    subgraph ws_internals["Per-Workspace Resources"]
        IdxMgr["IndexManager<br/>(chunks, vectors, symbols)"]
        SharedCtx["SharedContext<br/>(variables, snippets, preferences)"]
        FW["FileWatcher<br/>(debounced change detection)"]
        FL["FileLock<br/>(concurrent access safety)"]
    end

    Switcher["WorkspaceSwitcher<br/>(set active workspace)"]

    LRU["LRUCache<br/>(memory management)"]

    Registry --> WS1
    Registry --> WS2
    Registry --> WS3
    Registry --> Backup
    Registry --> Migration
    Registry --> Validator

    WS1 --> IdxMgr
    WS1 --> SharedCtx
    WS1 --> FW
    WS1 --> FL

    Switcher --> Registry
    IdxMgr --> LRU

    FW -->|"file changed"| IdxMgr

    style registry_layer fill:#fef3c7,stroke:#f59e0b
    style workspace_layer fill:#dbeafe,stroke:#3b82f6
    style ws_internals fill:#ede9fe,stroke:#7c3aed
    style Switcher fill:#6366f1,color:#fff
```

### Data Persistence Layout

All Nella data for a project is stored under the `.nella/` directory:

```mermaid
graph LR
    nella_dir[".nella/"]

    nella_dir --> workspaces["workspaces.json<br/>(registry metadata)"]
    nella_dir --> sessions["sessions/"]
    nella_dir --> context["context.json<br/>(shared context store)"]
    nella_dir --> indexing["indexing/"]
    nella_dir --> backups["backups/"]
    nella_dir --> lock["lock<br/>(file lock)"]

    sessions --> session_file["{sessionId}.json"]

    indexing --> ws_dir["{workspaceId}/"]
    ws_dir --> chunks["chunks.json"]
    ws_dir --> vectors["vectors.json"]
    ws_dir --> lexical["lexical.json"]
    ws_dir --> metadata["metadata.json"]
    ws_dir --> fileHashes["file-hashes.json"]

    backups --> backup_file["{timestamp}.json"]

    style nella_dir fill:#7c3aed,color:#fff
    style workspaces fill:#ede9fe
    style sessions fill:#ede9fe
    style context fill:#ede9fe
    style indexing fill:#dbeafe
    style backups fill:#fef3c7
```

## Event System

All major operations emit events through a standard `EventEmitter` pattern. This enables logging, monitoring, and integration with external tools.

```mermaid
graph TB
    subgraph workspace_events["Workspace Events"]
        WE1["index:start / progress / complete / error"]
        WE2["watch:start / stop"]
        WE3["files:changed"]
    end

    subgraph auth_events["Auth Events"]
        AE1["auth:success / failure"]
        AE2["key:created / revoked / expired / used"]
        AE3["agent:registered / updated"]
    end

    subgraph ratelimit_events["Rate Limit Events"]
        RE1["rate-limit:check / allowed / blocked / reset"]
    end

    subgraph mcp_events["MCP Events"]
        ME1["tool:call:start / end / error"]
    end

    subgraph sync_events["Sync Events"]
        SE1["connected / disconnected"]
        SE2["sync:start / complete / error"]
    end

    EventBus["EventEmitter Pattern<br/>onEvent(handler) / emit(event)"]

    workspace_events --> EventBus
    auth_events --> EventBus
    ratelimit_events --> EventBus
    mcp_events --> EventBus
    sync_events --> EventBus

    style EventBus fill:#6366f1,color:#fff
```

## Related Architecture Pages

- [Architecture Overview](./overview.md) — System topology and package structure
- [MCP Server](./mcp-server.md) — MCP protocol implementation and tool routing
- [Indexing & RAG](./indexing-rag.md) — Code chunking, embedding, and hybrid search
- [Security & Auth](./security-auth.md) — Safety detection, authentication, and rate limiting
