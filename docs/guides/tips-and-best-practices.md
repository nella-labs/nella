# Tips & Best Practices

Practical tips for getting the most out of Nella — from always-on agent reliability to constraint authoring and team workflows.

## Always-On Nella

The most impactful thing you can do is configure your AI agent to **always use Nella tools**, without you having to ask every time. Most AI coding agents support project-level instruction files that are automatically included in every conversation.

Add Nella instructions to the appropriate file for your editor, and the agent will automatically search for context, track assumptions, and check dependencies on every task.

### Claude Code / Claude Desktop — `Claude.md`

Create a `Claude.md` file in your project root:

```markdown
# Project Instructions

## Nella — Always-On Reliability

This project uses Nella for code reliability. Follow these rules on EVERY task:

1. **Before making changes:** Call `nella_search` to understand the relevant code and `nella_get_context` to review session state.
2. **Track assumptions:** Call `nella_add_assumption` to document any assumptions you're making about the codebase.
3. **After making changes:** Call `nella_check_assumptions` to verify assumptions still hold and `nella_check_dependencies` to detect if anything changed under you.

### Workflow

For every code change, follow this sequence:
1. `nella_search` → find relevant code
2. `nella_get_context` → review session state
3. `nella_add_assumption` → document assumptions
4. Make the changes
5. `nella_check_assumptions` → verify assumptions
6. `nella_check_dependencies` → detect dependency changes
```

### Cursor — `.cursorrules`

Create a `.cursorrules` file in your project root:

```text
# Nella — Always-On Reliability

This project uses Nella for code reliability. On EVERY task:

1. Before making changes: Call nella_search to find relevant code and nella_get_context to review session state.
2. Document assumptions: Call nella_add_assumption for any assumptions about the codebase.
3. After making changes: Call nella_check_assumptions and nella_check_dependencies.

Workflow: nella_search → nella_get_context → nella_add_assumption → make changes → nella_check_assumptions → nella_check_dependencies
```

### GitHub Copilot — `.github/copilot-instructions.md`

Create `.github/copilot-instructions.md` in your repository:

```markdown
# Nella — Always-On Reliability

This project uses Nella for code reliability. Follow these rules on every task:

1. Before making changes, call `nella_search` to find relevant code and `nella_get_context` to review session state.
2. Document assumptions with `nella_add_assumption`.
3. After making changes, call `nella_check_assumptions` and `nella_check_dependencies` to verify nothing broke.
```

### Windsurf — `.windsurfrules`

Create a `.windsurfrules` file in your project root with the same content as the `.cursorrules` example above.

> **Tip:** You can customize the instructions in each snippet to match your project. The examples above are starting points — adapt the workflow steps to your needs.

## Choosing the Right Tool

Nella exposes 6 MCP tools:

| Scenario | Tool | Why |
|----------|------|-----|
| Find relevant code | `nella_search` | Hybrid semantic + lexical search across indexed files |
| Review session state | `nella_get_context` | See all tracked changes, assumptions, and dependencies |
| Document an assumption | `nella_add_assumption` | Records assumptions the agent is making (can be checked for conflicts later) |
| Verify assumptions | `nella_check_assumptions` | Check that recorded assumptions still hold |
| Detect dependency changes | `nella_check_dependencies` | Detect if a dependency changed under you |
| Index the codebase | `nella_index` | Build search index for fast hybrid search |

### Decision Flowchart

```
Starting a task?
  │
  ├─ Need to find relevant code? → nella_search
  │
  ├─ Need session context? → nella_get_context
  │
  ├─ Making assumptions? → nella_add_assumption
  │
  ├─ After making changes:
  │   ├─ Verify assumptions → nella_check_assumptions
  │   └─ Check for dependency changes → nella_check_dependencies
  │
  └─ First time on this codebase? → nella_index
```

## Prompt Engineering for Agents

The way you phrase prompts significantly affects whether the agent uses Nella tools effectively.

### Good Prompt Patterns

**Be explicit about constraints:**

```
Add a GET /users/:id endpoint.
Constraints: Don't modify auth files, no console.log, no hardcoded secrets.
Search the codebase first to understand existing patterns.
```

**Reference task files:**

```
Complete the task defined in tasks/add-user-endpoint/task.yaml.
Search for related code first and document your assumptions.
```

**Ask for the full workflow:**

```
Add pagination to the /posts endpoint.
Before starting, search for existing pagination patterns.
After changes, check assumptions and dependencies.
```

### Patterns to Avoid

- "Just add the endpoint" — no constraints, no context gathering
- "Fix the bug" — too vague, no scope boundaries
- Asking the agent to skip checks — "don't bother searching"

