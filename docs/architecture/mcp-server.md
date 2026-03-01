# MCP Server Architecture

Nella exposes its capabilities to AI agents through the Model Context Protocol (MCP). This page covers the MCP server implementation, tool routing, the hosted server variant, and the CLI auth/connect flow.

## Server Architecture

```mermaid
graph LR
    Agent["AI Agent<br/>(Claude)"]

    subgraph server["MCP Server (@getnella/mcp)"]
        Transport["StdioServerTransport"]
        Router["Tool Router"]

        subgraph validation_tools["Validation Tools"]
            nella_check["nella_check<br/>Constraint checking"]
            nella_validate["nella_validate<br/>Run test/lint/compile"]
            nella_run["nella_run<br/>Full task validation"]
        end

        subgraph safety_tools["Safety Tools"]
            nella_detect_risks["nella_detect_risks<br/>Risk pattern scanning"]
            nella_should_refuse["nella_should_refuse<br/>Refusal decision"]
            nella_check_prereqs["nella_check_prerequisites<br/>Prerequisite verification"]
        end

        subgraph context_tools["Context Tools"]
            nella_get_context["nella_get_context<br/>Session context"]
            nella_add_assumption["nella_add_assumption<br/>Record assumption"]
            nella_check_assumptions["nella_check_assumptions<br/>Assumption status"]
            nella_get_file_history["nella_get_file_history<br/>File change history"]
            nella_check_deps["nella_check_dependencies<br/>Dependency drift"]
            nella_record_change["nella_record_change<br/>Manual change recording"]
        end
    end

    subgraph core["@usenella/core"]
        checkConstraints["checkConstraints()"]
        runValidation["runValidation()"]
        runTask["runTask()"]
        detectRiskPatterns["detectRiskPatterns()"]
        shouldRefuse["shouldRefuse()"]
        checkPrereqs["checkPrerequisites()"]
        ContextMgr["ContextManager"]
    end

    Agent -->|"stdio"| Transport
    Transport --> Router
    Router --> validation_tools
    Router --> safety_tools
    Router --> context_tools

    nella_check --> checkConstraints
    nella_validate --> runValidation
    nella_run --> runTask
    nella_detect_risks --> detectRiskPatterns
    nella_should_refuse --> shouldRefuse
    nella_check_prereqs --> checkPrereqs
    nella_get_context --> ContextMgr
    nella_add_assumption --> ContextMgr
    nella_check_assumptions --> ContextMgr
    nella_get_file_history --> ContextMgr
    nella_check_deps --> ContextMgr
    nella_record_change --> ContextMgr

    style Agent fill:#6366f1,color:#fff
    style server fill:#f3e8ff,stroke:#7c3aed
    style validation_tools fill:#ddd6fe
    style safety_tools fill:#fecaca
    style context_tools fill:#d1fae5
    style core fill:#ede9fe,stroke:#6d28d9
```

### Tool Categories

| Category | Tools | Purpose |
|----------|-------|---------|
| **Validation** | `nella_check`, `nella_validate`, `nella_run` | Verify code changes against constraints, run tests/lints, or do a full validation pipeline |
| **Safety** | `nella_detect_risks`, `nella_should_refuse`, `nella_check_prerequisites` | Scan for dangerous patterns, make refusal decisions, verify project prerequisites |
| **Context** | `nella_get_context`, `nella_add_assumption`, `nella_check_assumptions`, `nella_get_file_history`, `nella_check_dependencies`, `nella_record_change` | Track session state, manage assumptions, inspect file history, detect dependency drift |

## Tool Call Lifecycle

Every MCP tool call follows this flow — from the agent's request through to the formatted response:

