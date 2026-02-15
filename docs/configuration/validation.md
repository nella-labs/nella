# Validation

Configure test, lint, and compile commands for change verification.

Validation commands verify that changes work correctly. Nella can run tests, lints, and compile checks after the AI agent makes changes.

## Validation Configuration

The validation object accepts three optional commands:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `test` | `string` | No | Command to run tests (e.g., `npm test`) |
| `lint` | `string` | No | Command to run lints (e.g., `npm run lint`) |
| `compile` | `string` | No | Command to run type checking (e.g., `tsc --noEmit`) |

## Basic Configuration

```typescript
const validation = {
  test: 'npm test',
  lint: 'npm run lint',
  compile: 'tsc --noEmit',
};
```

## Framework Examples

### Node.js / npm

```typescript
const validation = {
  test: 'npm test',
  lint: 'npm run lint',
  compile: 'npm run typecheck',
};
```

### pnpm

```typescript
const validation = {
  test: 'pnpm test',
  lint: 'pnpm lint',
  compile: 'pnpm typecheck',
};
```

### Yarn

```typescript
const validation = {
  test: 'yarn test',
  lint: 'yarn lint',
  compile: 'yarn typecheck',
};
```

### Python / pytest

```typescript
const validation = {
  test: 'pytest',
  lint: 'ruff check .',
  compile: 'mypy .',
};
```

### Go

```typescript
const validation = {
  test: 'go test ./...',
  lint: 'golangci-lint run',
  compile: 'go build ./...',
};
```

### Rust

```typescript
const validation = {
  test: 'cargo test',
  lint: 'cargo clippy',
  compile: 'cargo check',
};
```

## Validation Results

Nella returns detailed results for each validation command:

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

### Failed Validation

When a validation fails, Nella includes the error output:

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

> **Note:** You can provide just the commands you need. For example, if you only want to run tests, just provide the `test` field.

## Advanced Configuration

### Targeted Tests

Run only relevant tests instead of the full suite:

```typescript
// Run tests for specific file
const validation = {
  test: 'npm test -- --testPathPattern=auth',
};

// Run tests with specific tag
const validation = {
  test: 'npm test -- --grep="authentication"',
};
```

### With Coverage

Include coverage reporting:

```typescript
const validation = {
  test: 'npm test -- --coverage --coverageThreshold=\'{"global":{"branches":80}}\'',
};
```

### Execution Order

Commands are executed in this order:

1. Test
2. Lint
3. Compile

> **Warning:** Nella runs validation commands sequentially, not in parallel. This ensures consistent results and proper error isolation.

## Best Practices

1. **Use fast commands** — Validation runs after each change, so keep commands fast
2. **Be specific** — Target relevant tests instead of running everything
3. **Fail fast** — Configure tests to stop on first failure when possible
4. **Include type checking** — Catch type errors before they become runtime issues
5. **Keep it simple** — Complex validation pipelines slow down the development flow

## Next Steps

- See [Constraints](./constraints.md) for defining rules
- See [Configuration Overview](./overview.md) for the full picture
