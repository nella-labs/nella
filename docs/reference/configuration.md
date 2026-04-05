# Configuration

Nella works out of the box with no configuration files. This page covers optional settings for validation and the benchmark suite.

## Validation

Define verification commands to check your agent's changes. These run test, lint, and compile commands against the workspace.

```yaml
validation:
  test: "npm test"
  lint: "npm run lint"
  compile: "npx tsc --noEmit"
```

**Framework examples:**

| Framework | Test | Lint | Compile |
|-----------|------|------|---------|
| Node.js / npm | `npm test` | `npm run lint` | `npx tsc --noEmit` |
| pnpm | `pnpm test` | `pnpm lint` | `pnpm tsc --noEmit` |
| Python | `pytest` | `ruff check .` | `mypy .` |
| Go | `go test ./...` | `golangci-lint run` | `go build ./...` |
| Rust | `cargo test` | `cargo clippy` | `cargo build` |

Commands run in order: test, lint, compile. Each reports pass/fail with output.

> **Tip:** Use fast commands. Validation should complete in seconds, not minutes.

## Task Authoring

Tasks define work for the benchmark suite. Each task is a YAML file:

```yaml
id: add-pagination
name: Add Pagination to Users API
category: feature
difficulty: medium
prompt: |
  Add offset/limit pagination to the GET /users endpoint.
  Return total count in response headers.
expected:
  files_to_modify:
    - src/controllers/users.controller.ts
    - src/services/users.service.ts
  files_to_ignore:
    - src/auth/**
  expected_line_count: 50
timeout_seconds: 300
```

**Required fields:**

| Field | Description |
|-------|-------------|
| `id` | Unique identifier |
| `name` | Human-readable name |
| `category` | `feature`, `bug-fix`, `refactor`, or `edge-case` |
| `difficulty` | `easy`, `medium`, or `hard` |
| `prompt` | The instruction given to the agent |
| `expected` | Expected changes and constraints |

## Constraints

Constraints restrict what the agent can modify during benchmark evaluation:

```yaml
constraints:
  - id: no-auth-changes
    description: Do not modify authentication files
    rule: filesNotToModify
    filesNotToModify:
      - "src/auth/**"
      - "src/middleware/auth.*"
  - id: no-eval
    description: No use of eval or Function constructor
    rule: forbiddenPatterns
    forbiddenPatterns:
      - "eval\\("
      - "new Function\\("
```

> **Note:** Constraints are used by the benchmark suite only. They do not affect the MCP tools during normal use.
