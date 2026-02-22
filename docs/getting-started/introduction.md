# Introduction

Nella is a **reliability layer for AI coding agents** — an MCP server that validates every change your AI agent makes before it touches your codebase.

## The Problem

AI coding agents are powerful, but they suffer from fundamental reliability issues:

| Problem | What Happens | Consequence |
|---------|--------------|-------------|
| **Hallucinations** | Agent generates code referencing APIs, imports, or packages that don't exist | Build failures, runtime errors, wasted debugging time |
| **Prompt Injection** | Malicious instructions hidden in code or docs hijack agent behavior | Security bypasses, credential exposure, destructive operations |
| **Context Loss** | Agent forgets prior decisions during long sessions | Contradictory changes, scope creep, broken assumptions |

## How Nella Helps

Nella runs as an MCP server alongside your IDE, giving your AI agent access to safety and validation tools in real-time:

- **Constraint checking** — Define files that should never be modified, patterns to avoid, and rules to follow
- **Risk detection** — Identify dangerous patterns like credential exposure, security bypasses, or destructive operations
- **Validation** — Run tests, lints, and type checks to verify changes work correctly
- **Session context** — Track changes, assumptions, and dependencies across an entire coding session
- **Scope monitoring** — Detect when the agent modifies files outside the expected scope
- **Refusal intelligence** — Automatically refuse dangerous requests before they cause damage

## How It Works

Install Nella, point it at your project, and configure it in your MCP client (Claude Desktop, Cursor, VS Code, etc.). Your AI agent gets direct access to these tools during every conversation:

| Tool | What It Does |
|------|-------------|
| `nella_check` | Validates constraints against file changes |
| `nella_validate` | Runs test, lint, and compile commands |
| `nella_run` | Full validation pipeline (check + validate + metrics) |
| `nella_detect_risks` | Scans for dangerous patterns in code |
| `nella_should_refuse` | Decides whether a task should be refused |
| `nella_check_prerequisites` | Verifies project setup before starting |
| Context tools | Track assumptions, file history, and dependencies |

### Example

```
You: Add pagination to the users API

Claude: I'll check constraints first.
[Uses nella_check — all constraints pass]
[Makes changes to the codebase]
[Uses nella_validate — tests pass, lint clean]
✓ Changes validated successfully
```

No manual steps. The agent calls Nella automatically during the conversation.

## Quick Setup

```bash
# Install
npm install -g @getnella/latest

# Add to Claude Desktop config
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/latest", "mcp"],
      "env": { "NELLA_REPO_PATH": "/path/to/your/project" }
    }
  }
}
```

That's it. Restart your MCP client and Nella's tools are available.

## Next Steps

- [Installation](./installation.md) — Detailed install options
- [Quick Start](./quick-start.md) — Set up and validate your first change in 5 minutes
- [MCP Tools](../mcp/tools.md) — Full reference for every tool
- [Claude Desktop](../integrations/claude-desktop.md) — Step-by-step Claude Desktop setup
