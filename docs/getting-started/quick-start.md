# Quick Start

Validate your first AI agent change in under 5 minutes.

## Step 1: Install Nella

```bash
npm install -g @usenella/nella
```

## Step 2: Create a task definition

A task describes what the agent should do, what constraints to enforce, and what files should change.

Create `task.yaml`:

```yaml
id: add-hello-endpoint
name: Add GET /hello endpoint
category: feature
difficulty: easy

prompt: |
  Add a GET /hello endpoint that returns { message: "Hello, World!" }.

constraints:
  - id: no-auth-changes
    description: Do not modify authentication files
    rule: Auth files must not be touched
    files_not_to_modify:
      - "src/auth/**"
  - id: no-console-log
    description: No console.log in production code
    rule: Avoid console.log statements
    forbidden_patterns:
      - "console.log"

validation:
  test: "npm test"
  lint: "npm run lint"

expected:
  files_to_modify:
    - "src/routes/hello.ts"
```

## Step 3: Run a pre-flight check

Before the agent makes any changes, verify the task is safe to proceed:

```bash
nella check -t task.yaml -r ./my-project
```

Output:

```
✓ Task: Add GET /hello endpoint
✓ Prerequisites: package.json found, node_modules present
✓ Safety: No dangerous patterns detected
✓ Ready to proceed
```

## Step 4: Validate agent output

After the agent makes changes, validate them. Create `changes.json` with the agent's output:

```json
{
  "files": [
    {
      "path": "src/routes/hello.ts",
      "operation": "create",
      "content": "import { Router } from 'express';\n\nconst router = Router();\n\nrouter.get('/hello', (req, res) => {\n  res.json({ message: 'Hello, World!' });\n});\n\nexport default router;"
    }
  ]
}
```

Run full validation:

```bash
nella run -t task.yaml -r ./my-project -c changes.json
```

Output:

```
✓ Constraints: 2/2 passed
✓ Scope: No unexpected file modifications
✓ Validation: Tests passed, lint clean
✓ Result: PASSED

Metrics:
  Build/Test Pass: 1
  Constraint Violations: 0
  Scope Creep: 0.00
```

## Step 5: Get JSON output (optional)

For CI/CD integration, use `--json` to get machine-readable output:

```bash
nella run -t task.yaml -r ./my-project -c changes.json --json > result.json
```

## Using the MCP Server Instead

For interactive use with Claude Desktop or Cursor, start the MCP server:

```bash
nella mcp
```

The AI agent can then call Nella tools directly during the conversation. See [MCP Setup](../user-guide/mcp-setup.md) for integration guides.

## Using the TypeScript Library

```typescript
import { runTask, check } from '@usenella/core';
import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';

// Load task
const task = yaml.load(readFileSync('task.yaml', 'utf-8'));

// Pre-flight check
const refusal = check(task, './my-project');
if (refusal.shouldRefuse) {
  console.error('Refused:', refusal.reason);
  process.exit(1);
}

// Validate changes
const changes = { files: [{ path: 'src/routes/hello.ts', operation: 'create', content: '...' }] };
const result = await runTask('./my-project', task, changes);

console.log('Passed:', result.passed);
console.log('Metrics:', result.metrics);
```

## Next Steps

- [Task Authoring](../user-guide/task-authoring.md) — Write effective task definitions with constraints
- [CI/CD Integration](../user-guide/ci-cd-integration.md) — Run Nella in GitHub Actions or GitLab CI
- [CLI Commands](../cli/commands.md) — Full command reference
