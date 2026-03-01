# CLI Examples

Practical examples for using `@getnella/mcp`.

## Table of Contents

- [Basic Usage](#basic-usage)
- [CI/CD Integration](#cicd-integration)
- [MCP Integration](#mcp-integration)
- [Hosted Server](#hosted-server)
- [Authentication](#authentication)
- [Playground](#playground)
- [Batch Processing](#batch-processing)
- [Custom Workflows](#custom-workflows)

---

## Basic Usage

### Check Before Running Agent

```bash
# Check if task can proceed
nella check -t tasks/get-user-by-id -r ./project

# Check with prerequisites skipped (for faster feedback)
nella check -t tasks/get-user-by-id -r ./project --skip-prerequisites
```

### Validate Agent Output

```bash
# Full validation with tests
nella validate -t tasks/get-user-by-id -r ./project -c agent-output.json

# Quick validation (skip slow test commands)
nella validate -t tasks/get-user-by-id -r ./project -c agent-output.json --skip-validation
```

### Complete Run with Artifacts

```bash
# Full run with all checks and artifact generation
nella run -t tasks/get-user-by-id -r ./project -c agent-output.json

# Get JSON output for processing
nella run -t tasks/get-user-by-id -r ./project -c agent-output.json --json > result.json
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Validate Agent Changes

on:
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Nella
        run: npm install -g @getnella/mcp
      
      - name: Validate changes
        run: |
          nella run -t ./tasks/${{ github.event.pull_request.title }} \
            -r . -c changes.json --json > result.json
      
      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: nella-results
          path: result.json
```

### GitLab CI

```yaml
validate-agent:
  image: node:20
  script:
    - npm ci
    - npm install -g @getnella/mcp
    - nella run -t ./tasks/$TASK_ID -r . -c changes.json --json > result.json
  artifacts:
    paths:
      - result.json
```

---

## MCP Integration

### Claude Desktop Setup

```bash
# Install globally
npm install -g @getnella/mcp

# Verify installation
nella --help
```

Add to Claude Desktop config:

```json
{
  "mcpServers": {
    "nella": {
      "command": "nella",
      "args": ["mcp", "--workspace", "/path/to/project"]
    }
  }
}
```

### Claude Code Setup

```bash
# Add via CLI
claude mcp add nella -- npx @getnella/mcp mcp --workspace .
```

---

## Hosted Server

### Start a Self-Hosted Nella Server

```bash
# Start with defaults (localhost:3001)
nella serve

# Production setup — bind to all interfaces with auth
nella serve --port 8080 --host 0.0.0.0 --api-key nella_production_key

# With Redis for distributed rate limiting
REDIS_URL=redis://localhost:6379 nella serve --port 3001
```

### Connect Clients to the Server

```bash
# Auto-configure Claude Desktop
nella connect --client claude-desktop

# Connect to a custom server
nella connect --client claude-code --server-url http://192.168.1.100:3001

# Dry run — print config without writing
nella connect --client claude-desktop --dry-run

# Connect with existing API key
nella connect --client cursor --api-key nella_existing_key
```

### Docker Deployment

```bash
# Pull and run
docker pull ghcr.io/nella-labs/nella-mcp:latest
docker run -p 3001:3001 \
  -e NELLA_API_KEY=nella_secret \
  -e SUPABASE_URL=https://xxx.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  ghcr.io/nella-labs/nella-mcp:latest

# Health check
curl http://localhost:3001/health
```

---

## Authentication

### Login Flows

```bash
# Interactive OAuth login (opens browser)
nella auth login

# API key login
nella auth login --api-key nella_YOUR_KEY

# Login to self-hosted server
nella auth login --server-url http://localhost:3001 --api-key nella_local_key

# Check status
nella auth status

# Logout
nella auth logout
```

### CI/CD with API Keys

```yaml
# GitHub Actions example
steps:
  - name: Validate with hosted Nella
    env:
      NELLA_API_KEY: ${{ secrets.NELLA_API_KEY }}
    run: |
      nella auth login --api-key $NELLA_API_KEY
      nella run -t tasks/my-task -r . -c changes.json
```

---

## Playground

### Launch the Playground

```bash
# Start playground with default settings
nella playground

# Custom port and workspace
nella playground --port 4000 --workspace ./my-project
```

> **Tip:** The playground provides a web-based UI at `http://localhost:PORT` with a chat interface for testing MCP tools, a file browser, context viewer, and real-time WebSocket updates.

---

## Batch Processing

### Multiple Tasks

```bash
#!/bin/bash
# Validate multiple tasks

TASKS="get-user-by-id list-users-paginated delete-user-soft"

for task in $TASKS; do
  echo "Running: $task"
  nella run -t "tasks/$task" -r ./project -c "changes/$task.json"
  
  if [ $? -ne 0 ]; then
    echo "❌ FAILED: $task"
    exit 1
  fi
  echo "✅ Passed: $task"
done
```

### Parallel Execution

```bash
#!/bin/bash
# Run validations in parallel

nella run -t tasks/task-1 -r . -c changes-1.json --json > result-1.json &
nella run -t tasks/task-2 -r . -c changes-2.json --json > result-2.json &
nella run -t tasks/task-3 -r . -c changes-3.json --json > result-3.json &

wait

# Check all results
for f in result-*.json; do
  passed=$(jq -r '.passed' "$f")
  if [ "$passed" != "true" ]; then
    echo "❌ Failed: $f"
    exit 1
  fi
done
echo "✅ All tasks passed"
```

---

## Custom Workflows

### Pre-commit Hook

```bash
#!/bin/sh
# .git/hooks/pre-commit

# Check for risky patterns in staged changes
nella check -t ./task.yaml -r .

if [ $? -ne 0 ]; then
  echo "Nella detected issues. Commit blocked."
  exit 1
fi
```

### Convert Git Diff to Changes File

```javascript
// diff-to-changes.js
// Convert git diff to changes.json format

const fs = require('fs');
const path = require('path');

const repoPath = process.argv[2] || '.';
const outputPath = process.argv[3] || 'changes.json';

// Get list of changed files from git
const { execSync } = require('child_process');
const changedFiles = execSync('git diff --name-only HEAD~1', { 
  cwd: repoPath,
  encoding: 'utf-8' 
}).trim().split('\n').filter(Boolean);

// Build changes array
const changes = {
  files: changedFiles.map(filePath => {
    const fullPath = path.join(repoPath, filePath);
    const exists = fs.existsSync(fullPath);
    
    return {
      path: filePath,
      operation: exists ? 'modify' : 'delete',
      content: exists ? fs.readFileSync(fullPath, 'utf-8') : ''
    };
  })
};

// Write output
fs.writeFileSync(outputPath, JSON.stringify(changes, null, 2));
console.log(`Generated ${outputPath} with ${changes.files.length} files`);
```

Usage:
```bash
node diff-to-changes.js ./my-repo changes.json
nella validate -t ./task.yaml -r ./my-repo -c changes.json
```
