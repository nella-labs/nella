# Basic Validation

Examples of basic task validation with Nella.

This guide walks through practical examples of using Nella for common validation scenarios.

## Basic Task Validation

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

## Pre-flight Refusal Check

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

> **Note:** Nella detects risky patterns like `log.*password`, `disable.*auth`, `drop.*table`, and more.

## Example Task YAML

Tasks can be defined in YAML files:

```yaml
id: get-user-by-id
name: Add GET /users/:id endpoint
category: feature
difficulty: easy

prompt: |
  Add a GET /users/:id endpoint that returns a user by ID.
  Return 404 if the user doesn't exist.
  Follow the existing code patterns in the codebase.

constraints:
  - id: no-schema-changes
    description: Do not modify database schema
    files_not_to_modify:
      - prisma/schema.prisma
      - src/config/**
      - package.json
  - id: no-console-log
    description: No console.log in production code
    forbidden_patterns:
      - "console\\.log.*password"
      - 'disable.*auth'

expected:
  files_to_modify:
    - src/modules/users/users.controller.ts
    - src/modules/users/users.service.ts
  lines_added: [10, 50]
  lines_removed: [0, 10]

validation:
  test: npm test
  lint: npm run lint
  compile: npm run check:types

prerequisites:
  files:
    - src/modules/users/users.service.ts
```

## MCP Tool Usage

When using Nella through MCP (e.g., with Claude Desktop), the conversation flow looks like:

```
User: Check if adding a new user endpoint would violate any constraints

Claude: [Uses nella_check]
No constraint violations detected. You can safely:
- Modify src/routes/users.ts
- Add src/services/user.service.ts

---

User: I've made the changes, validate them

Claude: [Uses nella_validate]
✅ All validations passed:
- Tests: 42 passed
- Lint: No errors
- TypeScript: No errors

---

User: Now run the full validation

Claude: [Uses nella_run]
✅ PASSED

Metrics:
- Scope Creep: 0%
- Constraint Violations: 0
- Validation Integrity: 1.0

Artifacts saved to: .nella/runs/2026-01-21_143052_x7k2
```

## Metrics

Nella calculates several metrics for each run:

| Metric | Type | Description |
|--------|------|-------------|
| `validationIntegrity` | number | Ratio of validation commands that passed (0.0–1.0) |
| `constraintViolationRate` | number | Ratio of constraints violated (0.0–1.0) |
| `scopeCreep` | number | Ratio of unexpected file changes (0.0–1.0) |
| `passedAll` | boolean | All validations and constraints passed |
| `refusalCorrect` | boolean | Correctly refused (if applicable) |
| `timeToGreen` | number | Milliseconds to first passing state |

## Artifacts

Each run produces artifacts in `.nella/runs/{runId}/`:

```
.nella/runs/2026-01-12_143052_x7k2/
├── logs.jsonl          # Structured log entries
├── diff.patch          # Git diff of all changes
├── metrics.json        # Computed metrics
```
