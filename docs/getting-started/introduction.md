# Introduction

Nella is a codebase intelligence layer for AI coding agents — an MCP server that grounds your agent in real code, tracks context across sessions, and defends against prompt injection. Install it, connect your IDE, and your agent gets smarter immediately.

## Get Started

1. **Install Nella**

   ```bash
   npm install -g @getnella/mcp
   ```

2. **Connect your client**

   ```bash
   nella connect --client claude
   ```

   Also supports: `--client cursor`, `--client vscode`, `--client windsurf`, `--client claude-code`

3. **Verify**

   Ask your agent: *"What Nella tools are available?"*

   If all 7 tools appear, you're ready.

## What Your Agent Gets

| Tool | Purpose |
|------|---------|
| `nella_index` | Index your codebase for search |
| `nella_search` | Search across indexed files |
| `nella_get_context` | Review session state and changes |
| `nella_add_assumption` | Record a codebase assumption |
| `nella_check_assumptions` | Verify assumptions still hold |
| `nella_check_dependencies` | Detect dependency changes |
| `nella_heartbeat` | Session verification |

## Example

```
You: Add pagination to the users API

Agent: I'll search for the existing users endpoint first.
[Calls nella_search → finds users.controller.ts and users.service.ts]
[Records assumption about current pagination approach]
[Implements changes]
[Calls nella_check_assumptions → all valid]
Done. Pagination added with offset/limit support.
```

No manual steps. The agent calls Nella automatically during the conversation.

## Next Steps

- [Installation & Setup](../getting-started/installation.md) — detailed setup for all clients
- [MCP Tools](../tools/overview.md) — complete tools reference
- [Agent Setup](../core-concepts/agent-setup.md) — make your agent use Nella automatically
