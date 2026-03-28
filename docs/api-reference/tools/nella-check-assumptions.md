# nella_check_assumptions

Get the current status of recorded assumptions.

This tool summarizes assumptions by type, lists valid assumptions, and shows recently invalidated ones.

## Parameters

None.

## Example

```typescript
nella_check_assumptions({});
```

## Response Shape

```markdown
## Assumption Status

### Summary
- Valid: 2
- Invalidated: 1
- Total: 3

### By Type
- interface: 1
- dependency: 1
- behavior: 1

### ✅ Valid Assumptions
- **[interface]** User model has id, name, and email fields
  - Confidence: 90%

### ❌ Invalidated Assumptions
- **[behavior]** Users are fetched without pagination
  - Reason: File(s) modified: src/routes/users.ts
  - When: 3/27/2026, 8:14:00 PM
```

## Error Behavior

If any assumptions are invalidated, the MCP result sets `isError: true`.

See [Context Tools](./context-tools.md).
