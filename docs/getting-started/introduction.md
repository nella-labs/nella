# Introduction

Nella is a **codebase intelligence layer for AI coding agents** — an MCP server that helps your AI agent understand your codebase and maintain context across sessions.

## The Problem

AI coding agents are powerful, but they suffer from fundamental limitations:

| Problem | What Happens | Consequence |
|---------|--------------|-------------|
| **Hallucinations** | Agent generates code referencing APIs, imports, or packages that don't exist | Build failures, runtime errors, wasted debugging time |
| **Prompt Injection** | Malicious instructions hidden in code or docs hijack agent behavior | Security bypasses, credential exposure, destructive operations |
| **Context Loss** | Agent forgets prior decisions during long sessions | Contradictory changes, scope creep, broken assumptions |

## How Nella Helps

Nella runs as an MCP server alongside your IDE, giving your AI agent access to search, context, and dependency-tracking tools in real-time:

- **Codebase search** — Hybrid semantic + lexical search across your indexed codebase
- **Prompt injection defense** — 5-layer protection against malicious instructions embedded in code and docs
- **Session context** — Track changes, assumptions, and dependencies across an entire coding session
- **Assumption tracking** — Record and verify assumptions to catch contradictions early
- **Dependency checking** — Detect when dependencies change under you

## How It Works

Install Nella, point it at your project, and configure it in your MCP client (Claude Desktop, Cursor, VS Code, etc.). Your AI agent gets direct access to these tools during every conversation:

| Tool | What It Does |
|------|-------------|
| `nella_index` | Indexes your codebase for fast hybrid search |
| `nella_search` | Hybrid semantic + lexical search across indexed files |
| `nella_get_context` | Retrieves session context (changes, assumptions, dependencies) |
| `nella_add_assumption` | Records an assumption for later verification |
| `nella_check_assumptions` | Verifies recorded assumptions still hold |
| `nella_check_dependencies` | Detects if dependencies changed |
| `nella_heartbeat` | Verifies trust-chain continuity between tool calls |

### Example

```
You: Add pagination to the users API

Claude: I'll search for the existing users code first.
[Uses nella_search — finds users.controller.ts and users.service.ts]
[Makes changes to the codebase]
[Uses nella_check_assumptions — assumptions still valid]
Done. Changes applied successfully.
```

No manual steps. The agent calls Nella automatically during the conversation.

## Quick Setup

```bash
# Install
npm install -g @getnella/mcp

# Automatic client setup
nella connect --client claude
```

For a manual local stdio config, pass the workspace explicitly:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "--workspace", "/path/to/your/project"]
    }
  }
}
```

## Next Steps

- [Installation](./installation.md) — Detailed install options
- [Quick Start](./quick-start.md) — Set up and validate your first change in 5 minutes
- [MCP Tools](../mcp/tools.md) — Full reference for every tool
- [Claude Desktop](../integrations/claude-desktop.md) — Step-by-step Claude Desktop setup
