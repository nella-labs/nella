# CLI Examples

Practical examples for using `@getnella/mcp`.

## Table of Contents

- [Indexing](#indexing)
- [MCP Integration](#mcp-integration)
- [Hosted Server](#hosted-server)
- [Authentication](#authentication)
- [Playground](#playground)

---

## Indexing

### Index Your Codebase

```bash
# Index current workspace
nella index

# Force full reindex
nella index --force
```

---

## MCP Integration

### Claude Desktop Setup

```bash
# Install globally
npm install -g @getnella/mcp

# Verify installation
nella --help
```

Add to Claude Desktop config:

```json
{
  "mcpServers": {
    "nella": {
      "command": "nella",
      "args": ["mcp", "--workspace", "/path/to/project"]
    }
  }
}
```

### Claude Code Setup

```bash
# Add via CLI
claude mcp add nella -- npx @getnella/mcp mcp --workspace .
```

---

## Hosted Server

### Start a Self-Hosted Nella Server

```bash
# Start with defaults (localhost:3847)
nella serve

# Production setup — bind to all interfaces
nella serve --port 8080 --host 0.0.0.0

# With Redis for distributed rate limiting
REDIS_URL=redis://localhost:6379 nella serve --port 3847
```

### Connect Clients to the Server

```bash
# Auto-configure Claude Desktop
nella connect --client claude

# Connect to a custom server
nella connect --server-url http://192.168.1.100:3847/mcp

# Connect with existing API key
nella connect --client cursor --api-key nella_existing_key
```

### Docker Deployment

```bash
# Pull and run
docker pull ghcr.io/nella-labs/nella-mcp:latest
docker run -p 3847:3847 \
  -e NELLA_API_KEY=nella_secret \
  -e SUPABASE_URL=https://xxx.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  ghcr.io/nella-labs/nella-mcp:latest

# Health check
curl http://localhost:3847/health
```

---

## Authentication

### Login Flows

```bash
# Interactive OAuth login (opens browser)
nella auth login

# Check status
nella auth status

# Logout
nella auth logout
```

---

## Playground

### Launch the Playground

```bash
# Start playground with default settings
nella playground

# Custom port and workspace
nella playground --port 4000 --workspace ./my-project
```

> **Tip:** The playground provides a web-based UI at `http://localhost:PORT` with a chat interface for testing MCP tools, a file browser, context viewer, and real-time WebSocket updates.
