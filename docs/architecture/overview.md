# Architecture Overview

Nella is a reliability layer for AI coding agents, structured as a TypeScript monorepo with four packages that work together to validate, guard, and track agent-generated code changes.

## System Topology

```mermaid
graph TB
    Agent["AI Coding Agent<br/>(Claude, Copilot, Cursor, Cline)"]

    subgraph nella_pkg["@getnella/mcp v0.0.0"]
        CLI["CLI<br/>nella check | validate | run | mcp | serve | connect | auth | playground"]
        MCP["MCP Server<br/>(stdio transport)"]
        HostedMCP["Hosted MCP Server<br/>(Streamable HTTP)"]
        AuthCLI["Auth CLI<br/>login | logout | status"]
    end

    subgraph core_pkg["@usenella/core v0.0.0"]
        RunEngine["Run Engine<br/>runTask() | check() | validate()"]
        Validators["Validators"]
        Safety["Safety"]
        Indexing["Indexing / RAG"]
        Context["Context Management"]
        Workspace["Workspace Management"]
        Auth["Auth & Rate Limiting"]
        Sync["Cloud Sync"]
        ContextSharing["Context Sharing"]
        Playground["Playground Server"]
        Agents["Agent Runner"]
        RateLimit["Rate Limiting"]
        GCP["GCP Backend"]
        Supabase["Supabase Backend"]
    end

    subgraph benchmark_pkg["@usenella/benchmark v0.0.0"]
        BenchRunner["Benchmark Runner"]
        Adapters["Agent Adapters<br/>(Anthropic, OpenAI)"]
        Metrics["Metrics Calculator"]
        Reports["Report Generators"]
    end

    subgraph external["External Services"]
        Supabase["Supabase<br/>(PostgreSQL + pgvector)"]
        GCP["Google Cloud<br/>(Cloud SQL + Storage)"]
        EmbeddingAPIs["Embedding APIs<br/>(Voyage, OpenAI)"]
        Cohere["Cohere<br/>(Reranking)"]
        LLMAPIs["LLM APIs<br/>(Anthropic, OpenAI)"]
    end

    Agent -->|"stdio (MCP protocol)"| MCP
    Agent -->|"direct"| CLI
    MCP --> RunEngine
    CLI --> RunEngine
    RunEngine --> Validators
    RunEngine --> Safety
    RunEngine --> Context
    Indexing --> EmbeddingAPIs
    Indexing --> Cohere
    Sync --> Supabase
    Sync --> GCP
    BenchRunner --> Adapters
    Adapters --> LLMAPIs

    style Agent fill:#6366f1,color:#fff
    style nella_pkg fill:#f3e8ff,stroke:#7c3aed
    style core_pkg fill:#ede9fe,stroke:#6d28d9
    style benchmark_pkg fill:#fef3c7,stroke:#d97706
    style external fill:#ecfdf5,stroke:#059669
```

## Four Core Problems

Nella addresses four fundamental problems with AI-assisted development:

```mermaid
graph LR
    subgraph P1["1. Hallucinated Code"]
        P1_Problem["Agent references<br/>non-existent APIs"]
        P1_Solution["Indexing + CodeVerifier<br/>validates imports, symbols, APIs"]
    end

    subgraph P2["2. Lost Context"]
        P2_Problem["Agent forgets decisions<br/>across turns"]
        P2_Solution["SessionStore + ChangeLedger<br/>+ AssumptionTracker<br/>+ DependencyTracker"]
    end

    subgraph P3["3. Prompt Injection"]
        P3_Problem["Malicious prompts<br/>bypass safety"]
        P3_Solution["RefusalDetector<br/>+ Risk Pattern Matching<br/>+ Constraint Enforcement"]
    end

    subgraph P4["4. Contradictions"]
        P4_Problem["Agent contradicts<br/>earlier decisions"]
        P4_Solution["Assumption Conflicts<br/>+ Scope Creep Analysis<br/>+ Symbol Verification"]
    end

    P1_Problem --> P1_Solution
    P2_Problem --> P2_Solution
    P3_Problem --> P3_Solution
    P4_Problem --> P4_Solution

    style P1 fill:#fecaca,stroke:#ef4444
    style P2 fill:#fef3c7,stroke:#f59e0b
    style P3 fill:#dbeafe,stroke:#3b82f6
    style P4 fill:#d1fae5,stroke:#10b981
    style P1_Solution fill:#fca5a5
    style P2_Solution fill:#fde68a
    style P3_Solution fill:#93c5fd
    style P4_Solution fill:#6ee7b7
```

