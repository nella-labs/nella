# nella_validate

Run validation commands (tests, lints, builds) to verify changes work correctly.

The `nella_validate` tool runs validation commands to verify that changes work correctly. It executes tests, lints, and compile checks.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `test` | `string` | No | Test command (e.g., `npm test`) |
| `lint` | `string` | No | Lint command (e.g., `npm run lint`) |
| `compile` | `string` | No | Compile/typecheck command |

> **Note:** All parameters are optional. Only the provided commands will be executed.

## Example

```typescript
nella_validate({
  test: 'npm test',
  lint: 'npm run lint',
  compile: 'tsc --noEmit',
});
```

## Response

### All Validations Passed

```
## Validation Results

✅ All validations passed

### Test
- Command: `npm test`
- Status: ✅ Passed
- Duration: 4.2s

### Lint
- Command: `npm run lint`
- Status: ✅ Passed
- Duration: 1.1s

### Compile
- Command: `tsc --noEmit`
- Status: ✅ Passed
- Duration: 2.8s
```

### Validation Failed

```
## Validation Results

❌ 1 of 3 validations failed

### Test
- Command: `npm test`
- Status: ❌ Failed (exit code 1)
- Duration: 3.5s
- Output:
  FAIL src/auth.test.ts
    ✕ should authenticate valid user (15ms)

  Expected: true
  Received: false

### Lint
- Command: `npm run lint`
- Status: ✅ Passed
- Duration: 1.0s

### Compile
- Command: `tsc --noEmit`
- Status: ✅ Passed
- Duration: 2.6s
```

## Use Cases

### Full Validation

Run all validation commands:

```typescript
nella_validate({
  test: 'npm test',
  lint: 'npm run lint',
  compile: 'tsc --noEmit',
});
```

### Tests Only

```typescript
nella_validate({
  test: 'npm test',
});
```

### Targeted Tests

```typescript
nella_validate({
  test: 'npm test -- --testPathPattern=auth',
});
```

### Type Checking Only

```typescript
nella_validate({
  compile: 'tsc --noEmit',
});
```

## Execution Order

Commands are executed in this order:

1. Test
2. Lint
3. Compile

> **Warning:** Commands run sequentially, not in parallel. If one fails, subsequent commands still run.

## Exit Codes

| Exit Code | Meaning |
|-----------|---------|
| 0 | Command passed |
| Non-zero | Command failed |

The tool captures stderr output for failed commands to help diagnose issues.

## Related Tools

- [`nella_check`](./nella-check.md) — Quick constraint validation
- [`nella_run`](./nella-run.md) — Complete validation workflow
