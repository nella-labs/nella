# nella_check

Quick constraint validation without running full test suites.

The `nella_check` tool performs fast constraint validation against file changes. Use it for quick feedback before committing to changes.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `constraints` | `Constraint[]` | Yes | Array of constraints to check |
| `modifiedFiles` | `string[]` | Yes | List of files that were modified |
| `diff` | `string` | Yes | Git diff of the changes |

### Constraint Object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier for the constraint |
| `description` | `string` | Yes | Human-readable description |
| `rule` | `string` | No | Rule statement (documentation only) |
| `filesNotToModify` | `string[]` | No | Glob patterns for forbidden files |
| `forbiddenPatterns` | `string[]` | No | Regex patterns forbidden in diff |

## Example

```typescript
nella_check({
  constraints: [
    {
      id: 'no-config-changes',
      description: 'Do not modify configuration files',
      filesNotToModify: ['package.json', 'tsconfig.json', '.env*'],
    },
    {
      id: 'no-console-log',
      description: 'No console.log statements',
      forbiddenPatterns: ['console\\.log\\('],
    },
  ],
  modifiedFiles: ['src/auth.ts', 'src/utils.ts'],
  diff: `
diff --git a/src/auth.ts b/src/auth.ts
index 1234567..abcdefg 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,6 +10,7 @@ export function authenticate(user: User) {
+  console.log('Authenticating user:', user.id);
   return validateCredentials(user);
 }
  `,
});
```

## Response

### All Constraints Passed

```
## Constraint Check Results

✅ All constraints passed

### Checked Constraints
- ✅ **no-config-changes**: Do not modify configuration files
- ✅ **no-console-log**: No console.log statements
```

### Constraints Violated

```
## Constraint Check Results

❌ 1 constraint(s) violated

### Violations
- **no-console-log**: Found pattern `console\.log\(` in diff

### Passed Constraints
- ✅ **no-config-changes**: Do not modify configuration files
```

## Use Cases

### Pre-change Validation

Check constraints before making changes:

```typescript
// 1. Check if planned changes would violate constraints
const result = await nella_check({
  constraints: projectConstraints,
  modifiedFiles: plannedFiles,
  diff: '', // Empty diff for pre-check
});

// 2. If passed, proceed with changes
// 3. After changes, check again with actual diff
```

### Post-change Verification

Verify changes after they're made:

```typescript
// 1. Make changes
// 2. Generate diff
const diff = await exec('git diff');

// 3. Check constraints
const result = await nella_check({
  constraints: projectConstraints,
  modifiedFiles: changedFiles,
  diff,
});
```

> **Tip:** `nella_check` is designed for speed. It only checks constraints — it doesn't run tests, lints, or compile commands. Use `nella_validate` or `nella_run` for full validation.

## Related Tools

- [`nella_validate`](./nella-validate.md) — Run validation commands
- [`nella_run`](./nella-run.md) — Complete validation workflow
