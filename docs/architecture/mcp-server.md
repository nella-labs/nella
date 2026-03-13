# MCP Server Architecture

Nella exposes its capabilities to AI agents through the Model Context Protocol (MCP). This page covers the MCP server implementation, tool routing, the hosted server variant, and the CLI auth/connect flow.

## Server Architecture

```mermaid
graph LR
    Agent["AI Agent<br/>(Claude)"]

    subgraph server["MCP Server (@getnella/mcp)"]
        Transport["StdioServerTransport"]
        Router["Tool Router"]

        subgraph indexing_tools["Indexing Tools"]
            nella_index["nella_index<br/>Index workspace"]
            nella_search["nella_search<br/>Hybrid search"]
        end

        subgraph context_tools["Context Tools"]
            nella_get_context["nella_get_context<br/>Session context"]
            nella_add_assumption["nella_add_assumption<br/>Record assumption"]
            nella_check_assumptions["nella_check_assumptions<br/>Assumption status"]
            nella_check_deps["nella_check_dependencies<br/>Dependency drift"]
        end
    end

    subgraph core["@usenella/core"]
        IndexEngine["IndexEngine"]
        SearchEngine["SearchEngine"]
        ContextMgr["ContextManager"]
    end

    Agent -->|"stdio"| Transport
    Transport --> Router
    Router --> indexing_tools
    Router --> context_tools

    nella_index --> IndexEngine
    nella_search --> SearchEngine
    nella_get_context --> ContextMgr
    nella_add_assumption --> ContextMgr
    nella_check_assumptions --> ContextMgr
    nella_check_deps --> ContextMgr

    style Agent fill:#6366f1,color:#fff
    style server fill:#f3e8ff,stroke:#7c3aed
    style indexing_tools fill:#bfdbfe
    style context_tools fill:#d1fae5
    style core fill:#ede9fe,stroke:#6d28d9
```

### Tool Categories

| Category | Tools | Purpose |
|----------|-------|---------|
| **Indexing** | `nella_index`, `nella_search` | Index workspace codebase and search via hybrid/semantic/lexical modes |
| **Context** | `nella_get_context`, `nella_add_assumption`, `nella_check_assumptions`, `nella_check_dependencies` | Track session state, manage assumptions, detect dependency drift |

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
    S-->>T: 6 tool definitions (JSON Schema)
    T-->>A: tool list

    A->>T: CallToolRequest {name, arguments}
    T->>S: route request
    S->>R: dispatch(name, args, serverContext)

    alt Indexing Tool
        R->>H: handleIndexingTool(name, args, ctx)
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
- The router dispatches by tool name prefix: `nella_index/search` -> indexing handler, all others -> context handler
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
            IndexingTools["Indexing Tools<br/>index, search"]
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
    CLI-->>User: Connected
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
- [Core Modules](./core-modules.md) — Context, indexing, and workspace
- [Indexing & RAG](./indexing-rag.md) — Code chunking, embedding, and hybrid search
- [Security & Auth](./security-auth.md) — Authentication and rate limiting
