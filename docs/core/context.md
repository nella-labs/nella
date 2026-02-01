# Context Management

Stateful session tracking for AI coding agents.

## Table of Contents

- [Overview](#overview)
- [ContextManager](#contextmanager)
- [SessionStore](#sessionstore)
- [ChangeLedger](#changeledger)
- [AssumptionTracker](#assumptiontracker)
- [DependencyTracker](#dependencytracker)
- [Types](#types)

---

## Overview

The context module provides stateful session tracking that persists across agent interactions. It tracks:

- **Session metadata** — Duration, run count, workspace info
- **File changes** — What was modified, when, and why
- **Assumptions** — Recorded beliefs about the codebase
- **Dependencies** — Package snapshots for drift detection

All data persists to `.nella/session.json` in the workspace.

```typescript
import {
  ContextManager,
  SessionStore,
  ChangeLedger,
  AssumptionTracker,
  DependencyTracker
} from '@usenella/core';
```

---

## ContextManager

High-level API that orchestrates all context tracking components.

### Constructor

```typescript
const manager = new ContextManager(workspacePath: string);
```

Creates a new context manager for the specified workspace. Loads existing session data if present.

### Properties

```typescript
interface ContextManager {
  session: SessionStore;         // Session metadata
  dependencies: DependencyTracker;  // Package tracking
  assumptions: AssumptionTracker;   // Assumption tracking
  changes: ChangeLedger;           // Change history
}
```

### Methods

#### `getContext(limit?: number): AgentContext`

Get the full session context for the agent.

```typescript
const context = manager.getContext(50);  // Last 50 changes

console.log(context.session.id);
console.log(context.recentChanges);
console.log(context.validAssumptions);
console.log(context.dependencies);
```

#### `getStats(): ContextStats`

Get session statistics.

```typescript
const stats = manager.getStats();

console.log(stats.totalChanges);        // 15
console.log(stats.hotspotFiles);        // [{ file: 'src/users.ts', changeCount: 5 }]
console.log(stats.validAssumptionCount); // 3
console.log(stats.sessionDurationMinutes); // 45
```

#### `checkDependencies(repoPath: string): DependencyDiff | null`

Check for dependency changes since last snapshot.

```typescript
const diff = manager.checkDependencies('/path/to/repo');

if (diff) {
  console.log('Added:', diff.added);
  console.log('Removed:', diff.removed);
  console.log('Updated:', diff.updated);
}
```

#### `recordRunChanges(runId, changes, checkInvalidations?): RecordResult`

Record file changes from a run and optionally check assumption invalidations.

```typescript
const result = manager.recordRunChanges(
  'run_123',
  {
    files: [
      { path: 'src/users.ts', operation: 'modify', reason: 'Added pagination' }
    ]
  },
  true  // Check for invalidated assumptions
);

console.log(result.recorded);    // Number of changes recorded
console.log(result.invalidated); // Number of assumptions invalidated
```

#### `preflightCheck(plannedFiles: string[]): PreflightResult`

Run pre-flight checks before making changes.

```typescript
const preflight = manager.preflightCheck(['src/users.ts', 'src/types.ts']);

console.log(preflight.conflicts);      // Assumption conflicts
console.log(preflight.impactAnalysis); // Files that depend on planned changes
console.log(preflight.dependencyDrift); // Package changes
```

#### `save(): void`

Persist current state to disk.

```typescript
manager.save();  // Writes to .nella/session.json
```

#### `reset(): void`

Reset all context (starts a new session).

```typescript
manager.reset();
```

#### `getSummary(): string`

Get a human-readable summary of the session.

```typescript
const summary = manager.getSummary();
// "Session abc123: 45 minutes, 15 changes, 3 valid assumptions"
```

---

## SessionStore

Manages session metadata and persistence.

### Constructor

```typescript
const store = new SessionStore(workspacePath: string);
```

### Methods

#### `getSession(): Session`

Get current session info.

```typescript
const session = store.getSession();

console.log(session.id);        // "abc123-def456"
console.log(session.startedAt); // "2026-01-16T10:30:00Z"
console.log(session.repoPath);  // "/path/to/workspace"
console.log(session.runCount);  // 5
```

#### `incrementRunCount(): void`

Increment the run counter.

#### `save(): void`

Persist session to disk.

#### `reset(): void`

Start a new session.

#### `getDependencySnapshot(): DependencySnapshot | null`

Get the stored dependency snapshot.

#### `updateDependencySnapshot(snapshot: DependencySnapshot): void`

Update the stored dependency snapshot.

#### `getSessionDurationMinutes(): number`

Get session duration in minutes.

#### `getHotspotFiles(changes: ChangeRecord[]): HotspotFile[]`

Get files with most changes.

```typescript
const hotspots = store.getHotspotFiles(changes);
// [{ file: 'src/users.ts', changeCount: 5 }, ...]
```

---

## ChangeLedger

Tracks all file changes during a session.

### Constructor

```typescript
const ledger = new ChangeLedger();
```

### Methods

#### `recordChanges(runId, files, checkAssumptions?): RecordResult`

Record file changes.

```typescript
const result = ledger.recordChanges('run_123', [
  {
    file: 'src/users.ts',
    operation: 'modify',
    reason: 'Added pagination support',
    dependsOn: ['src/types.ts']
  }
]);
```

#### `getRecentChanges(limit?: number): ChangeRecord[]`

Get recent changes with optional limit.

```typescript
const recent = ledger.getRecentChanges(10);  // Last 10 changes
```

#### `getFileHistory(filePath: string): ChangeRecord[]`

Get all changes to a specific file.

```typescript
const history = ledger.getFileHistory('src/users.ts');

for (const change of history) {
  console.log(`${change.timestamp}: ${change.operation} - ${change.reason}`);
}
```

#### `analyzeImpact(files: string[]): ImpactAnalysis`

Analyze what files depend on the given files.

```typescript
const impact = ledger.analyzeImpact(['src/types.ts']);

console.log(impact.affectedFiles);  // Files that depend on types.ts
console.log(impact.changeCount);    // Number of related changes
```

#### `getSummary(): string`

Get a summary of changes.

#### `getStats(): ChangeStats`

Get change statistics.

```typescript
const stats = ledger.getStats();

console.log(stats.totalChanges);  // 15
console.log(stats.byOperation);   // { create: 3, modify: 10, delete: 2 }
console.log(stats.byFile);        // { 'src/users.ts': 5, ... }
```

---

## AssumptionTracker

Tracks and validates assumptions about the codebase.

### Constructor

```typescript
const tracker = new AssumptionTracker();
```

### Methods

#### `addAssumption(assumption): Assumption`

Add a new assumption.

```typescript
const assumption = tracker.addAssumption({
  type: 'schema',
  description: 'User table has email column',
  relatedFiles: ['prisma/schema.prisma'],
  confidence: 0.9
});

console.log(assumption.id);  // "asmp_abc123"
```

#### `getValidAssumptions(): Assumption[]`

Get all valid (non-invalidated) assumptions.

```typescript
const valid = tracker.getValidAssumptions();
```

#### `getRecentlyInvalidated(since?: string): Assumption[]`

Get assumptions invalidated since a timestamp.

```typescript
const invalidated = tracker.getRecentlyInvalidated('2026-01-16T10:00:00Z');
```

#### `invalidate(assumptionId, runId, reason): void`

Manually invalidate an assumption.

```typescript
tracker.invalidate(
  'asmp_abc123',
  'run_456',
  'Related file was modified'
);
```

#### `checkInvalidations(modifiedFiles: string[], runId: string): Assumption[]`

Check which assumptions are invalidated by file changes.

```typescript
const invalidated = tracker.checkInvalidations(
  ['src/users.ts', 'prisma/schema.prisma'],
  'run_789'
);

for (const asmp of invalidated) {
  console.log(`Invalidated: ${asmp.description}`);
}
```

#### `getConflicts(plannedFiles: string[]): AssumptionConflict[]`

Find conflicting assumptions for planned changes.

```typescript
const conflicts = tracker.getConflicts(['src/auth/login.ts']);

for (const conflict of conflicts) {
  console.log(`Conflict: ${conflict.assumption.description}`);
  console.log(`Affects: ${conflict.affectedFiles}`);
}
```

#### `getSummary(): AssumptionSummary`

Get assumption statistics by type.

```typescript
const summary = tracker.getSummary();

console.log(summary.byType);
// { schema: 2, interface: 1, dependency: 1, ... }

console.log(summary.validCount);      // 4
console.log(summary.invalidatedCount); // 1
```

---

## DependencyTracker

Tracks package dependencies and detects drift.

### Constructor

```typescript
const tracker = new DependencyTracker();
```

### Methods

#### `takeSnapshot(workspacePath: string): DependencySnapshot`

Take a snapshot of current dependencies.

```typescript
const snapshot = tracker.takeSnapshot('/path/to/repo');

console.log(snapshot.takenAt);      // ISO timestamp
console.log(snapshot.lockfileType); // "npm" | "pnpm" | "yarn"
console.log(snapshot.packages);     // { "express": { version: "4.18.0", isDev: false }, ... }
```

#### `getDiff(workspacePath: string, previous: DependencySnapshot): DependencyDiff | null`

Compare current state to a previous snapshot.

```typescript
const diff = tracker.getDiff('/path/to/repo', previousSnapshot);

if (diff) {
  console.log('Added:', diff.added);
  console.log('Removed:', diff.removed);
  console.log('Updated:', diff.updated);
}
```

#### `hasChanged(workspacePath: string, previous: DependencySnapshot): boolean`

Quick check if dependencies have changed.

```typescript
if (tracker.hasChanged('/path/to/repo', snapshot)) {
  console.log('Dependencies have changed!');
}
```

#### `summarizeChanges(diff: DependencyDiff): string`

Get human-readable summary of changes.

```typescript
const summary = tracker.summarizeChanges(diff);
// "2 packages added, 1 updated, 0 removed"
```

---

## Types

### Session

```typescript
interface Session {
  id: string;
  startedAt: string;
  repoPath: string;
  runCount: number;
}
```

### ChangeRecord

```typescript
interface ChangeRecord {
  id: string;
  timestamp: string;
  runId: string;
  file: string;
  operation: 'create' | 'modify' | 'delete';
  reason: string;
  dependsOn: string[];
  assumptionIds: string[];
  contentHash?: string;
}
```

### Assumption

```typescript
interface Assumption {
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
}

type AssumptionType =
  | 'schema'
  | 'interface'
  | 'dependency'
  | 'behavior'
  | 'config'
  | 'structure'
  | 'other';
```

### DependencySnapshot

```typescript
interface DependencySnapshot {
  takenAt: string;
  packageJsonHash: string;
  lockfileHash: string;
  lockfileType: 'npm' | 'pnpm' | 'yarn' | 'none';
  packages: Record<string, PackageInfo>;
  nodeVersion?: string;
}

interface PackageInfo {
  version: string;
  isDev: boolean;
}
```

### DependencyDiff

```typescript
interface DependencyDiff {
  added: PackageChange[];
  removed: PackageChange[];
  updated: PackageUpdate[];
}

interface PackageChange {
  name: string;
  version: string;
  isDev: boolean;
}

interface PackageUpdate {
  name: string;
  oldVersion: string;
  newVersion: string;
  isDev: boolean;
}
```

### AgentContext

```typescript
interface AgentContext {
  session: Session;
  recentChanges: ChangeRecord[];
  validAssumptions: Assumption[];
  dependencies: DependencySnapshot | null;
  recentInvalidations: Assumption[];
  stats: ContextStats;
}
```

### ContextStats

```typescript
interface ContextStats {
  totalChanges: number;
  hotspotFiles: HotspotFile[];
  validAssumptionCount: number;
  invalidatedAssumptionCount: number;
  sessionDurationMinutes: number;
}

interface HotspotFile {
  file: string;
  changeCount: number;
}
```

### AssumptionConflict

```typescript
interface AssumptionConflict {
  assumption: Assumption;
  affectedFiles: string[];
  conflictReason: string;
}
```

---

## Usage Example

Complete example using the context module:

```typescript
import { ContextManager } from '@usenella/core';

// Initialize
const ctx = new ContextManager('/path/to/workspace');

// Record an assumption
ctx.assumptions.addAssumption({
  type: 'schema',
  description: 'User has email field',
  relatedFiles: ['prisma/schema.prisma'],
  confidence: 0.9
});

// Check for dependency drift
const drift = ctx.checkDependencies('/path/to/workspace');
if (drift) {
  console.log('Dependencies changed:', drift);
}

// Pre-flight check
const preflight = ctx.preflightCheck(['src/users.ts']);
if (preflight.conflicts.length > 0) {
  console.log('Assumption conflicts detected!');
}

// Record changes from a run
ctx.recordRunChanges('run_123', {
  files: [
    { path: 'src/users.ts', operation: 'modify', reason: 'Added pagination' }
  ]
}, true);

// Get full context
const context = ctx.getContext();
console.log('Session:', context.session);
console.log('Changes:', context.recentChanges.length);
console.log('Assumptions:', context.validAssumptions.length);

// Get summary
console.log(ctx.getSummary());

// Persist
ctx.save();
```

> Looking for shared, cross-agent context? See [Context Sharing](./context-sharing.md).
