# Context Tracking

Examples of using Nella's context tracking for session management.

Nella's context tracking system enables agents to remember what they changed, track assumptions about the codebase, detect dependency drift, and identify when new changes invalidate old assumptions.

## Enable Context Tracking

### Via runTask Options

```typescript
import { runTask } from '@usenella/core';

const result = await runTask(repoPath, task, changes, {
  enableContextTracking: true,
  checkDependencies: true,
  checkAssumptionConflicts: true,
});

// Extended result fields:
console.log(result.dependencyChanges); // What packages changed
console.log(result.invalidatedAssumptions); // How many assumptions broke
console.log(result.assumptionConflicts); // Conflicts with planned changes
console.log(result.contextSummary); // Human-readable summary
```

### Direct ContextManager Usage

```typescript
import { ContextManager } from '@usenella/core';

const ctx = new ContextManager('/path/to/repo');

// Get full context for agent
const context = ctx.getContext();
console.log(context.recentChanges);
console.log(context.validAssumptions);
console.log(context.dependencies);
```

## Tracking Dependencies

Monitor `package.json` changes across a session:

```typescript
import { ContextManager } from '@usenella/core';

const ctx = new ContextManager('/path/to/repo');

// Initial snapshot
ctx.checkDependencies('/path/to/repo');

// ... agent runs npm install ...

// Check for changes
const diff = ctx.checkDependencies('/path/to/repo');

if (diff?.hasChanges) {
  console.log('📦 Dependencies changed:');

  for (const change of diff.changes) {
    switch (change.type) {
      case 'added':
        console.log(`  + ${change.package}@${change.version}`);
        break;
      case 'removed':
        console.log(`  - ${change.package}`);
        break;
      case 'updated':
        console.log(`  ↑ ${change.package}: ${change.previousVersion} → ${change.version}`);
        break;
    }
  }

  // Check if any assumptions are affected
  if (diff.affectedAssumptions.length > 0) {
    console.log('⚠️ These assumptions may be affected:');
    for (const a of diff.affectedAssumptions) {
      console.log(`  - ${a.description}`);
    }
  }
}
```

## Tracking Assumptions

Record what the agent believes about the codebase:

```typescript
import { ContextManager } from '@usenella/core';

const ctx = new ContextManager('/path/to/repo');

// Record assumptions as agent reads files
ctx.assumptions.addSchemaAssumption(
  'User model: id (Int), email (String unique), name (String), createdAt (DateTime)',
  ['prisma/schema.prisma'],
);

ctx.assumptions.addInterfaceAssumption('CreateUserDTO requires email and name fields', [
  'src/dto/user.dto.ts',
]);

ctx.assumptions.addBehaviorAssumption(
  'UserService.create() throws ConflictError on duplicate email',
  ['src/modules/user/user.service.ts'],
);

ctx.assumptions.addDependencyAssumption('bcrypt ^5.0.0 is installed for password hashing');

ctx.assumptions.addConfigAssumption('JWT_SECRET is set in environment', [
  '.env',
  'src/config/index.ts',
]);

// Check for conflicts before making changes
const conflicts = ctx.assumptions.getConflicts(['src/user.ts']);
for (const conflict of conflicts) {
  console.log(`Warning: ${conflict.suggestion}`);
}

// Check for invalidations after changes
const invalidated = ctx.assumptions.checkInvalidations(
  ['src/types/user.ts', 'prisma/schema.prisma'],
  'run_456',
);

ctx.save();
```

### Assumption Types

| Type | Use Case |
|------|----------|
| `schema` | Database schema, API contracts |
| `interface` | TypeScript types/interfaces |
| `dependency` | npm packages, versions |
| `behavior` | Function/method behavior |
| `config` | Configuration values |
| `structure` | File/folder structure |
| `other` | Everything else |

## Change Ledger

Track all file changes with impact analysis:

```typescript
import { SessionStore, ChangeLedger } from '@usenella/core';

const session = new SessionStore('/path/to/repo');
const ledger = new ChangeLedger(session);

// Record changes
ledger.recordChange('run_123', 'src/user.ts', 'modify', 'Added validation', {
  dependsOn: ['src/utils/validator.ts'],
  content: 'file content here',
});

// Query history
const history = ledger.getFileHistory('src/user.ts');
// { file, changes[], currentState: "exists"|"deleted", lastModifiedAt }

ledger.getRecentChanges(20);
ledger.getRunChanges('run_123');
ledger.getHotspotFiles(10);

// Dependency analysis
ledger.getDependents('src/utils/validator.ts'); // Files that depend on this
ledger.getDependencies('src/user.ts'); // Files this depends on

// Impact analysis
const impact = ledger.analyzeImpact('src/utils/validator.ts');
// { directDependents, transitiveDependents, relatedAssumptions }
```

## MCP Context Tools

When using Nella through MCP, use these tools for context tracking:

### Get Session Context

```typescript
nella_get_context({
  changesLimit: 20,
});
```

Returns session info, recent changes, valid assumptions, and statistics.

### Add Assumption

```typescript
nella_add_assumption({
  type: 'interface',
  description: 'User model has id, name, and email string fields',
  relatedFiles: ['src/types.ts', 'src/models/user.ts'],
  confidence: 0.9,
});
```

### Check Assumptions

```typescript
nella_check_assumptions({});
```

Returns all valid and invalidated assumptions.

### Get File History

```typescript
nella_get_file_history({
  filePath: 'src/auth.ts',
});
```

Returns the change history for a specific file.

### Check Dependencies

```typescript
nella_check_dependencies({});
```

Returns added, removed, and updated packages since last snapshot.

### Record Changes

```typescript
nella_record_change({
  files: ['src/user.ts', 'src/types.ts'],
  operation: 'modify',
  reason: 'Added email validation',
});
```

## Best Practices

> **Tip:** When the agent reads a file and makes inferences, record them immediately so they can be validated later.

### 1. Record Assumptions Early

```typescript
// After reading prisma/schema.prisma
assumptions.addSchemaAssumption('User model has id, email, name, createdAt fields', [
  'prisma/schema.prisma',
]);
```

### 2. Check Conflicts Before Changes

```typescript
const conflicts = assumptions.getConflicts(plannedFiles);
if (conflicts.some((c) => c.severity === 'error')) {
  // Warn user or re-read affected files
}
```

### 3. Track Dependencies Between Files

```typescript
ledger.recordChange(runId, 'src/user.service.ts', 'modify', 'Updated user logic', {
  dependsOn: ['src/user.repository.ts', 'src/types/user.ts'],
});
```

### 4. Use Impact Analysis

Before modifying shared utilities:

```typescript
const impact = ledger.analyzeImpact('src/utils/validator.ts');
console.log('Will affect:', impact.directDependents);
```

### 5. Persist After Each Run

```typescript
// At end of runTask or in finally block
ctx.save();
```

## Data Storage

All context data is stored in `.nella/session.json`:

```json
{
  "id": "session_20260113_a1b2c3d4",
  "startedAt": "2026-01-13T10:00:00.000Z",
  "repoPath": "/path/to/repo",
  "changes": [],
  "assumptions": [],
  "dependencySnapshot": {},
  "metadata": {
    "lastActivityAt": "2026-01-13T12:30:00.000Z",
    "runCount": 5,
    "totalFilesModified": 12
  }
}
```

> **Note:** The `.nella/` directory should be in your `.gitignore` as it contains session-specific data.
