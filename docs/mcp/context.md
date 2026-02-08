# MCP Context Management

How to use Nella's context tracking system with MCP tools to maintain state across AI coding sessions.

## Overview

Context tracking solves the "amnesia problem" — AI agents forget what they've done, what assumptions they've made, and what dependencies look like between turns. Nella persists this automatically.

## Session Context

Every MCP session maintains a `ContextManager` that tracks:

| Category | Description | MCP Tool |
|----------|-------------|----------|
| Changes | Files modified during the session | `nella_record_change` |
| Assumptions | Beliefs about the codebase | `nella_add_assumption`, `nella_check_assumptions` |
| Dependencies | Package snapshots for drift detection | `nella_check_dependencies` |
| File History | Timeline of modifications per file | `nella_get_file_history` |
| Statistics | Hotspot files, session duration | `nella_get_context` |

## Tracking Changes

When an agent modifies files, use `nella_record_change` to log what changed and why:

```
Agent: I modified src/routes/users.ts to add pagination.
[Uses nella_record_change]
→ Files: src/routes/users.ts
→ Reason: Added offset/limit query params and paginated response
```

Later, `nella_get_file_history` shows the full timeline:

```
Agent: What changes have been made to the users route?
[Uses nella_get_file_history for src/routes/users.ts]
→ 2 changes recorded:
  1. Added pagination (offset/limit) — 10 min ago
  2. Added sorting by createdAt — 5 min ago
```

## Assumptions

Assumptions are beliefs the agent records about the codebase. They get checked automatically when related files change:

```
Agent: I'll assume the project uses Express with TypeScript.
[Uses nella_add_assumption]
→ Category: structure
→ Assumption: Express.js with TypeScript, routes in src/routes/

// Later, after changes...
[Uses nella_check_assumptions]
→ ✅ All 3 assumptions still valid
   OR
→ ⚠️ 1 assumption invalidated:
   "No utility files in src/utils" — src/utils/format.ts was created
```

## Dependencies

Nella snapshots `package.json` at session start and can detect drift:

```
[Uses nella_check_dependencies]
→ ✅ No dependency changes
   OR
→ ⚠️ Dependencies changed:
   + express@4.19.0 (added)
   ~ prisma@5.9.0 → 5.10.0 (updated)
```

## Full Context

`nella_get_context` returns the complete session state:

```
[Uses nella_get_context]
→ Session: abc123 (started 15 min ago)
→ Changes: 4 files modified
→ Assumptions: 3 (all valid)
→ Dependencies: 1 added
→ Hotspots: src/routes/users.ts (modified 3 times)
```

## Persistence

Context is stored in `.nella/session.json` in the workspace:

```
.nella/
├── session.json      # Current session state
└── runs/
    └── {runId}/
        ├── logs.jsonl   # Detailed run logs
        ├── diff.patch   # Changes made
        └── metrics.json # Run metrics
```

Sessions survive across multiple conversations. When a new MCP connection starts, the previous session's context is loaded.

## Cross-Agent Context

For multi-agent setups, use the **SharedContextManager** (exposed via `nella_set_context` and `nella_get_context (core)` tools on the hosted server). See the [Context Sharing guide](../core/context-sharing.md) for details.

## Related Docs

- [Context Sharing](../core/context-sharing.md) — Cross-agent context
- [Context Module](../core/context.md) — ContextManager API
- [MCP Tools Reference](tools.md) — All context-related tools
