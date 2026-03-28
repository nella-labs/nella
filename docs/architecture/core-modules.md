# Core Modules

The `@usenella/core` package contains Nella's indexing, context tracking, workspace management, and safety logic. This page covers the indexing/RAG system, context management, workspace management, and the event system.

## Module Architecture

```mermaid
graph TB
    subgraph indexing["Indexing & RAG"]
        indexMgr["IndexManager<br/>index() | search() | verify()"]
        chunker["chunker.ts"]
        embedder["embedder.ts"]
        hybridSearch["hybrid-search.ts"]
        verifier["verifier.ts"]
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

    subgraph safety["Safety"]
        contentScanner["content-scanner.ts"]
        injectionScorer["injection-scorer.ts"]
    end

    indexMgr --> chunker
    indexMgr --> embedder
    indexMgr --> hybridSearch
    indexMgr --> verifier
    ctxManager --> sessionStore
    ctxManager --> changeLedger
    ctxManager --> assumptionTracker
    ctxManager --> depTracker

    style indexing fill:#6366f1,color:#fff
    style context fill:#10b981,color:#fff
    style workspace fill:#f59e0b,color:#fff
    style safety fill:#ef4444,color:#fff
```

## Core Flow

The MCP server and CLI route tool calls into two main subsystems:

- **IndexManager** — Indexes the codebase (AST chunking, embedding, hybrid search) and verifies generated code against the index.
- **ContextManager** — Tracks session state, assumptions, change history, and dependency drift across agent turns.

There is no centralized `runTask()` pipeline. Instead, each MCP tool (`nella_search`, `nella_index`, `nella_get_context`, etc.) calls into the relevant manager directly.

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
