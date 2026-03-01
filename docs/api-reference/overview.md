# API Reference

Complete reference for all Nella MCP tools.

Nella provides 12 MCP tools organized into three categories: Validation, Safety, and Context.

## Tool Categories

### Validation Tools

Tools for checking constraints and running validations:

| Tool | Description |
|------|-------------|
| [`nella_check`](./tools/nella-check.md) | Quick constraint validation without running test suites |
| [`nella_validate`](./tools/nella-validate.md) | Run validation commands (tests, lints, builds) |
| [`nella_run`](./tools/nella-run.md) | Complete validation workflow with all checks |

### Safety Tools

Tools for detecting risks and determining task safety:

| Tool | Description |
|------|-------------|
| [`nella_detect_risks`](./tools/nella-detect-risks.md) | Analyze content for risky patterns (57 built-in patterns) |
| [`nella_should_refuse`](./tools/nella-should-refuse.md) | Determine if a task should be refused |
| [`nella_check_prerequisites`](./tools/nella-check-prerequisites.md) | Verify workspace prerequisites are met |

### Context Tools

Tools for managing session context and assumptions:

| Tool | Description |
|------|-------------|
| [`nella_get_context`](./tools/context-tools.md#nella_get_context) | Get full session context |
| [`nella_add_assumption`](./tools/context-tools.md#nella_add_assumption) | Record an assumption about the codebase |
| [`nella_check_assumptions`](./tools/context-tools.md#nella_check_assumptions) | Get status of recorded assumptions |
| [`nella_get_file_history`](./tools/context-tools.md#nella_get_file_history) | Get change history for a file |
| [`nella_check_dependencies`](./tools/context-tools.md#nella_check_dependencies) | Check for dependency changes |
| [`nella_record_change`](./tools/context-tools.md#nella_record_change) | Manually record file changes |

See [Context Tools](./tools/context-tools.md) for details on all context management tools.

## Authentication

Nella MCP server supports API key authentication with optional features:

| Feature | Description |
|---------|-------------|
| API Keys | Issue and manage API keys with permissions |
| JWT Tokens | Short-lived session tokens |
| Key Rotation | Automatic key rotation policies |
| Rate Limiting | Per-key request throttling |
| Audit Logging | Persistent security audit trail |

```bash
# Start with auth enabled
npx @getnella/mcp mcp --workspace /path/to/project --auth
```

See [Authentication](../core/auth.md) for complete setup.

## Setup

Start the MCP server with:

```bash
npx @getnella/mcp mcp --workspace /path/to/project
```

**Claude Desktop Config:**

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@getnella/mcp", "-w", "/path/to/project"]
    }
  }
}
```

## Response Format

All Nella tools return responses in a consistent markdown format:

```
## [Tool Name] Results

[Status icon] [Summary]

### [Section 1]
[Details...]

### [Section 2]
[Details...]
```

> **Note:** Nella implements the Model Context Protocol (MCP). Tools are called through MCP's standard tool calling mechanism.

## Tool Selection Guide

Choose the right tool based on your needs:

| If you want to... | Use |
|--------------------|-----|
| Check constraints quickly | `nella_check` |
| Run tests/lints/compile | `nella_validate` |
| Complete validation workflow | `nella_run` |
| Analyze text for risks | `nella_detect_risks` |
| Check if task is safe | `nella_should_refuse` |
| Track changes and context | Context tools |

## Common Workflows

### Pre-flight Check

1. `nella_should_refuse` — Check if task is safe
2. `nella_check_prerequisites` — Verify project setup
3. `nella_get_context` — See what's already been done

### Making Changes

1. `nella_add_assumption` — Record assumptions
2. Make code changes
3. `nella_record_change` — Track what was changed
4. `nella_validate` — Run tests

### Final Validation

1. `nella_check_assumptions` — Verify assumptions still valid
2. `nella_check_dependencies` — Check for drift
3. `nella_run` — Full validation with metrics

## Quick Examples

### Check constraints

```typescript
nella_check({
  constraints: [{ id: 'no-config', description: 'Protect config', filesNotToModify: ['*.json'] }],
  modifiedFiles: ['src/app.ts'],
  diff: '+ console.log("hello");',
});
```

### Run validation

```typescript
nella_validate({
  test: 'npm test',
  lint: 'npm run lint',
});
```

### Complete workflow

```typescript
nella_run({
  taskId: 'task-001',
  taskName: 'Add feature',
  prompt: 'Add user authentication',
  constraints: [...],
  validation: { test: 'npm test' },
  expectedFiles: ['src/auth.ts'],
  changes: [{ path: 'src/auth.ts', operation: 'create', content: '...' }],
});
```
