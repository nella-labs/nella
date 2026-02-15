# TypeScript Library

Use Nella programmatically in your TypeScript projects.

The `@usenella/core` package provides TypeScript functions for task validation, constraint checking, and context tracking that you can use in your own tools and workflows.

## Installation

```bash
npm install @usenella/core
```

Or with pnpm:

```bash
pnpm add @usenella/core
```

## Main API

### runTask() — Main Entry Point

Main entry point for task validation:

```typescript
import { runTask, Task, Changes } from '@usenella/core';

const task: Task = {
  id: 'add-email-validation',
  name: 'Add email validation to user service',
  prompt: 'Add email validation when creating users',
  category: 'feature',
  difficulty: 'easy',
  constraints: [
    {
      id: 'no-auth-changes',
      description: "Don't modify authentication",
      rule: 'Auth module should not be touched',
      filesNotToModify: ['src/modules/auth/**'],
    },
    {
      id: 'no-console-log',
      description: 'No console.log in production code',
      rule: 'Use logger instead of console.log',
      forbiddenPatterns: ['console\\.log'],
    },
  ],
  validation: {
    test: 'npm run test',
    lint: 'npm run lint',
    compile: 'npm run check:types',
  },
  expected: {
    filesToModify: ['src/modules/user/user.service.ts'],
    filesToIgnore: ['**/*.test.ts'],
  },
};

const changes: Changes = {
  files: [
    {
      path: 'src/modules/user/user.service.ts',
      operation: 'modify',
      content: '// modified file content...',
    },
  ],
};

const result = await runTask('/path/to/repo', task, changes);

if (result.passed) {
  console.log('✅ All validations passed!');
} else {
  console.log('❌ Validation failed:');
  console.log('Constraint violations:', result.metrics.constraintViolations);
  console.log('Validation integrity:', result.metrics.validationIntegrity);
}
```

### check() — Pre-flight Refusal Check

Check if a task should be refused before making changes:

```typescript
import { check } from '@usenella/core';

const task: Task = {
  id: 'risky-task',
  prompt: 'Log user passwords for debugging',
  // ...
};

const refusal = check(task, '/path/to/repo');

if (refusal.shouldRefuse) {
  console.log('🚫 Task should be refused:');
  console.log('Reason:', refusal.reason);
  console.log('Patterns matched:', refusal.patternsMatched);
  console.log('Confidence:', refusal.confidence);
} else {
  console.log('✅ Task is safe to proceed');
}
```

### validate() — Validate Changes

Validate changes without full run:

```typescript
import { validate } from '@usenella/core';

const result = await validate(task, '/path/to/repo', changes);

console.log('Constraints:', result.constraints);
console.log('Validation:', result.validation);
console.log('Scope:', result.scope);
console.log('Passed:', result.passed);
```

## Context Tracking

Track session state across multiple runs:

```typescript
import { runTask, ContextManager } from '@usenella/core';

// Option 1: Enable via runTask options
const result = await runTask('/path/to/repo', task, changes, {
  enableContextTracking: true,
  checkDependencies: true,
  checkAssumptionConflicts: true,
});

console.log('Dependency changes:', result.dependencyChanges);
console.log('Invalidated assumptions:', result.invalidatedAssumptions);
console.log('Context summary:', result.contextSummary);

// Option 2: Direct ContextManager usage
const ctx = new ContextManager('/path/to/repo');

// Add assumptions before changes
ctx.assumptions.addSchemaAssumption('User has email field', ['prisma/schema.prisma']);

// Check for conflicts
const preflight = ctx.preflightCheck(['src/user.ts']);
if (preflight.conflicts.length > 0) {
  console.warn('⚠️ Conflicts detected:', preflight.conflicts);
}

// Record changes after run
ctx.recordRunChanges('run_123', [
  { file: 'src/user.ts', operation: 'modify', reason: 'Added validation' },
]);

ctx.save();
```

## Validators

### Constraint Checker

