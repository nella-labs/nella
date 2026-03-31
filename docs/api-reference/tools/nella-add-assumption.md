# nella_add_assumption

Record an assumption about the codebase so Nella can invalidate it automatically when related files change.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | `string` | Yes | One of `schema`, `interface`, `dependency`, `behavior`, `config`, `structure`, `other`. |
| `description` | `string` | Yes | Human-readable description of the assumption. |
| `relatedFiles` | `string[]` | No | Related files or glob patterns. |
| `confidence` | `number` | No | Confidence from `0` to `1`. Default: `0.8`. |

## Example

```typescript
nella_add_assumption({
  type: "interface",
  description: "User model has id, name, and email string fields",
  relatedFiles: ["src/types.ts", "src/models/*.ts"],
  confidence: 0.9,
});
```

## Response Shape

```markdown
## Assumption Recorded

✅ Successfully recorded assumption:

- **ID**: asmp_xyz789
- **Type**: interface
- **Description**: User model has id, name, and email string fields
- **Related files**: src/types.ts, src/models/*.ts
- **Confidence**: 90%
```

## Notes

- The assumption does not need `relatedFiles`, but providing them is what enables automatic invalidation on file changes.

See [Context Tools](./context-tools.md).
