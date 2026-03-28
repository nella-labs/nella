# nella_check_dependencies

Check whether dependencies changed since the last stored snapshot.

The tool compares the current `package.json` and detected lockfile to the last dependency snapshot tracked by the session context.

## Parameters

None.

## Example

```typescript
nella_check_dependencies({});
```

## Response Shape

```markdown
## Dependency Check

⚠️ Dependencies have changed:

- 📦 package.json was modified
- 🔒 Lockfile was modified

### Added
- **cors**: ^2.8.5

### Updated
- **express**: ^4.18.0 → ^4.19.0
```

## Notes

- On the first call, if no previous snapshot exists, Nella creates one and reports that a new snapshot was created.
- When dependency changes are detected, the result sets `isError: true`.
- If dependency assumptions may be affected, the response includes an `Affected Assumptions` section.

See [Context Tools](./context-tools.md).