```typescript
import { checkConstraints, checkConstraint } from '@usenella/core';

// Check all constraints
const results = checkConstraints(modifiedFiles, diff, constraints);

// Check single constraint
const result = checkConstraint(modifiedFiles, diff, constraint);

// Utilities
import { getViolatedConstraints, countViolations } from '@usenella/core';

const violations = getViolatedConstraints(results);
const count = countViolations(results);
```

### Command Runner

```typescript
import { runCommand, runValidation } from '@usenella/core';

// Run single command
const result = await runCommand('npm test', workDir, 120000);

// Run all validation commands
const validation = await runValidation(config, workDir, 120000);
```

### Refusal Detector

```typescript
import { shouldRefuse, detectRiskPatterns, detectRefusalInResponse } from '@usenella/core';

// Main refusal check
const refusal = shouldRefuse(task, workspacePath);

// Detect risk patterns in prompt
const patterns = detectRiskPatterns(prompt);

// Check if agent response indicates refusal
const refused = detectRefusalInResponse(response);
```

## Type Definitions

```typescript
import type {
  // Task types
  Task,
  TaskCategory,
  TaskDifficulty,
  Constraint,
  ValidationConfig,
  ExpectedChanges,

  // Result types
  RunResult,
  Metrics,
  ConstraintResult,
  RefusalResult,
  ValidationResult,
  ScopeResult,
  CommandResult,
  Artifacts,

  // Agent types
  FileChange,
  AgentResponse,
  Changes,
  Plan,
  PlanStep,

  // Context types
  Session,
  SessionMetadata,
  ChangeRecord,
  FileChangeHistory,
  Assumption,
  AssumptionType,
  AssumptionCheckResult,
  AssumptionConflict,
  DependencySnapshot,
  PackageInfo,
  DependencyChange,
  DependencyDiff,
  AgentContext,
  ContextStats,

  // Log types
  LogEntry,
  LogEntryType,
} from '@usenella/core';
```

## Session Store

Persist session data across runs:

```typescript
import { SessionStore } from '@usenella/core';

const session = new SessionStore('/path/to/repo');

// Record a change
session.recordChange({
  runId: 'run_123',
  file: 'src/user.ts',
  operation: 'modify',
  reason: 'Added email validation',
  dependsOn: ['src/utils/validator.ts'],
  assumptionIds: ['assumption_1'],
});

// Query changes
session.getRecentChanges(20);
session.getChangesForFile('src/user.ts');
session.getChangesForRun('run_123');
session.getHotspotFiles(10);

// Session management
session.save();
session.reset();
```

## Assumption Tracking

Track what the agent believes about the codebase:

```typescript
import { SessionStore, AssumptionTracker } from '@usenella/core';

const session = new SessionStore('/path/to/repo');
const assumptions = new AssumptionTracker(session);

// Add assumptions by type
assumptions.addSchemaAssumption('User table has email column', ['prisma/schema.prisma']);
assumptions.addInterfaceAssumption('UserDTO has id, email, name fields', ['src/types/user.ts']);
assumptions.addDependencyAssumption('bcrypt ^5.0.0 is installed for password hashing');
assumptions.addBehaviorAssumption('validateEmail() returns boolean', ['src/utils/validator.ts']);

// Query assumptions
assumptions.getValidAssumptions();
assumptions.getInvalidatedAssumptions();
assumptions.getAssumptionsByType('schema');

// Check for invalidations when files change
const invalidated = assumptions.checkInvalidations(
  ['src/types/user.ts', 'prisma/schema.prisma'],
  'run_456',
);
```

> **Tip:** Use Nella's TypeScript API in CI pipelines to validate agent-made changes before merging.

## Related Packages

- [`@usenella/nella`](https://www.npmjs.com/package/@usenella/nella) — CLI + MCP server
- [`@usenella/benchmark`](https://www.npmjs.com/package/@usenella/benchmark) — Benchmarking tools
