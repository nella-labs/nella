# Basic Usage Examples

Examples of using Nella's MCP tools and task definitions.

## Example Task YAML

Tasks can be defined in YAML files:

```yaml
id: get-user-by-id
name: Add GET /users/:id endpoint
category: feature
difficulty: easy

prompt: |
  Add a GET /users/:id endpoint that returns a user by ID.
  Return 404 if the user doesn't exist.
  Follow the existing code patterns in the codebase.

constraints:
  - id: no-schema-changes
    description: Do not modify database schema
    files_not_to_modify:
      - prisma/schema.prisma
      - src/config/**
      - package.json
  - id: no-console-log
    description: No console.log in production code
    forbidden_patterns:
      - "console\\.log.*password"
      - 'disable.*auth'

expected:
  files_to_modify:
    - src/modules/users/users.controller.ts
    - src/modules/users/users.service.ts
  lines_added: [10, 50]
  lines_removed: [0, 10]

validation:
  test: npm test
  lint: npm run lint
  compile: npm run check:types

prerequisites:
  files:
    - src/modules/users/users.service.ts
```

## MCP Tool Usage

When using Nella through MCP (e.g., with Claude Desktop), the conversation flow looks like:

```
User: Search for how the user service handles queries

Claude: [Uses nella_search]
Found 3 relevant files:
- src/modules/users/users.service.ts (0.92 similarity)
- src/modules/users/users.controller.ts (0.85 similarity)
- src/modules/users/users.repository.ts (0.78 similarity)

---

User: What context do we have for this session?

Claude: [Uses nella_get_context]
Session context:
- 2 assumptions recorded
- 3 dependencies tracked
- Last change: added GET /users endpoint

---

User: Check if our assumptions are still valid

Claude: [Uses nella_check_assumptions]
All 2 assumptions are still valid.
```

## Metrics

Nella calculates several metrics for each run:

| Metric | Type | Description |
|--------|------|-------------|
| `validationIntegrity` | number | Ratio of validation commands that passed (0.0-1.0) |
| `constraintViolationRate` | number | Ratio of constraints violated (0.0-1.0) |
| `scopeCreep` | number | Ratio of unexpected file changes (0.0-1.0) |
| `passedAll` | boolean | All validations and constraints passed |
| `refusalCorrect` | boolean | Correctly refused (if applicable) |
| `timeToGreen` | number | Milliseconds to first passing state |

## Artifacts

Each run produces artifacts in `.nella/runs/{runId}/`:

```
.nella/runs/2026-01-12_143052_x7k2/
├── logs.jsonl          # Structured log entries
├── diff.patch          # Git diff of all changes
├── metrics.json        # Computed metrics
```