> **Tip:** Even without explicit instructions, if you've set up the always-on `Claude.md` / `.cursorrules` file, the agent will use Nella automatically. The prompt tips above are for cases where you want extra control.

## Constraint Authoring Best Practices

### Keep `files_to_modify` Narrow

The tighter the scope, the less chance of scope creep:

```yaml
# Good — specific files
expected:
  files_to_modify:
    - "src/routes/users.ts"
    - "src/routes/users.test.ts"

# Avoid — too broad
expected:
  files_to_modify:
    - "src/**"
```

### Use `forbidden_patterns` for Security

```yaml
constraints:
  - id: no-secrets
    description: No hardcoded secrets
    forbidden_patterns:
      - "password\\s*="
      - "secret\\s*="
      - "token\\s*="
      - "API_KEY\\s*="
  - id: no-debug-logging
    description: No debug logging in production
    forbidden_patterns:
      - "console\\.log"
      - "console\\.debug"
      - "debugger"
```

### Protect Critical Files

```yaml
constraints:
  - id: protect-auth
    description: Auth files are read-only
    files_not_to_modify:
      - "src/auth/**"
      - "src/middleware/auth*"
  - id: protect-config
    description: Config files are read-only
    files_not_to_modify:
      - "*.config.js"
      - "*.config.ts"
      - ".env*"
```

### Layer Constraints

Combine multiple constraint types for defense-in-depth:

```yaml
constraints:
  # Layer 1: File protection
  - id: protect-infra
    files_not_to_modify:
      - "infrastructure/**"
      - "docker-compose.yml"

  # Layer 2: Code quality
  - id: no-any-types
    forbidden_patterns:
      - ": any"
      - "as any"

  # Layer 3: Security
  - id: no-eval
    forbidden_patterns:
      - "eval("
      - "Function("
      - "innerHTML"
```

## Workflow Patterns

### Solo Developer — Search → Edit → Verify

This is the default loop with always-on Nella:

1. Describe the task to your AI agent
2. Agent runs `nella_search` to find relevant code (auto, via Claude.md)
3. Agent makes changes
4. Agent runs `nella_check_assumptions` (auto, via Claude.md)
5. You review and commit

### Team — Shared Constraints + CI Gate

1. Define shared constraints in a `tasks/` directory in your repo
2. Each team member's agent uses the same constraint files
3. Add Nella to your CI pipeline as a gate

See the [CI/CD Integration guide](../user-guide/ci-cd-integration.md) for full examples.

### Multi-Workspace — Route to the Right Project

If you work across multiple repos, configure Nella with per-project workspaces:

```json
{
  "mcpServers": {
    "nella-frontend": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp"],
      "env": { "NELLA_REPO_PATH": "/path/to/frontend" }
    },
    "nella-backend": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp"],
      "env": { "NELLA_REPO_PATH": "/path/to/backend" }
    }
  }
}
```

### Context Tracking — Maintain State Across Sessions

Use context tools to keep track of what happened over long tasks:

```
1. nella_add_assumption — "The users table has an 'email' column"
2. nella_check_assumptions — verify assumptions are still valid
3. nella_check_dependencies — detect if a dependency changed under you
4. nella_get_context — review the full session state
```

Context persists across sessions via `.nella/context/` in your project directory.

## Performance Tips

- **Index once, search many times** — run `nella_index` on your codebase once, then use `nella_search` for instant hybrid search in subsequent tasks.
- **Use the hosted server for teams** — instead of each developer running their own local server, use the hosted MCP at `https://mcp.getnella.dev/mcp` for shared state and telemetry.

## Troubleshooting Quick Reference

| Problem | Quick Fix |
|---------|-----------|
| MCP tools not appearing in agent | Restart the MCP client; verify config path is correct |
| "Workspace not found" error | Set `NELLA_REPO_PATH` env var or pass `--workspace` flag with absolute path |
| Context not persisting | Check that `.nella/` directory is writable; don't gitignore `.nella/context/` |
| Search returning no results | Run `nella_index` first to build the search index |

For full troubleshooting, see the [Troubleshooting guide](../troubleshooting.md).

## Next Steps

- [MCP Tools Reference](../mcp/tools.md) — Full reference for all tools
- [Task Authoring](../user-guide/task-authoring.md) — Write effective task definitions
- [Constraints](../configuration/constraints.md) — Deep dive into constraint configuration
- [CI/CD Integration](../user-guide/ci-cd-integration.md) — Add Nella to your pipeline
- [Claude Desktop Setup](../integrations/claude-desktop.md) — Detailed Claude Desktop configuration
- [Cursor Setup](../integrations/cursor.md) — Detailed Cursor configuration
