# Configuration Overview

Learn how to configure Nella for your project.

Nella is configured through constraints and validation settings that you pass to its tools. This page provides an overview of the configuration options.

## Configuration Approach

Unlike traditional configuration files, Nella receives its configuration through tool calls. This allows:

- **Dynamic configuration** — Adjust constraints based on the task
- **Context-aware rules** — Apply different rules for different scenarios
- **No setup files** — Start using Nella immediately

## Configuration Structure

When calling Nella tools, you provide two main configuration objects:

### Constraints

Define what the AI agent cannot do:

```typescript
const constraints = [
  {
    id: 'unique-constraint-id',
    description: 'Human-readable description',
    rule: 'The rule statement',
    filesNotToModify: ['glob/patterns/**'],
    forbiddenPatterns: ['regex-patterns'],
  },
];
```

### Validation

Define how to verify changes:

```typescript
const validation = {
  test: 'npm test',
  lint: 'npm run lint',
  compile: 'tsc --noEmit',
};
```

## Example Configuration

Here's a complete example for a typical Node.js project:

```typescript
// Constraints
const constraints = [
  {
    id: 'protect-config',
    description: 'Do not modify configuration files',
    filesNotToModify: [
      'package.json',
      'tsconfig.json',
      '.env*',
    ],
  },
  {
    id: 'no-secrets',
    description: 'No hardcoded secrets',
    forbiddenPatterns: [
      'password\\s*=\\s*["\'][^"\']+["\']',
      'api[_-]?key\\s*=\\s*["\'][^"\']+["\']',
    ],
  },
  {
    id: 'no-console',
    description: 'No console.log in production code',
    forbiddenPatterns: ['console\\.log\\('],
  },
];

// Validation
const validation = {
  test: 'npm test',
  lint: 'npm run lint',
  compile: 'tsc --noEmit',
};
```

> **Tip:** All fields are optional. You can provide just constraints, just validation, or both depending on your needs.

## Passing Configuration

Configuration is passed when calling Nella tools:

### nella_check

```typescript
nella_check({
  constraints: [...],
  modifiedFiles: ['src/auth.ts', 'src/user.ts'],
  diff: 'git diff output...',
});
```

### nella_validate

```typescript
nella_validate({
  test: 'npm test',
  lint: 'npm run lint',
  compile: 'tsc --noEmit',
});
```

### nella_run

```typescript
nella_run({
  taskId: 'task-123',
  taskName: 'Auth refactoring',
  prompt: 'Refactor auth to use async/await',
  constraints: [...],
  validation: { test: 'npm test', lint: 'npm run lint' },
  expectedFiles: ['src/auth.ts'],
  changes: [...],
});
```

## Task YAML Configuration

For benchmark tasks and repeatable workflows, configuration lives in YAML task files:

```yaml
id: get-user-by-id
name: Add GET /users/:id endpoint
category: feature
difficulty: easy

prompt: |
  Add a GET /users/:id endpoint that returns a user by ID.

constraints:
  - id: no-schema-changes
    description: Do not modify database schema
    files_not_to_modify:
      - prisma/schema.prisma
      - package.json
  - id: no-console-log
    description: No console.log in production code
    forbidden_patterns:
      - "console\\.log"

expected:
  files_to_modify:
    - src/modules/users/users.controller.ts
    - src/modules/users/users.service.ts

validation:
  test: npm test
  lint: npm run lint
  compile: npm run check:types
```

See [Task Authoring](../user-guide/task-authoring.md) for the full task YAML schema.

## Next Steps

- Learn about [Constraints](./constraints.md) in detail
- Explore [Validation](./validation.md) options
- See [API Reference](../api-reference/overview.md) for all tool parameters
