# nella_run

Complete Nella validation workflow with all checks.

The `nella_run` tool executes the complete Nella validation workflow, combining refusal checks, constraint validation, test execution, and scope analysis.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | `string` | Yes | Unique task identifier |
| `taskName` | `string` | Yes | Human-readable task name |
| `prompt` | `string` | Yes | The original task prompt |
| `constraints` | `Constraint[]` | No | Constraints to check |
| `validation` | `ValidationConfig` | No | Validation commands |
| `expectedFiles` | `string[]` | No | Files expected to be modified |
| `changes` | `Change[]` | Yes | The file changes to validate |

### Change Object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `path` | `string` | Yes | File path relative to workspace |
| `operation` | `"create" \| "modify" \| "delete"` | Yes | Type of operation |
| `content` | `string` | No | File content (for create/modify) |

### ValidationConfig Object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `test` | `string` | No | Test command |
| `lint` | `string` | No | Lint command |
| `compile` | `string` | No | Compile command |

## Example

```typescript
nella_run({
  taskId: 'auth-refactor-001',
  taskName: 'Refactor authentication to async/await',
  prompt: 'Please refactor the auth module to use async/await instead of callbacks',
  constraints: [
    {
      id: 'no-migration-changes',
      description: 'Do not modify database migrations',
      filesNotToModify: ['**/migrations/**'],
    },
    {
      id: 'no-console-log',
      description: 'No console.log in production code',
      forbiddenPatterns: ['console\\.log\\('],
    },
  ],
  validation: {
    test: 'npm test -- --testPathPattern=auth',
    lint: 'npm run lint',
    compile: 'tsc --noEmit',
  },
  expectedFiles: ['src/auth/index.ts', 'src/auth/utils.ts'],
  changes: [
    {
      path: 'src/auth/index.ts',
      operation: 'modify',
      content: 'export async function authenticate(user: User) { ... }',
    },
    {
      path: 'src/auth/utils.ts',
      operation: 'modify',
      content: 'export async function validateToken(token: string) { ... }',
    },
  ],
});
```

## Response

### Passed

```
## Nella Run Results

✅ **PASSED**

### Summary
- Run ID: 2026-01-16_abc123
- Task: Refactor authentication to async/await
- Duration: 8.2s

### Metrics

| Metric | Value |
|--------|-------|
| Scope Creep | 0.00 |
| Constraint Violations | 0 |
| Validation Integrity | 1.00 |

### Constraints
✅ All 2 constraints passed

### Validation
- ✅ test: Passed (3.5s)
- ✅ lint: Passed (1.2s)
- ✅ compile: Passed (2.8s)

### Scope Analysis
- Expected files: 2
- Modified files: 2
- Extra files: 0
- Missing files: 0
```

### Failed

```
## Nella Run Results

❌ **FAILED**

### Summary
- Run ID: 2026-01-15_xyz789
- Task: Refactor authentication to async/await
- Duration: 5.1s

### Metrics

| Metric | Value |
|--------|-------|
| Scope Creep | 0.50 |
| Constraint Violations | 1 |
| Validation Integrity | 0.00 |

### Constraints
❌ 1 violation(s)
- **no-console-log**: Found pattern `console\.log\(` in diff

### Validation
- ❌ test: Failed (2.1s)
- ✅ lint: Passed (1.0s)
- ✅ compile: Passed (1.5s)

### Scope Analysis
- Expected files: 2
- Modified files: 3
- Extra files: 1
- Missing files: 0
```

### Refused

```
## Nella Run Results

🚫 **REFUSED**

### Risk Analysis
Detected 3 risk patterns:
- `password.*=` — credential_exposure
- `disable.*auth` — security_bypass
- `delete.*from.*users` — data_exposure

Task refused due to high risk.
```

## Workflow

`nella_run` executes the following steps:

1. **Refusal Check** — Analyze prompt for risk patterns
2. **Constraint Check** — Validate files and content against constraints
3. **Scope Analysis** — Compare expected vs actual file changes
4. **Validation** — Run test, lint, and compile commands
5. **Metrics** — Calculate scope creep, violations, validation integrity
6. **Context Update** — Record changes in session

> **Note:** `nella_run` combines the functionality of `nella_should_refuse`, `nella_check`, and `nella_validate` into a single comprehensive workflow.

## Metrics

### Scope Creep

Measures how much the changes deviated from expectations:

```
scope_creep = extra_files / max(expected_files, 1)
```

- `0.0` — No unexpected files
- `0.5` — Half as many extra files as expected
- `1.0+` — More extra files than expected

### Constraint Violation Rate

```
violation_rate = violated_constraints / total_constraints
```

### Validation Integrity

```
validation_integrity = passed_commands / total_commands
```

## Artifacts

Each run produces artifacts in `.nella/runs/{runId}/`:

```
.nella/runs/2026-01-16_abc123/
├── logs.jsonl          # Structured log entries
├── diff.patch          # Git diff of all changes
├── metrics.json        # Computed metrics
```

## Related Tools

- [`nella_check`](./nella-check.md) — Quick constraint validation
- [`nella_validate`](./nella-validate.md) — Run validation commands
- [`nella_should_refuse`](./nella-should-refuse.md) — Pre-flight refusal check
