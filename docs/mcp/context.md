# MCP Context Management

How to use Nella's context tracking system with MCP tools to maintain state across AI coding sessions.

## Overview

Context tracking solves the "amnesia problem" — AI agents forget what they've done, what assumptions they've made, and what dependencies look like between turns. Nella persists this automatically.

## Session Context

Every MCP session maintains a `ContextManager` that tracks:

| Category | Description | MCP Tool |
|----------|-------------|----------|
| Assumptions | Beliefs about the codebase | `nella_add_assumption`, `nella_check_assumptions` |
| Dependencies | Package snapshots for drift detection | `nella_check_dependencies` |
| Statistics | Session duration, context summary | `nella_get_context` |

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
→ Assumptions: 3 (all valid)
→ Dependencies: 1 added
```

## Persistence

Context is stored in `.nella/session.json` in the workspace:

```
.nella/
├── session.json      # Current session state
```

Sessions survive across multiple conversations. When a new MCP connection starts, the previous session's context is loaded.

## Related Docs

- [MCP Tools Reference](tools.md) — All context-related tools
