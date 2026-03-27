# Security & Auth Architecture

This page covers Nella's security layers — safety/refusal detection, authentication, rate limiting, cloud sync, and the benchmark system's architecture.

## Safety & Refusal Detection

Before executing any task, Nella can scan for dangerous patterns and decide whether to refuse:

```mermaid
graph TB
    Input["Task + Workspace Path"]

    subgraph prereqs["Prerequisite Checks"]
        PkgJson{"package.json<br/>exists?"}
        NodeMod{"node_modules<br/>exists?"}
    end

    subgraph risk_scan["Risk Pattern Scanning"]
        RP1["Credential Exposure<br/>(log password, console.log token)"]
        RP2["Security Bypass<br/>(disable auth, skip validation)"]
        RP3["Dangerous Operations<br/>(rm -rf, drop table, truncate)"]
        RP4["Data Exposure<br/>(dump database, export secrets)"]
        RP5["Backdoor Indicators<br/>(hardcode password, add backdoor)"]
    end

    subgraph task_patterns["Task-Specific Patterns"]
        TaskRefusal["task.refusalPatterns[]<br/>(custom patterns)"]
    end

    Confidence["Calculate Confidence<br/>patternConfidence + prereqConfidence"]

    Decision{"reasons.length > 0<br/>OR patterns matched?"}

    Refuse["RefusalResult<br/>{shouldRefuse: true,<br/>reason, patternsMatched,<br/>confidence}"]

    Proceed["RefusalResult<br/>{shouldRefuse: false}"]

    Input --> PkgJson
    Input --> NodeMod
    PkgJson -->|"missing"| Confidence
    NodeMod -->|"missing"| Confidence
    Input --> RP1
    Input --> RP2
    Input --> RP3
    Input --> RP4
    Input --> RP5
    Input --> TaskRefusal
    RP1 -->|"matched"| Confidence
    RP2 -->|"matched"| Confidence
    RP3 -->|"matched"| Confidence
    RP4 -->|"matched"| Confidence
    RP5 -->|"matched"| Confidence
    TaskRefusal -->|"matched"| Confidence
    PkgJson -->|"exists"| Decision
    NodeMod -->|"exists"| Decision
    Confidence --> Decision
    Decision -->|"Yes"| Refuse
    Decision -->|"No"| Proceed

    style Input fill:#6366f1,color:#fff
    style prereqs fill:#fef3c7
    style risk_scan fill:#fecaca
    style task_patterns fill:#ffedd5
    style Refuse fill:#ef4444,color:#fff
    style Proceed fill:#22c55e,color:#fff
```

### Risk Pattern Categories

Nella includes **26 built-in regex patterns** across 5 categories:

| Category | Example Patterns | Confidence |
|----------|-----------------|------------|
| **Credential Exposure** | `log.*password`, `console.log.*token`, `print.*secret` | 0.9 |
| **Security Bypass** | `disable.*auth`, `skip.*validation`, `remove.*security` | 0.9 |
| **Dangerous Operations** | `rm -rf`, `DROP TABLE`, `TRUNCATE`, `format.*disk` | 0.95 |
| **Data Exposure** | `dump.*database`, `export.*secrets`, `send.*credentials` | 0.85 |
| **Backdoor Indicators** | `hardcode.*password`, `add.*backdoor`, `bypass.*check` | 0.9 |

Tasks can also define custom `refusalPatterns` in their YAML definition for domain-specific safety checks.

## Authentication Flow

The hosted MCP server uses API key authentication with agent-level access control:

```mermaid
sequenceDiagram
    participant TC as Tool Call
    participant MH as McpToolHandler
    participant AU as Authenticator
    participant KM as KeyManager
    participant AM as AgentManager
    participant RL as RateLimiter
    participant H as Tool Handler

    TC->>MH: {apiKey, agentId, action, args}
    MH->>AU: authenticate(apiKey, action)

    AU->>KM: validate(apiKey)
    KM-->>AU: ApiKey | null

    alt Invalid Key
        AU-->>MH: AuthResult {error: INVALID_KEY}
        MH-->>TC: Error: authentication failed
    end

    AU->>AU: check expired?
    AU->>AU: check revoked?
    AU->>AU: check permissions for action

    alt Has Agent ID
        AU->>AM: getAgent(agentId)
        AM-->>AU: Agent (check active)
    end

    AU->>RL: consume(agentId)

    alt Rate Limited
        RL-->>AU: blocked (minute/hour/concurrent)
        AU-->>MH: AuthResult {error: RATE_LIMIT}
        MH-->>TC: Error: rate limit exceeded
    end

    RL-->>AU: allowed
    AU-->>MH: AuthResult {success: true}
    MH->>H: execute tool handler
    H-->>MH: result
    MH->>RL: release(agentId)
    MH-->>TC: CallToolResult
```

