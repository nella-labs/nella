# MCP Examples

Practical examples of using Nella MCP tools in AI coding sessions.

## Search and Context Flow

A typical agent workflow using Nella MCP tools:

```
User: Add a GET /users/:id endpoint that returns a user by ID.

Agent: Let me search for existing route patterns in the codebase.
[Uses nella_search]
→ Query: "user routes"
→ Results:
  1. src/routes/users.ts:5 — usersRouter (score: 0.92)

Agent: Let me record my assumptions about the codebase.
[Uses nella_add_assumption]
→ Category: structure
→ Assumption: Express app with routes in src/routes/, Prisma ORM

Agent: Now I'll implement the endpoint...
[Makes changes to src/routes/users.ts]

Agent: Let me verify my assumptions are still valid.
[Uses nella_check_assumptions]
→ ✅ All assumptions still valid
```

## Context Tracking Across Turns

```
User: Refactor the user service.

Agent: [Searches codebase, records assumptions]
[Modifies src/services/user.ts, src/routes/users.ts]

User: Now add pagination to the list endpoint.

Agent: Let me check what we've already done.
[Uses nella_get_context]
→ Assumptions: Express + Prisma, routes in src/routes/

Agent: Building on the previous refactor, I'll add pagination...
[Modifies src/services/user.ts, src/routes/users.ts]

[Uses nella_check_assumptions]
→ ✅ All assumptions still valid
```

## Codebase Search

Using the indexing and search tools:

```
Agent: Let me find how authentication is currently implemented.
[Uses nella_search]
→ Query: "authentication middleware"
→ Results:
  1. src/middleware/auth.ts:15 — authenticateRequest() (score: 0.94)
  2. src/routes/auth.ts:8 — loginHandler() (score: 0.87)
```

## Dependency Drift Detection

```
User: The tests are failing after I pulled new changes.

Agent: Let me check for dependency changes.
[Uses nella_check_dependencies]
→ ⚠️ Dependencies changed since session start:
  ~ @prisma/client: 5.9.0 → 5.10.0 (minor update)
  + zod: 3.22.0 (new dependency)

Agent: Prisma was updated to 5.10.0 and Zod was added.
Let me regenerate the Prisma client and check the new schema...
```

## Related Docs

- [MCP Tools Reference](tools.md) — Complete tool documentation
- [CLI Examples](../cli/commands.md) — CLI usage examples
