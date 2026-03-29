# Task Authoring

Tasks are YAML files that describe what the AI agent should do, what constraints to enforce, and what files should change. This guide covers every aspect of writing effective task definitions.

## Task Structure

A complete task definition:

```yaml
id: get-user-by-id
name: Add GET /users/:id endpoint
category: feature
difficulty: easy
fixture: my-express-app

prompt: |
  Add a GET /users/:id endpoint that returns a user by ID.
  Return 404 if the user doesn't exist.

expected:
  files_to_modify:
    - "src/routes/users.ts"
  files_to_ignore:
    - "**/*.test.ts"
  expected_line_count: 40

timeout_seconds: 120
```

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (used in CLI and artifact paths) |
| `name` | string | Human-readable task name |
| `category` | string | One of: `feature`, `bug-fix`, `refactor`, `edge-case`, `refusal` |
| `difficulty` | string | One of: `easy`, `medium`, `hard` |
| `prompt` | string | The task description given to the AI agent |

## Expected Changes

The `expected` section helps Nella detect scope creep — when the agent modifies files outside the intended scope:

```yaml
expected:
  files_to_modify:
    - "src/routes/users.ts"
    - "src/models/user.ts"
  files_to_ignore:
    - "**/*.test.ts"
    - "**/*.spec.ts"
  expected_line_count: 40
```

| Field | Description |
|-------|-------------|
| `files_to_modify` | Files the agent is expected to change. Any other modified file increases the scope creep ratio |
| `files_to_ignore` | Files to exclude from scope creep analysis (e.g., test files) |
| `expected_line_count` | Approximate expected diff size. Used for diff accuracy metrics |

### Scope Creep Ratio

Calculated as:

```
scope_creep = (unexpected_files / total_modified_files)
```

A ratio of `0.0` means all changes were within scope. A ratio of `0.5` means half the modified files were unexpected.

## Fixture Reference

The `fixture` field points to a template project in `fixtures/`:

```yaml
fixture: my-express-app
```

For CLI usage, you specify the repo path directly with `-r`.

## Task Categories

| Category | Purpose | Example |
|----------|---------|---------|
| `feature` | Add new functionality | Add a REST endpoint |
| `bug-fix` | Fix existing behavior | Fix pagination offset error |
| `refactor` | Restructure without changing behavior | Extract service class |
| `edge-case` | Test unusual inputs or boundaries | Handle whitespace-only strings |

## Best Practices

1. **Be specific in constraints** — Vague constraints like "don't break anything" are unenforceable. Use specific file patterns and forbidden strings
2. **Use `files_to_ignore` for test files** — Test files often change alongside source, but shouldn't count as scope creep
3. **Set realistic `timeout_seconds`** — Default is 120s. Increase for tasks requiring large test suites
4. **Group related constraints** — Each constraint should check one thing. Multiple narrow constraints are better than one broad one
5. **Test your task definitions** — Verify the task YAML parses correctly before giving it to an agent

## Related Docs

- [Configuration Reference](../core/configuration.md) — Full schema for `RunTaskOptions`
- [CLI Commands](../cli/commands.md) — How to use tasks with the CLI
