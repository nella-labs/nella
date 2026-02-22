# Tips & Best Practices

Practical tips for getting the most out of Nella — from always-on agent reliability to constraint authoring and team workflows.

## Always-On Nella

The most impactful thing you can do is configure your AI agent to **always use Nella tools**, without you having to ask every time. Most AI coding agents support project-level instruction files that are automatically included in every conversation.

Add Nella instructions to the appropriate file for your editor, and the agent will automatically check constraints, validate changes, and detect risks on every task.

### Claude Code / Claude Desktop — `Claude.md`

Create a `Claude.md` file in your project root:

```markdown
# Project Instructions

## Nella — Always-On Reliability

This project uses Nella for code reliability. Follow these rules on EVERY task:

1. **Before making changes:** Call `nella_check` with the task constraints and your planned file modifications. Do not proceed if constraints fail.
2. **After making changes:** Call `nella_validate` to run tests, lint, and type checking. Fix any failures before reporting completion.
3. **For risky operations** (deleting files, modifying configs, changing auth logic): Call `nella_detect_risks` first and report any risks found.
4. **If a task seems dangerous or out of scope:** Call `nella_should_refuse` to check whether it should be declined.
5. **Before complex tasks:** Call `nella_check_prerequisites` to verify the environment is ready (dependencies installed, services running, etc.).

### Default Constraints

Always enforce these constraints unless the task explicitly overrides them:

- Do not modify files in `src/auth/**` or `src/config/**` without explicit permission
- No `console.log` in production code
- No hardcoded secrets, tokens, or passwords
- Do not modify lock files (`package-lock.json`, `pnpm-lock.yaml`)

### Workflow

For every code change, follow this sequence:
1. `nella_check_prerequisites` → verify environment
2. `nella_check` → verify constraints before editing
3. Make the changes
4. `nella_validate` → run tests + lint + typecheck
5. `nella_record_change` → log what was modified and why
```

### Cursor — `.cursorrules`

Create a `.cursorrules` file in your project root:

```text
# Nella — Always-On Reliability

This project uses Nella for code reliability. On EVERY task:

1. Before making changes: Call nella_check with constraints and planned modifications.
2. After making changes: Call nella_validate to run tests, lint, and type checking.
3. For risky operations (file deletion, config changes, auth changes): Call nella_detect_risks first.
4. If a task seems dangerous or out of scope: Call nella_should_refuse.
5. Before complex tasks: Call nella_check_prerequisites.

Default constraints to always enforce:
- Do not modify files in src/auth/** or src/config/**
- No console.log in production code
- No hardcoded secrets, tokens, or passwords
- No modifications to lock files

Workflow: nella_check_prerequisites → nella_check → make changes → nella_validate → nella_record_change
```

### GitHub Copilot — `.github/copilot-instructions.md`

Create `.github/copilot-instructions.md` in your repository:

```markdown
# Nella — Always-On Reliability

This project uses Nella for code reliability. Follow these rules on every task:

1. Before making changes, call `nella_check` with the task constraints and your planned file modifications. Do not proceed if constraints fail.
2. After making changes, call `nella_validate` to run tests, lint, and type checking. Fix any failures before reporting completion.
3. For risky operations (deleting files, modifying configs, changing auth logic), call `nella_detect_risks` first.
4. If a task seems dangerous or out of scope, call `nella_should_refuse`.
5. Before complex tasks, call `nella_check_prerequisites` to verify the environment is ready.

Default constraints:
- Do not modify files in `src/auth/**` or `src/config/**` without explicit permission
- No `console.log` in production code
- No hardcoded secrets, tokens, or passwords
- Do not modify lock files
```

### Windsurf — `.windsurfrules`

Create a `.windsurfrules` file in your project root with the same content as the `.cursorrules` example above.

> **Tip:** You can customize the default constraints in each snippet to match your project. The examples above are starting points — add your own `files_not_to_modify` globs, `forbidden_patterns`, and workflow steps.

## Choosing the Right Tool

Nella exposes 23 MCP tools. Here's when to use the most important ones:

| Scenario | Tool | Why |
|----------|------|-----|
| Quick check before editing | `nella_check` | Validates constraints without running tests — fast, lightweight |
| Full validation after editing | `nella_validate` | Runs tests, lint, and typecheck to verify nothing broke |
| End-to-end in one call | `nella_run` | Combines `nella_check` + `nella_validate` in a single operation |
| Before risky operations | `nella_detect_risks` | Flags file deletions, config changes, auth modifications, secret exposure |
| Task seems out of scope | `nella_should_refuse` | Determines if the task should be declined (destructive, unethical, out-of-scope) |
| Before starting a complex task | `nella_check_prerequisites` | Verifies deps installed, services running, env vars set |
| Track what changed | `nella_record_change` | Logs the modification for context persistence across sessions |
| Record an assumption | `nella_add_assumption` | Documents assumptions the agent is making (can be checked for conflicts later) |
| Search the codebase | `nella_search` | Hybrid semantic + lexical search across indexed files |

### Decision Flowchart

```
Starting a task?
  │
  ├─ Is it a complex task? → nella_check_prerequisites
  │
  ├─ Does it seem risky or out of scope? → nella_should_refuse
  │
  ├─ Ready to make changes?
  │   ├─ Check constraints first → nella_check
  │   ├─ Make the changes
  │   ├─ Validate after → nella_validate
  │   └─ Log it → nella_record_change
  │
  └─ Want it all in one shot? → nella_run
```

## Prompt Engineering for Agents

The way you phrase prompts significantly affects whether the agent uses Nella tools effectively.

### Good Prompt Patterns

**Be explicit about constraints:**

```
Add a GET /users/:id endpoint.
Constraints: Don't modify auth files, no console.log, no hardcoded secrets.
Run Nella checks before and after.
```

**Reference task files:**

```
Complete the task defined in tasks/add-user-endpoint/task.yaml.
Use Nella to validate against all constraints.
```

**Ask for the full workflow:**

```
Add pagination to the /posts endpoint.
Before starting, check prerequisites with Nella.
After changes, validate with Nella and record what you changed.
```

### Patterns to Avoid

- "Just add the endpoint" — no constraints, no validation request
- "Fix the bug" — too vague, no scope boundaries
- Asking the agent to skip validation — "don't bother checking"

> **Tip:** Even without explicit constraint instructions, if you've set up the always-on `Claude.md` / `.cursorrules` file, the agent will use Nella automatically. The prompt tips above are for cases where you want extra control.

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

### Solo Developer — Pre-flight → Edit → Validate → Commit

This is the default loop with always-on Nella:

1. Describe the task to your AI agent
2. Agent runs `nella_check` (auto, via Claude.md)
3. Agent makes changes
4. Agent runs `nella_validate` (auto, via Claude.md)
5. You review and commit

### Team — Shared Constraints + CI Gate

1. Define shared constraints in a `tasks/` directory in your repo
2. Each team member's agent uses the same constraint files
3. Add Nella to your CI pipeline as a gate:

```yaml
# .github/workflows/nella.yml
- name: Nella validate
  run: npx @getnella/latest validate --workspace . --test "npm test" --lint "npm run lint"
```

See the [CI/CD Integration guide](../user-guide/ci-cd-integration.md) for full examples.

### Multi-Workspace — Route to the Right Project

If you work across multiple repos, configure Nella with per-project workspaces:

```json
{
  "mcpServers": {
    "nella-frontend": {
      "command": "npx",
      "args": ["-y", "@getnella/latest", "mcp"],
      "env": { "NELLA_REPO_PATH": "/path/to/frontend" }
    },
    "nella-backend": {
      "command": "npx",
      "args": ["-y", "@getnella/latest", "mcp"],
      "env": { "NELLA_REPO_PATH": "/path/to/backend" }
    }
  }
}
```

### Context Tracking — Maintain State Across Sessions

Use context tools to keep track of what happened over long tasks:

```
1. nella_add_assumption — "The users table has an 'email' column"
2. nella_record_change — "Added GET /users/:id endpoint in src/routes/users.ts"
3. nella_check_assumptions — verify assumptions are still valid
4. nella_check_dependencies — detect if a dependency changed under you
5. nella_get_context — review the full session state
```

Context persists across sessions via `.nella/context/` in your project directory.

## Performance Tips

- **Use `nella_check` before `nella_validate`** — check is fast (constraint matching only), validate is slower (runs tests/lint). Fail fast on constraint violations before invoking the full test suite.
- **Use `skipValidation` for fast local checks** — when iterating quickly, skip test/lint to get instant constraint feedback. Keep full validation enabled in CI.
- **Index once, search many times** — run `nella_index` on your codebase once, then use `nella_search` for instant hybrid search in subsequent tasks.
- **Use the hosted server for teams** — instead of each developer running their own local server, use the hosted MCP at `https://mcp.getnella.dev/mcp` for shared state and telemetry.

## Troubleshooting Quick Reference

| Problem | Quick Fix |
|---------|-----------|
| MCP tools not appearing in agent | Restart the MCP client; verify config path is correct |
| `nella_check` passes but `nella_validate` fails | Constraints are fine but tests/lint fail — check the code changes |
| "Workspace not found" error | Set `NELLA_REPO_PATH` env var or pass `--workspace` flag with absolute path |
| Context not persisting | Check that `.nella/` directory is writable; don't gitignore `.nella/context/` |
| Slow validation | Use `skipValidation` for iteration; ensure test command isn't running full suite |

For full troubleshooting, see the [Troubleshooting guide](../troubleshooting.md).

## Next Steps

- [MCP Tools Reference](../mcp/tools.md) — Full reference for all 23 tools
- [Task Authoring](../user-guide/task-authoring.md) — Write effective task definitions
- [Constraints](../configuration/constraints.md) — Deep dive into constraint configuration
- [CI/CD Integration](../user-guide/ci-cd-integration.md) — Add Nella to your pipeline
- [Claude Desktop Setup](../integrations/claude-desktop.md) — Detailed Claude Desktop configuration
- [Cursor Setup](../integrations/cursor.md) — Detailed Cursor configuration