### Auth Components

| Component | Responsibility |
|-----------|---------------|
| **KeyManager** | CRUD for API keys with expiry and permission scoping |
| **AgentManager** | Register and manage agent identities |
| **Authenticator** | Validates keys, checks permissions, coordinates rate limiting |
| **TokenManager** | JWT token generation and validation |
| **AuditLogManager** | Records all auth events for compliance |
| **IPFilter** | Optional IP allowlist/blocklist |
| **RequestSigner** | HMAC-based request signing for webhook verification |

## Rate Limiting

```mermaid
graph LR
    subgraph backends["Backends"]
        Memory["In-Memory<br/>(Map)"]
        Redis["Redis<br/>(distributed)"]
        SQLite["SQLite<br/>(persistent)"]
    end

    subgraph algorithms["Algorithms"]
        TokenBucket["Token Bucket<br/>(burst-friendly)"]
        SlidingWindow["Sliding Window<br/>(strict rate)"]
    end

    RateLimiter["RateLimiter"]

    RateLimiter --> Memory
    RateLimiter --> Redis
    RateLimiter --> SQLite
    RateLimiter --> TokenBucket
    RateLimiter --> SlidingWindow

    style RateLimiter fill:#6366f1,color:#fff
    style backends fill:#dbeafe
    style algorithms fill:#fef3c7
```

| Feature | Details |
|---------|---------|
| **Per-agent limits** | Minute, hour, and concurrent call limits |
| **Priority handling** | High-priority requests can bypass standard limits |
| **Dynamic adjustment** | Limits can be changed at runtime without restarts |
| **Auto-release** | Concurrent slots are released when tool calls complete |

## Cloud Sync

The `SyncManager` provides multi-tier cloud sync with automatic fallback:

```mermaid
graph TB
    Client["Client / Agent"]

    SyncMgr["SyncManager<br/>(auto-fallback)"]

    subgraph tier1["Tier 1: GCP (Preferred)"]
        GCPAdapter["GCPSyncAdapter"]
        CloudSQL["Cloud SQL<br/>(PostgreSQL + pgvector)"]
        GCS["Google Cloud Storage"]
    end

    subgraph tier2["Tier 2: Supabase"]
        SupaAdapter["SupabaseSyncAdapter"]
        SupaDB["Supabase PostgreSQL<br/>(pgvector)"]
        SupaRT["Supabase Realtime"]
    end

    subgraph tier3["Tier 3: Local (Always Available)"]
        LocalAdapter["LocalSyncAdapter"]
        JSONFiles[".nella/ JSON files"]
    end

    Client --> SyncMgr
    SyncMgr --> GCPAdapter
    GCPAdapter --> CloudSQL
    GCPAdapter --> GCS

    SyncMgr -.->|"fallback"| SupaAdapter
    SupaAdapter --> SupaDB
    SupaAdapter --> SupaRT

    SyncMgr -.->|"fallback"| LocalAdapter
    LocalAdapter --> JSONFiles

    style Client fill:#6366f1,color:#fff
    style SyncMgr fill:#7c3aed,color:#fff
    style tier1 fill:#dbeafe,stroke:#3b82f6
    style tier2 fill:#d1fae5,stroke:#10b981
    style tier3 fill:#fef3c7,stroke:#f59e0b
```

### Cloud File Sync Features

| Feature | Details |
|---------|---------|
| **Delta chunking** | Only uploads/downloads changed chunks |
| **AES-256-GCM encryption** | End-to-end encryption for data at rest |
| **Gzip compression** | Reduces bandwidth usage |
| **Bandwidth throttling** | Configurable upload/download limits |
| **Offline queue** | Queues operations when disconnected, syncs when reconnected |
| **Conflict resolution** | LWW (last-writer-wins), Merge, Manual, or Server-wins strategies |

## Benchmark System

The benchmark system evaluates AI coding agents against standardized tasks:

