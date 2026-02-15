# nella_check_prerequisites

Verify workspace prerequisites are met before starting work.

The `nella_check_prerequisites` tool verifies that the workspace has all required prerequisites before starting work. This helps prevent issues caused by missing dependencies or incomplete project setup.

## Parameters

None — uses the workspace path configured at server startup.

## Example

```typescript
nella_check_prerequisites({});
```

## Response

### All Prerequisites Met

```
## Prerequisite Check Results

✅ All prerequisites met

### Checks
- ✅ **package.json**: Found at workspace root
- ✅ **node_modules**: Dependencies installed (1,247 packages)
```

### Prerequisites Missing

```
## Prerequisite Check Results

❌ 1 prerequisite(s) not met

### Checks
- ✅ **package.json**: Found at workspace root
- ❌ **node_modules**: Missing — run `npm install` first

### Action Required
Please run `npm install` before proceeding with code changes.
```

## Checks Performed

| Check | Description |
|-------|-------------|
| `package.json` | Verifies a package.json file exists in the workspace root |
| `node_modules` | Verifies dependencies are installed (directory exists and is not empty) |

## Use Cases

### Pre-flight Check

Always check prerequisites before starting a coding session:

```typescript
// 1. First, check prerequisites
const prereqs = await nella_check_prerequisites({});

// 2. If failed, fix issues before proceeding
if (!prereqs.passed) {
  // Inform user to run npm install
}

// 3. Then continue with task
```

### CI/CD Integration

Use as a gatekeeper in automated workflows:

```typescript
const prereqs = await nella_check_prerequisites({});
if (!prereqs.passed) {
  throw new Error('Prerequisites not met - run npm install');
}
```

> **Tip:** When using `runTask()` from the core library, you can skip prerequisite checks with `skipPrerequisites: true`. This is useful for testing or when you know the workspace is properly set up.

## Related Tools

- [`nella_should_refuse`](./nella-should-refuse.md) — Pre-flight task safety check
- [`nella_run`](./nella-run.md) — Complete validation workflow (includes prerequisite check)
