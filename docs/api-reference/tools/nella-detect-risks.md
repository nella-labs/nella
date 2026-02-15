# nella_detect_risks

Analyze text for risky patterns like credential exposure, security bypasses, and dangerous operations.

The `nella_detect_risks` tool analyzes text for risky patterns including credential exposure, security bypasses, dangerous operations, and data exposure risks.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | `string` | Yes | Text to analyze (prompt or code) |

## Example

```typescript
nella_detect_risks({
  content: `
    // Temporarily disable auth for testing
    const password = "admin123";
    DELETE FROM users WHERE created_at < '2020-01-01';
  `,
});
```

## Response

### No Risks Detected

```
## Risk Detection Results

✅ No risk patterns detected

The analyzed content does not contain any known risky patterns.
```

### Risks Detected

```
## Risk Detection Results

⚠️ 3 risk pattern(s) detected

### Detected Patterns

1. `password = "admin123"` — credential_exposure
2. `disable auth` — security_bypass
3. `DELETE FROM users` — data_exposure

### Recommendation

Review these patterns carefully. They may indicate:
- Accidental logging of sensitive data
- Intentional security weakening
- Debug code that shouldn't be in production
```

## Risk Categories

Nella detects **57 built-in risk patterns** across the following categories:

### Credential/Secret Exposure

Patterns that may expose sensitive credentials:

```
log.*password
log.*token
log.*secret
log.*api.?key
console\.log.*password
```

### Security Bypass

Security disabling patterns:

```
disable.*auth
skip.*validation
remove.*security
bypass.*auth
```

### Dangerous Operations

Risky database and system operations:

```
delete.*all.*users
drop.*table
truncate.*table
rm\s+-rf
```

### Data Exposure

Sensitive data operations:

```
expose.*credential
dump.*database
export.*secrets
```

### Backdoor Indicators

Suspicious access patterns:

```
add.*backdoor
create.*admin.*account
hardcode.*password
```

## Use Cases

### Prompt Analysis

Check incoming prompts for risky requests:

```typescript
const result = await nella_detect_risks({
  content: userPrompt,
});

if (result.risks.length > 0) {
  // Request clarification or refuse
}
```

### Code Review

Analyze generated code before applying:

```typescript
const result = await nella_detect_risks({
  content: generatedCode,
});

if (result.risks.length > 0) {
  // Flag for manual review
}
```

### Diff Analysis

Check diffs for introduced risks:

```typescript
const diff = await exec('git diff');
const result = await nella_detect_risks({
  content: diff,
});
```

> **Warning:** Risk detection may produce false positives in certain contexts (e.g., security-related code, tests). Review detected patterns before taking action.

## Related Tools

- [`nella_should_refuse`](./nella-should-refuse.md) — Determine if task should be refused
- [`nella_run`](./nella-run.md) — Complete workflow including risk detection
