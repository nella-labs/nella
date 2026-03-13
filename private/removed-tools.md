# Removed MCP Tools & CLI Commands

Removed on 2026-03-13. These tools were shallow, redundant with LLM native capabilities, or overengineered for current usage.

## Removed MCP Tools (10)

| Tool | Reason |
|------|--------|
| `nella_check` | Shallow constraint checker (glob + regex). Required pre-defined task YAML. |
| `nella_validate` | Trivial `execSync()` wrapper. Agents run commands directly. |
| `nella_run` | Overengineered orchestrator requiring structured task YAML definitions. |
| `nella_detect_risks` | 15 hardcoded regex patterns. LLMs refuse dangerous tasks better natively. |
| `nella_should_refuse` | Wraps detect_risks + 2 fs.existsSync checks. |
| `nella_check_prerequisites` | Two `fs.existsSync()` calls. Not worth a tool. |
| `nella_refactor` | Regex-based code analysis. LLMs do this far better natively. |
| `nella_test` | Generic test skeleton from regex parsing. LLMs generate better tests. |
| `nella_get_file_history` | Session-scoped only. `git log` is better. |
| `nella_record_change` | Manual overhead; git already tracks changes. |

## Removed CLI Commands (3)

| Command | Reason |
|---------|--------|
| `nella check` | Wrapped removed safety/constraint tools. |
| `nella validate` | Wrapped removed validation tool. |
| `nella run` | Wrapped removed orchestrator. |

## Removed API Routes

- `POST /api/v1/validate/check`
- `POST /api/v1/validate/validate`
- `POST /api/v1/validate/run`

## Removed Core Modules

- `packages/core/src/validators/` (constraint-checker, scope-checker, command-runner)
- `packages/core/src/safety/` (refusal-detector)
- `packages/core/src/run.ts` (main orchestrator)
- `packages/core/src/services/validation-service.ts`
- `packages/core/src/services/safety-service.ts`

## What Remains (6 MCP tools)

`nella_index`, `nella_search`, `nella_get_context`, `nella_add_assumption`, `nella_check_assumptions`, `nella_check_dependencies`
