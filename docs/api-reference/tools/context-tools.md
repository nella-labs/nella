# Context Tools

Tools for managing session context, assumptions, and change history.

Nella provides several tools for managing session context. These tools help track changes, record assumptions, and maintain history throughout a coding session.

## nella_get_context

Get the full session context including recent changes, assumptions, and dependencies.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `changesLimit` | `number` | No | Maximum number of recent changes to return (default: 50) |

### Example

```typescript
nella_get_context({
  changesLimit: 20,
});
```

### Response

```
## Session Context

### Session Info
- **Session ID**: sess_abc123
- **Started**: 2026-01-16T10:30:00Z
- **Duration**: 45 minutes
- **Runs completed**: 3

### Recent Changes (12 total)

| File | Operation | Reason | Time |
|------|-----------|--------|------|
| src/auth.ts | modify | Auth refactoring | 10:35 |
| src/user.ts | modify | Add email field | 10:42 |
| src/types.ts | modify | Update interfaces | 10:45 |

### Active Assumptions (2 valid)

1. **[interface]** User model has id, name, email fields (confidence: 0.9)
   - Files: src/types.ts, src/user.ts
2. **[dependency]** Using TypeScript 5.0+ (confidence: 0.8)
   - Files: tsconfig.json

### Statistics
- Total changes: 12
- Valid assumptions: 2
- Invalidated assumptions: 0
- Hotspot files: src/auth.ts (4 changes), src/user.ts (3 changes)
```

---

## nella_add_assumption

Record an assumption about the codebase that can be validated when changes are made.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | `string` | Yes | Category: schema, interface, dependency, behavior, config, structure, other |
| `description` | `string` | Yes | What is being assumed |
| `relatedFiles` | `string[]` | Yes | Files this assumption relates to |
| `confidence` | `number` | No | Confidence level 0–1 (default: 0.8) |

### Example

```typescript
nella_add_assumption({
  type: 'interface',
  description: 'User model has id, name, and email string fields',
  relatedFiles: ['src/types.ts', 'src/models/user.ts'],
  confidence: 0.9,
});
```

### Response

```
## Assumption Recorded

✅ Successfully added assumption

### Details
- **ID**: asmp_xyz789
- **Type**: interface
- **Description**: User model has id, name, and email string fields
- **Related Files**: src/types.ts, src/models/user.ts
- **Confidence**: 0.9

### Note
This assumption will be automatically checked when related files are modified.
If changes invalidate this assumption, you will be notified.
```

---

## nella_check_assumptions

Get the status of all recorded assumptions, including any that have been invalidated.

### Parameters

None.

### Example

```typescript
nella_check_assumptions({});
```

### Response

```
## Assumption Status

### Summary
- Valid: 2
- Invalidated: 1

### Valid Assumptions
1. **[interface]** User model has id, name, email fields (confidence: 0.9)
   - Files: src/types.ts, src/user.ts
   - Created: 10:35:00

2. **[dependency]** Using TypeScript 5.0+ (confidence: 0.8)
   - Files: tsconfig.json
   - Created: 10:32:00

### Invalidated Assumptions
- **[config]** ~~Using default ESLint rules~~ ❌
  - Invalidated at: 10:45:00
  - Invalidated by: run_def456
```

---

## nella_get_file_history

Get the change history for a specific file within the current session.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filePath` | `string` | Yes | Relative path to the file |

### Example

```typescript
nella_get_file_history({
  filePath: 'src/auth.ts',
});
```

### Response

```
## File History: src/auth.ts

### Summary
- Total changes: 4
- First change: 10:35:00
- Last change: 11:02:00

### Change Log

#### 1. 10:35 — Modify
- Run ID: run_abc123
- Reason: Initial auth refactoring

#### 2. 10:42 — Modify
- Run ID: run_def456
- Reason: Add async/await support

#### 3. 10:55 — Modify
- Run ID: run_ghi789
- Reason: Fix type errors

#### 4. 11:02 — Modify
- Run ID: run_jkl012
- Reason: Add error handling
```

---

## nella_check_dependencies

Check for dependency changes (package.json, lockfile) since the last snapshot.

### Parameters

None.

### Example

```typescript
nella_check_dependencies({});
```

### Response

```
## Dependency Changes

✅ No changes since last snapshot

- Snapshot taken: 2026-01-16T10:30:00Z
- Lock file: package-lock.json
- Packages: 1,234 total
- Status: Unchanged
```

---

## nella_record_change

Manually record file changes to keep context accurate. Use when making changes outside of `nella_run`.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `files` | `string[]` | Yes | List of file paths that were changed |
| `operation` | `"create" \| "modify" \| "delete"` | Yes | Operation type |
| `reason` | `string` | Yes | Why the change was made |

### Example

```typescript
nella_record_change({
  files: ['src/config.ts', 'src/utils.ts'],
  operation: 'modify',
  reason: 'Manual update to configuration handling',
});
```

### Response

```
## Changes Recorded

✅ Successfully recorded 2 change(s)

### Recorded
1. **src/config.ts** — modify
2. **src/utils.ts** — modify

### Reason
Manual update to configuration handling
```

> **Tip:** Changes made through `nella_run` are automatically recorded. Use `nella_record_change` when making changes through other means (direct edits, other tools) to keep the session context accurate.

## Assumption Types

| Type | Use For |
|------|---------|
| `schema` | Database schema assumptions |
| `interface` | TypeScript/API interface structure |
| `dependency` | Package/library assumptions |
| `behavior` | Expected code behavior |
| `config` | Configuration assumptions |
| `structure` | Project structure assumptions |
| `other` | Anything else |
