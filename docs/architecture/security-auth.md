# Security & Auth Architecture

This page covers Nella's security layers — safety/refusal detection, authentication, rate limiting, and cloud sync.

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