```mermaid
graph TB
    subgraph input["Input"]
        TaskYAML["Task YAML files<br/>(tasks/ directory)"]
        FixtureRepo["Fixture Repos<br/>(fixtures/ directory)"]
        AgentConfig["Agent Config<br/>(API keys, models)"]
    end

    LoadTasks["loadAllTasks()<br/>Parse YAML to Task[]"]

    subgraph loop["For each (Agent, Task) pair"]
        Clone["FixtureManager.clone()<br/>Create temp directory"]
        BuildPrompt["PromptBuilder.build()<br/>System + user prompt"]
        CallAgent["AgentAdapter.call()<br/>(Anthropic / OpenAI)"]
        ParseResponse["Parse response<br/>Extract file changes"]
        ApplyChanges["Apply changes<br/>to fixture"]

        subgraph validate["Validation"]
            RunTests["CommandRunner<br/>test / lint / compile"]
            CheckConstraints["ConstraintChecker<br/>files + patterns"]
            CheckScope["ScopeChecker<br/>scope creep"]
        end

        Retry{"Passed?"}
        CalcMetrics["MetricsCalculator<br/>8 metrics + cost"]
    end

    subgraph output["Output"]
        JSONL["results.jsonl"]
        Summary["summary.md"]
        Dashboard["dashboard.html"]
        Artifacts["artifacts/"]
    end

    TaskYAML --> LoadTasks
    FixtureRepo --> Clone
    AgentConfig --> CallAgent
    LoadTasks --> Clone
    Clone --> BuildPrompt
    BuildPrompt --> CallAgent
    CallAgent --> ParseResponse
    ParseResponse --> ApplyChanges
    ApplyChanges --> RunTests
    ApplyChanges --> CheckConstraints
    ApplyChanges --> CheckScope
    RunTests --> Retry
    CheckConstraints --> Retry
    CheckScope --> Retry
    Retry -->|"No, iteration < max"| BuildPrompt
    Retry -->|"Yes / max reached"| CalcMetrics
    CalcMetrics --> JSONL
    CalcMetrics --> Summary
    CalcMetrics --> Dashboard
    CalcMetrics --> Artifacts

    style input fill:#fef3c7
    style loop fill:#ede9fe
    style validate fill:#dbeafe
    style output fill:#d1fae5
```

### Benchmark Metrics

| Metric | Abbr | Range | Description |
|--------|------|-------|-------------|
| Build/Test Pass | BTP | 0 or 1 | Did all build/test commands succeed? |
| Validation Integrity | VI | 0.0–1.0 | Ratio of validations that passed |
| Constraint Violation Rate | CVR | 0.0–1.0 | Fraction of constraints violated |
| Scope Creep | SC | 0.0+ | Extra files / expected files ratio |
| Refusal Correctness | RC | boolean | Did agent refuse correctly when expected? |
| Time to Green | TTG | ms | Wall clock time to first passing state |
| Iteration Count | IC | 1+ | Number of retries needed |
| Diff Accuracy | DA | 0.0–1.0 | Similarity to expected diff |

## Agent Runner

The agent runner orchestrates multi-turn LLM interactions with tool use:

```mermaid
graph TB
    subgraph AgentModule["Agent Runner Module"]
        Runner["AgentRunner<br/>Tool-use loop orchestrator"]

        subgraph Adapters["LLM Adapters"]
            Anthropic["AnthropicAdapter<br/>Claude Sonnet 4, Opus 4"]
            OpenAI["OpenAIAdapter<br/>GPT-4 Turbo, GPT-4o, GPT-4o-mini"]
        end

        Factory["createAgentAdapter()"]
        Pricing["MODEL_PRICING<br/>Cost per token"]
        Estimator["estimateAgentCost()"]
    end

    Runner --> Adapters
    Factory --> Adapters
    Runner --> Pricing
    Pricing --> Estimator

    style AgentModule fill:#f5f3ff,stroke:#7c3aed
    style Runner fill:#c4b5fd
    style Factory fill:#ddd6fe
    style Pricing fill:#ede9fe
```

## Deprecated Modules

| Module | Status | Replacement |
|--------|--------|-------------|
| `cloud-sync/` | Deprecated | Use `sync/` module (`SyncManager`) |

The `CloudSyncManager` from `cloud-sync/` is a legacy compatibility wrapper. New code should use `SyncManager` from the `sync/` module.

## Related Architecture Pages

- [Architecture Overview](./overview.md) — System topology and package structure
- [Core Modules](./core-modules.md) — Run engine, validators, context, and workspace
- [MCP Server](./mcp-server.md) — MCP protocol implementation and tool routing
- [Indexing & RAG](./indexing-rag.md) — Code chunking, embedding, and hybrid search
- [Prompt Injection Defense](./prompt-injection-defense.md) — 5-layer defense system protecting agents from injection attacks through search results
