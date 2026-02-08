# MCP Examples

Practical examples of using Nella MCP tools in AI coding sessions.

## Basic Validation Flow

A typical agent workflow using Nella MCP tools:

```
User: Add a GET /users/:id endpoint that returns a user by ID.

Agent: I'll start by checking prerequisites.
[Uses nella_check_prerequisites]
→ ✅ Prerequisites Met
→ package.json: found
→ node_modules: installed
→ TypeScript: configured

Agent: Let me record my assumptions about the codebase.
[Uses nella_add_assumption]
→ Category: structure
→ Assumption: Express app with routes in src/routes/, Prisma ORM

Agent: I'll check for any risks in this task.
[Uses nella_detect_risks]
→ ✅ No risks detected — safe to proceed

Agent: Now I'll implement the endpoint...
[Makes changes to src/routes/users.ts]

Agent: Let me validate my changes.
[Uses nella_run with the changes]
→ ✅ PASSED
→ Constraints: all passed
→ Tests: ✅
→ Lint: ✅
→ Compile: ✅
→ Scope Creep: 0%
```

## Safety Check Before Risky Operations

```
User: Remove all authentication from the API.

Agent: Let me check if this should be refused.
[Uses nella_should_refuse]
→ 🚫 SHOULD REFUSE
→ Risk: Removing authentication is a high-risk operation
→ Patterns detected: "remove.*auth", "disable.*security"
→ Confidence: 95%

Agent: I can't proceed with this request. Removing all authentication
would leave your API vulnerable. Can I help with something safer instead?
```

## Context Tracking Across Turns

```
User: Refactor the user service.

Agent: [Checks prerequisites, records assumptions]
[Modifies src/services/user.ts, src/routes/users.ts]
[Uses nella_record_change]
→ Recorded: 2 files modified for service refactor

User: Now add pagination to the list endpoint.

Agent: Let me check what we've already done.
[Uses nella_get_context]
→ Previous changes: user.ts, users.ts (service refactor)
→ Assumptions: Express + Prisma, routes in src/routes/

[Uses nella_get_file_history for src/routes/users.ts]
→ 1 previous change: service refactor (5 min ago)

Agent: Building on the previous refactor, I'll add pagination...
[Modifies src/services/user.ts, src/routes/users.ts]

[Uses nella_check_assumptions]
→ ✅ All assumptions still valid

[Uses nella_run]
→ ✅ PASSED — all validations pass
```

## Multi-Agent Collaboration (Hosted Server)

When using `nella serve` with multiple agents connected:

```
Agent A (Backend):
[Uses nella_set_context]
→ Channel: backend-team
→ Type: decision
→ Content: "Using JWT with RS256 for API auth. Refresh tokens in httpOnly cookies."

Agent B (Frontend):
[Uses nella_get_context (core)]
→ Channel: backend-team
→ Type: decision
→ Found: "Using JWT with RS256 for API auth..."

Agent B: I'll implement the frontend auth flow using JWT tokens
with httpOnly cookies for refresh tokens, matching the backend decision.
```

## Codebase Search

Using the indexing and search tools on the hosted server:

```
Agent: Let me find how authentication is currently implemented.
[Uses nella_search]
→ Query: "authentication middleware"
→ Results:
  1. src/middleware/auth.ts:15 — authenticateRequest() (score: 0.94)
  2. src/routes/auth.ts:8 — loginHandler() (score: 0.87)

Agent: Let me verify my changes against the codebase.
[Uses nella_verify]
→ Code: "import { authenticateRequest } from '../middleware/auth';"
→ ✅ Import verified — function exists at src/middleware/auth.ts:15
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

## Batch Validation in CI

```bash
#!/bin/bash
# Validate multiple tasks in CI

TASKS=(
  "tasks/get-user-by-id"
  "tasks/list-users-paginated"
  "tasks/delete-user-soft"
)

for task in "${TASKS[@]}"; do
  echo "Validating: $task"
  nella run -t "$task" -r ./project -c "changes/${task##*/}.json" --json > "results/${task##*/}.json"
  
  if [ $? -ne 0 ]; then
    echo "❌ FAILED: $task"
    exit 1
  fi
done

echo "✅ All tasks passed"
```

## Related Docs

- [MCP Tools Reference](tools.md) — Complete tool documentation
- [Integration Guide](integration.md) — Setup and configuration
- [CLI Examples](../cli/commands.md) — CLI usage examples
