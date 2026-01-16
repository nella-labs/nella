# Context Management

How Nella MCP tracks state across conversation sessions.

## Table of Contents

- [Overview](#overview)
- [Session Persistence](#session-persistence)
- [Change Tracking](#change-tracking)
- [Assumption Management](#assumption-management)
- [Dependency Tracking](#dependency-tracking)
- [Best Practices](#best-practices)

---

## Overview

The Nella MCP Server maintains stateful context that persists across conversations. This enables:

- **Memory** — Remember what files were changed and why
- **Consistency** — Detect when assumptions become invalid
- **Drift Detection** — Notice when dependencies change unexpectedly
- **Audit Trail** — Track the evolution of changes over time

All context is stored in `.nella/session.json` in your workspace.

---

## Session Persistence

### Session Structure

```typescript
interface Session {
  id: string;              // Unique session identifier
  startedAt: string;       // ISO timestamp
  repoPath: string;        // Workspace path
  runCount: number;        // Number of nella_run executions
  dependencySnapshot: DependencySnapshot | null;
  changes: ChangeRecord[];
  assumptions: Assumption[];
}
```

### File Location

```
your-project/
├── .nella/
│   └── session.json    # Persisted session state
├── src/
├── package.json
└── ...
```

### Session Lifecycle

1. **Creation**: Session created on first tool call
2. **Update**: State updated on each change/assumption
3. **Persistence**: Automatically saved after modifications
4. **Reset**: Manually reset via new session or file deletion

### Resetting a Session

To start fresh, delete the session file:

```bash
rm .nella/session.json
```

Or use the context manager programmatically:
```typescript
contextManager.reset();
```

---

## Change Tracking

### Change Records

Every file modification is tracked:

```typescript
interface ChangeRecord {
  id: string;              // Unique change ID
  timestamp: string;       // When the change was made
  runId: string;           // Associated nella_run ID
  file: string;            // File path (relative)
  operation: "create" | "modify" | "delete";
  reason: string;          // Why the change was made
  dependsOn: string[];     // Files this change depends on
  assumptionIds: string[]; // Related assumptions
  contentHash?: string;    // Hash for detecting external changes
}
```

### Automatic Tracking

Changes are automatically recorded when using `nella_run`:

```
Claude: [Uses nella_run with changes]

→ Records:
  - src/users.ts (modify) - "Added pagination support"
  - src/types.ts (modify) - "Added PaginationParams type"
```

### Manual Recording

For changes made outside `nella_run`, use `nella_record_change`:

```
Claude: I made some direct edits. Let me record them.
[Uses nella_record_change with files: ["src/config.ts"], operation: "modify", reason: "Updated API base URL"]
```

### Change Dependencies

The system tracks file dependencies:

```typescript
// When modifying src/users.ts
{
  file: "src/users.ts",
  operation: "modify",
  reason: "Added pagination",
  dependsOn: ["src/types.ts", "src/utils/pagination.ts"]
}
```

This enables impact analysis when files are modified.

### Hotspot Detection

The context tracks "hotspot" files that are frequently modified:

```
Claude: [Uses nella_get_context]

→ Hotspot files:
  - src/users.ts (5 changes)
  - src/routes.ts (3 changes)
  - src/types.ts (2 changes)
```

---

## Assumption Management

### What Are Assumptions?

Assumptions are recorded beliefs about the codebase that might become invalid:

- "The User table has an email column"
- "The API returns JSON with a data wrapper"
- "We're using Express 4.x"

### Assumption Types

| Type | Description | Example |
|------|-------------|---------|
| `schema` | Database structure | "Users table has email column" |
| `interface` | API/type contracts | "API returns { data, meta }" |
| `dependency` | Package versions | "Using React 18.x" |
| `behavior` | Runtime behavior | "Auth middleware runs first" |
| `config` | Configuration values | "API URL from env var" |
| `structure` | Code organization | "Controllers in src/controllers/" |
| `other` | General assumptions | Any other assumption |

### Recording Assumptions

```
Claude: I'm assuming the User model has an email field.
[Uses nella_add_assumption]
  - type: "schema"
  - description: "User model has email field with unique constraint"
  - relatedFiles: ["prisma/schema.prisma", "src/models/user.ts"]
  - confidence: 0.9
```

### Confidence Levels

| Level | Meaning |
|-------|---------|
| 1.0 | Verified (checked the code) |
| 0.8 | High confidence (standard pattern) |
| 0.5 | Medium confidence (likely but uncertain) |
| 0.3 | Low confidence (guess/assumption) |

### Automatic Invalidation

When files are modified, related assumptions are checked:

```
Claude: [Uses nella_run to modify src/models/user.ts]

→ Assumption invalidated:
  - "User model has email field" — invalidated because related file was modified
```

Invalidation doesn't mean the assumption is wrong — it means it should be verified again.

### Checking Assumptions

```
Claude: Let me verify my assumptions are still valid.
[Uses nella_check_assumptions]

→ Valid: 3
  - [schema] User has email (confidence: 0.9)
  - [interface] API returns paginated (confidence: 0.8)
  - [dependency] Express 4.x (confidence: 1.0)

→ Invalidated: 1
  - [behavior] Users fetched without pagination
    Invalidated by: nella_run_abc123
    Reason: src/routes/users.ts was modified
```

### Assumption Conflicts

The system detects when assumptions conflict:

```typescript
// Assumption 1: "Using REST API pattern"
// Assumption 2: "Using GraphQL for queries"
// → Conflict detected
```

---

## Dependency Tracking

### Dependency Snapshots

The system takes snapshots of installed dependencies:

```typescript
interface DependencySnapshot {
  takenAt: string;           // When snapshot was taken
  packageJsonHash: string;   // Hash of package.json
  lockfileHash: string;      // Hash of lockfile
  lockfileType: "npm" | "pnpm" | "yarn" | "none";
  packages: Record<string, {
    version: string;
    isDev: boolean;
  }>;
  nodeVersion?: string;
}
```

### Drift Detection

Use `nella_check_dependencies` to detect changes:

```
Claude: [Uses nella_check_dependencies]

→ Changes detected:
  Added:
    - zod@3.22.0 (prod)
    - @types/zod@3.22.0 (dev)

  Updated:
    - express: 4.18.0 → 4.19.0

  Affected assumptions:
    - [dependency] "Using Express 4.18.x"
```

### When Snapshots Are Taken

- On session start (if dependencies exist)
- After `nella_run` completes successfully
- Manually via context manager

### Lockfile Support

The system detects and handles different lockfile types:

| Lockfile | Package Manager |
|----------|-----------------|
| `package-lock.json` | npm |
| `pnpm-lock.yaml` | pnpm |
| `yarn.lock` | yarn |

---

## Best Practices

### 1. Record Assumptions Early

At the start of a task, record your assumptions:

```
Claude: Before implementing, let me record my assumptions about the codebase.
[Uses nella_add_assumption for each assumption]
```

### 2. Check Context Periodically

During long sessions, review context:

```
Claude: Let me check our session context and assumptions.
[Uses nella_get_context]
[Uses nella_check_assumptions]
```

### 3. Use Appropriate Confidence Levels

- Use 1.0 only when you've verified in the code
- Use 0.8 for well-established patterns
- Use 0.5 when uncertain
- Use 0.3 for pure guesses

### 4. Record Manual Changes

Always record changes made outside `nella_run`:

```
Claude: I made a quick fix directly. Let me record it.
[Uses nella_record_change]
```

### 5. Check Dependencies Before Major Changes

Before adding packages or making breaking changes:

```
Claude: Let me check if dependencies have drifted.
[Uses nella_check_dependencies]
```

### 6. Review Invalidated Assumptions

When assumptions are invalidated, review them:

```
Claude: An assumption was invalidated. Let me verify if it's still valid.
[Uses nella_check_assumptions]
[Reviews related files]
[Re-adds assumption if still valid, or updates understanding]
```

### 7. Use File History for Context

When working on a file, check its history:

```
Claude: Let me see what changes we've made to this file.
[Uses nella_get_file_history]
```

---

## Context Data Model

### Full Session Schema

```typescript
interface SessionData {
  // Session metadata
  session: {
    id: string;
    startedAt: string;
    repoPath: string;
    runCount: number;
  };

  // Tracked changes
  changes: Array<{
    id: string;
    timestamp: string;
    runId: string;
    file: string;
    operation: "create" | "modify" | "delete";
    reason: string;
    dependsOn: string[];
    assumptionIds: string[];
    contentHash?: string;
  }>;

  // Recorded assumptions
  assumptions: Array<{
    id: string;
    createdAt: string;
    description: string;
    type: AssumptionType;
    relatedFiles: string[];
    valid: boolean;
    invalidatedAt?: string;
    invalidatedBy?: string;
    invalidationReason?: string;
    confidence: number;
  }>;

  // Dependency snapshot
  dependencySnapshot: {
    takenAt: string;
    packageJsonHash: string;
    lockfileHash: string;
    lockfileType: string;
    packages: Record<string, { version: string; isDev: boolean }>;
  } | null;
}
```

### Storage Size Considerations

The session file can grow large with many changes. Future versions will include:

- Automatic pruning of old data
- Context summarization
- Tiered storage (hot/warm/cold)

For now, manually reset sessions if they become too large:

```bash
rm .nella/session.json
```