| Problem | Module | How It Works |
|---------|--------|--------------|
| **Hallucinated Code** | Indexing + CodeVerifier | Indexes your codebase, then verifies AI-generated imports, symbols, and API calls against real exports |
| **Lost Context** | ContextManager | Persists sessions, change history, assumptions, and dependency snapshots across agent turns |
| **Prompt Injection** | Safety / RefusalDetector | 26 regex-based risk patterns detect credential exposure, destructive operations, security bypasses, and backdoors |
| **Contradictions** | AssumptionTracker + ScopeChecker | Detects when planned changes conflict with prior assumptions; measures scope creep ratio |

## Monorepo Structure

```mermaid
graph LR
    Root["nella-workspace<br/>(pnpm monorepo)"]

    Root --> Packages["packages/"]
    Root --> Tasks["tasks/<br/>10 YAML scenarios"]
    Root --> Fixtures["fixtures/<br/>test project templates"]
    Root --> Docs["docs/"]
    Root --> Scripts["scripts/<br/>sync-docs.ts"]

    Packages --> Core["core/<br/>@usenella/core"]
    Packages --> Nella["nella/<br/>@getnella/mcp"]
    Packages --> Benchmark["benchmark/<br/>@usenella/benchmark"]
    Packages --> API["api/<br/>@usenella/api"]

    style Root fill:#7c3aed,color:#fff
    style Core fill:#a78bfa,color:#fff
    style Nella fill:#c084fc,color:#fff
    style Benchmark fill:#fbbf24,color:#000
    style API fill:#34d399,color:#000
```

| Package | Description | Key Exports |
|---------|-------------|-------------|
| `@usenella/core` | Core engine — validators, safety, indexing, context, workspace, auth, sync | `runTask()`, `check()`, `validate()`, `shouldRefuse()`, `ContextManager`, `IndexManager` |
| `@getnella/mcp` | CLI + MCP server. Re-exports all of core | `startMcpServer()`, CLI commands, MCP tool handlers |
| `@usenella/benchmark` | Benchmark runner for evaluating agent performance | `BenchmarkRunner`, agent adapters, metrics calculator |
| `@usenella/api` | REST API server (Express) for hosted deployments | Health, workspace, search, validate, context, auth endpoints |

## Package Dependencies

```mermaid
graph LR
    subgraph packages["Nella Packages"]
        nella["@getnella/mcp<br/>v0.0.0"]
        core["@usenella/core<br/>v0.0.0"]
        bench["@usenella/benchmark<br/>v0.0.0"]
    end

    nella -->|"re-exports all"| core
    bench -.->|"replicated types"| core

    style nella fill:#c084fc,color:#fff
    style core fill:#a78bfa,color:#fff
    style bench fill:#fbbf24,color:#000
```

`@getnella/mcp` depends on and re-exports everything from `@usenella/core`, adding the CLI interface and MCP server on top. `@usenella/benchmark` replicates core types but does not directly depend on the core package at runtime.

## Related Architecture Pages

- [Core Modules](./core-modules.md) — Deep dive into the run engine, validators, context, and workspace modules
- [MCP Server](./mcp-server.md) — MCP protocol implementation, tool routing, and hosted server
- [Indexing & RAG](./indexing-rag.md) — Code chunking, embedding, hybrid search, and code verification
- [Security & Auth](./security-auth.md) — Safety detection, authentication, rate limiting, and cloud sync
