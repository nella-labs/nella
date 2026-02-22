# How to Use Nella

An end-to-end guide for using Nella to validate agent changes with the CLI or the Core library.

## 1) Install

### CLI

```bash
npm install -g @usenella/nella
```

### Core library

```bash
npm install @usenella/core
```

## 2) Create a task

Tasks are YAML files that describe what the agent should do, constraints to enforce, and what files are expected to change.

```yaml
id: get-user-by-id
name: Add GET /users/:id endpoint
category: feature
difficulty: easy
fixture: my-express-app

prompt: |
  Add a GET /users/:id endpoint that returns a user by ID.
  Return 404 if the user doesn't exist.

constraints:
  - id: no-auth-changes
    description: "Do not modify auth logic"
    rule: "Auth files must not be touched"
    files_not_to_modify:
      - "src/auth/**"
  - id: no-secret-logs
    description: "No logging of secrets"
    rule: "Avoid logging tokens or passwords"
    forbidden_patterns:
      - "password"
      - "token"

validation:
  test: "npm run test"
  lint: "npm run lint"
  compile: "npm run check:types"

expected:
  files_to_modify:
    - "src/routes/users.ts"
  files_to_ignore:
    - "**/*.test.ts"
  expected_line_count: 40

refusal_expected: false
timeout_seconds: 120
```

## 3) Prepare the changes payload

Nella expects a JSON payload describing file changes. Each file includes the **full content** (not a diff).

```json
{
  "files": [
    {
      "path": "src/routes/users.ts",
      "operation": "modify",
      "content": "// Full file content here..."
    }
  ]
}
```

Optional: include a `diff` string if you already have one.

## 4) Run with the CLI

### Pre-flight check

```bash
nella check -t ./tasks/get-user-by-id -r ./my-project
```

### Validate changes

```bash
nella validate -t ./tasks/get-user-by-id -r ./my-project -c ./changes.json
```

### Full run with metrics and artifacts

```bash
nella run -t ./tasks/get-user-by-id -r ./my-project -c ./changes.json
```

Artifacts are written under `.nella/runs/<runId>` in the repository (diff, metrics, logs).

## 5) Run with the Core library

```typescript
import { runTask, check, Task, Changes } from '@usenella/core';

const refusal = check(task, '/path/to/repo');
if (refusal.shouldRefuse) {
  console.error('Refused:', refusal.reason);
  process.exit(1);
}

const changes: Changes = {
  files: [
    { path: 'src/routes/users.ts', operation: 'modify', content: '...' }
  ]
};

const result = await runTask('/path/to/repo', task, changes, {
  validationTimeout: 180000
});

console.log('Passed:', result.passed);
console.log('Metrics:', result.metrics);
```

## 6) Enable context tracking (optional)

Context tracking lets Nella record changes across runs, detect dependency drift, and surface assumption conflicts.

```typescript
const result = await runTask('/path/to/repo', task, changes, {
  enableContextTracking: true,
  checkDependencies: true,
  checkAssumptionConflicts: true
});

if ('dependencyChanges' in result) {
  console.log('Dependency changes:', result.dependencyChanges);
  console.log('Assumption conflicts:', result.assumptionConflicts);
}
```

## 7) Read results

Key fields returned in a run:

- `passed` — overall pass/fail status
- `constraints` — which constraints failed and why
- `validation` — test/lint/compile results
- `scope` — scope creep analysis
- `metrics` — scope creep, constraint violations, validation integrity
- `artifacts` — file paths for logs, diff, and metrics output

## 8) Tips for reliable runs

- Prefer narrow `files_to_modify` lists to reduce scope creep.
- Add `files_to_ignore` for generated or non-critical files.
- Keep forbidden patterns strict and well-scoped to reduce false positives.
- Use `skipValidation` only for fast, local checks — keep validations enabled in CI.

For more tips — including always-on Nella setup, prompt engineering, and team workflow patterns — see the [Tips & Best Practices guide](./guides/tips-and-best-practices.md).

## 9) Explore advanced modules

Nella Core includes advanced modules for larger agent systems:

- **Indexing & search** — vector + lexical search with code verification.
- **Workspace registry** — multi-repo routing for agent tools.
- **Auth + rate limiting** — API key management and per-agent quotas.
- **Context sharing** — cross-agent memory with visibility controls.
- **Cloud sync** — push/pull run data from Google Cloud Storage.
- **Playground server** — real-time playground with session telemetry.

Start with the [Core Modules guide](./core/modules.md) for examples.