```mermaid
sequenceDiagram
    participant A as AI Agent
    participant T as StdioTransport
    participant S as MCP Server
    participant R as Tool Router
    participant H as Tool Handler
    participant F as Core Function

    A->>T: ListToolsRequest
    T->>S: route request
    S-->>T: 12 tool definitions (JSON Schema)
    T-->>A: tool list

    A->>T: CallToolRequest {name, arguments}
    T->>S: route request
    S->>R: dispatch(name, args, serverContext)

    alt Validation Tool
        R->>H: handleValidationTool(name, args, ctx)
    else Safety Tool
        R->>H: handleSafetyTool(name, args, ctx)
    else Context Tool
        R->>H: handleContextTool(name, args, ctx)
    end

    H->>F: core function call
    F-->>H: result
    H-->>R: CallToolResult {content, isError}
    R-->>S: result
    S-->>T: CallToolResult
    T-->>A: tool result (formatted markdown)
```

Key points:
- The server registers all tools on startup with JSON Schema definitions for each tool's input parameters
- The router dispatches by tool name prefix: `nella_check/validate/run` → validation handler, `nella_detect_risks/should_refuse/check_prerequisites` → safety handler, all others → context handler
- Tool results are formatted as markdown text for the agent to parse
- Errors are returned as `{isError: true}` with a human-readable error message

## Hosted MCP Server

For cloud deployments, Nella provides a hosted variant that uses Streamable HTTP instead of stdio:

```mermaid
graph TB
    subgraph HostedServer["Hosted MCP Server (nella serve)"]
        HTTP["Streamable HTTP<br/>POST /mcp"]
        Health["GET /health"]
        WS["WebSocket<br/>/ws"]

        subgraph Auth["Authentication"]
            APIKey["API Key Validation<br/>(Supabase)"]
            RateLimit["Rate Limiting<br/>(Redis / In-Memory)"]
        end

        subgraph Tools["MCP Tools"]
            Validation["Validation Tools<br/>check, validate, run"]
            SafetyTools["Safety Tools<br/>detect_risks, should_refuse"]
            ContextTools["Context Tools<br/>get_context, add_assumption, ..."]
        end
    end

    HTTP --> Auth
    Auth --> Tools
    WS --> Tools

    style HostedServer fill:#eff6ff,stroke:#3b82f6
    style Auth fill:#bfdbfe
    style Tools fill:#93c5fd
```

The hosted server adds:
- **API key authentication** via Supabase for multi-tenant access
- **Rate limiting** with configurable per-key and per-agent limits
- **Health endpoint** at `GET /health` for load balancer probes
- **WebSocket support** for real-time streaming of tool results

## CLI Auth & Connect Flow

The `nella auth login` and `nella connect` commands handle authentication and MCP configuration:

```mermaid
sequenceDiagram
    participant User
    participant CLI as nella CLI
    participant Browser
    participant Nella as app.getnella.dev
    participant MCP as MCP Server

    User->>CLI: nella auth login
    CLI->>CLI: Start local HTTP server
    CLI->>Browser: Open auth URL
    Browser->>Nella: Sign in
    Nella->>CLI: Redirect with tokens
    CLI->>CLI: Save to ~/.nella/auth.json

    User->>CLI: nella connect
    CLI->>CLI: Load session
    CLI->>Nella: Create API key
    Nella-->>CLI: nella_abc123...
    CLI->>MCP: Health check
    MCP-->>CLI: OK (version)
    CLI->>CLI: Write MCP config (Claude/VSCode)
    CLI-->>User: ✓ Connected
```

### Steps

1. **`nella auth login`** opens a browser window to `app.getnella.dev` for OAuth sign-in
2. A local HTTP server captures the redirect with auth tokens
3. Tokens are saved to `~/.nella/auth.json`
4. **`nella connect`** uses the saved session to create an API key
5. The CLI writes MCP server configuration to the appropriate config file (Claude Desktop's `claude_desktop_config.json` or VS Code's `settings.json`)
6. The connection is verified with a health check against the hosted server

## Related Architecture Pages

- [Architecture Overview](./overview.md) — System topology and package structure
- [Core Modules](./core-modules.md) — Run engine, validators, context, and workspace
- [Indexing & RAG](./indexing-rag.md) — Code chunking, embedding, and hybrid search
- [Security & Auth](./security-auth.md) — Safety detection, authentication, and rate limiting
