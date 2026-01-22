# CLI Examples

Practical examples for using `@nella-labs/nella`.

## Table of Contents

- [Basic Usage](#basic-usage)
- [CI/CD Integration](#cicd-integration)
- [MCP Integration](#mcp-integration)
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
      
      - name: Install Nella CLI
        run: npm install -g @nella-labs/nella
      
      - name: Pre-flight check
        run: nella check -t ./task.yaml -r .
      
      - name: Validate changes
        run: |
          # Generate changes.json from PR diff
          git diff origin/main...HEAD --output=diff.patch
          node scripts/diff-to-changes.js diff.patch > changes.json
          
          # Run validation
          nella validate -t ./task.yaml -r . -c changes.json --json > result.json
          
          # Check result
          if jq -e '.passed' result.json; then
            echo "✅ Validation passed"
          else
            echo "❌ Validation failed"
            jq '.constraints[] | select(.passed == false)' result.json
            exit 1
          fi
```

### GitLab CI

```yaml
validate-changes:
  stage: test
  image: node:20
  script:
    - npm ci
    - npm install -g @nella-labs/nella
    - nella check -t ./task.yaml -r . --json
    - nella validate -t ./task.yaml -r . -c changes.json
  artifacts:
    when: always
    paths:
      - .nella/runs/
```

### Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Check if there's a task.yaml in the repo
if [ -f "task.yaml" ]; then
  echo "Running Nella pre-flight check..."
  
  if ! nella check -t task.yaml -r .; then
    echo "❌ Pre-flight check failed. Commit blocked."
    exit 1
  fi
  
  echo "✅ Pre-flight check passed"
fi
```

---

## MCP Integration

### Claude Desktop Setup

Add Nella as an MCP server in Claude Desktop for AI-assisted validation:

**Windows** (`%APPDATA%\Claude\claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@nella-labs/nella", "mcp", "--workspace", "C:/path/to/your/project"]
    }
  }
}
```

**macOS/Linux** (`~/.config/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@nella-labs/nella", "mcp", "--workspace", "/path/to/your/project"]
    }
  }
}
```

### Multiple Projects

Configure multiple workspaces for different projects:

```json
{
  "mcpServers": {
    "nella-project-a": {
      "command": "npx",
      "args": ["@nella-labs/nella", "mcp", "-w", "/projects/project-a"]
    },
    "nella-project-b": {
      "command": "npx",
      "args": ["@nella-labs/nella", "mcp", "-w", "/projects/project-b"]
    }
  }
}
```

### Using MCP Tools in AI Conversations

Once configured, Claude can use Nella tools directly:

```
User: Check if the get-user-by-id task is safe to proceed

Claude: [Uses nella_check tool]
The task is safe to proceed. No risk patterns detected and all prerequisites are met.

User: Validate my changes against the task constraints

Claude: [Uses nella_validate tool]  
Validation passed:
- ✓ no-auth-changes constraint satisfied
- ✓ All tests passing
- ✓ No scope creep detected
```

---

## Batch Processing

### Validate Multiple Tasks

```bash
#!/bin/bash
# validate-all.sh

REPO_PATH="./my-project"
CHANGES_FILE="./changes.json"
RESULTS_DIR="./validation-results"

mkdir -p "$RESULTS_DIR"

# Find all task directories
for task_dir in tasks/*/; do
  task_id=$(basename "$task_dir")
  echo "Validating: $task_id"
  
  # Run validation and save result
  nella run -t "$task_dir" -r "$REPO_PATH" -c "$CHANGES_FILE" --json \
    > "$RESULTS_DIR/$task_id.json" 2>&1
  
  # Check if passed
  if jq -e '.passed' "$RESULTS_DIR/$task_id.json" > /dev/null; then
    echo "  ✅ $task_id: PASSED"
  else
    echo "  ❌ $task_id: FAILED"
  fi
done

# Generate summary
echo ""
echo "=== Summary ==="
passed=$(grep -l '"passed": true' "$RESULTS_DIR"/*.json | wc -l)
total=$(ls "$RESULTS_DIR"/*.json | wc -l)
echo "Passed: $passed / $total"
```

### Process Agent Outputs in Parallel

```bash
#!/bin/bash
# parallel-validate.sh

# Validate multiple agent outputs in parallel
find ./agent-outputs -name "*.json" | parallel -j 4 '
  task_id=$(basename {} .json)
  nella validate -t tasks/$task_id -r ./project -c {} --json > results/$task_id.json
  echo "Completed: $task_id"
'
```

---

## Custom Workflows

### Agent Validation Pipeline

```bash
#!/bin/bash
# agent-pipeline.sh

TASK_PATH="$1"
REPO_PATH="$2"
AGENT_OUTPUT="$3"

echo "=== Nella Agent Validation Pipeline ==="
echo ""

# Step 1: Pre-flight check
echo "Step 1: Pre-flight check..."
if ! nella check -t "$TASK_PATH" -r "$REPO_PATH"; then
  echo "❌ Pre-flight failed. Task should be refused."
  exit 1
fi
echo "✅ Pre-flight passed"
echo ""

# Step 2: Quick constraint check (no tests)
echo "Step 2: Constraint validation..."
result=$(nella validate -t "$TASK_PATH" -r "$REPO_PATH" -c "$AGENT_OUTPUT" \
  --skip-validation --json)

violations=$(echo "$result" | jq '[.constraints[] | select(.passed == false)] | length')
if [ "$violations" -gt 0 ]; then
  echo "❌ Constraint violations detected:"
  echo "$result" | jq '.constraints[] | select(.passed == false)'
  exit 1
fi
echo "✅ Constraints passed"
echo ""

# Step 3: Full validation with tests
echo "Step 3: Full validation (running tests)..."
if ! nella run -t "$TASK_PATH" -r "$REPO_PATH" -c "$AGENT_OUTPUT"; then
  echo "❌ Validation failed"
  exit 1
fi

echo ""
echo "=== Pipeline Complete: SUCCESS ==="
```

### Refusal Task Testing

```bash
#!/bin/bash
# test-refusals.sh

echo "Testing refusal detection..."

# Find all refusal tasks
for task_dir in tasks/*; do
  if grep -q 'refusal_expected: true' "$task_dir/task.yaml" 2>/dev/null; then
    task_id=$(basename "$task_dir")
    echo -n "  $task_id: "
    
    # Check should detect risk patterns
    result=$(nella check -t "$task_dir" -r ./fixture --json)
    should_refuse=$(echo "$result" | jq '.shouldRefuse')
    
    if [ "$should_refuse" = "true" ]; then
      echo "✅ Correctly identified as risky"
    else
      echo "❌ FAILED - Should have been refused"
      echo "$result" | jq '.patternsMatched'
    fi
  fi
done
```

### Compare Multiple Agents

```bash
#!/bin/bash
# compare-agents.sh

TASK_PATH="$1"
REPO_PATH="$2"

echo "Comparing agent outputs on: $(basename $TASK_PATH)"
echo ""

for agent_output in ./outputs/*.json; do
  agent=$(basename "$agent_output" .json)
  echo "=== $agent ==="
  
  result=$(nella run -t "$TASK_PATH" -r "$REPO_PATH" -c "$agent_output" --json)
  
  passed=$(echo "$result" | jq '.passed')
  scope_creep=$(echo "$result" | jq '.metrics.scopeCreep')
  violations=$(echo "$result" | jq '.metrics.constraintViolations')
  integrity=$(echo "$result" | jq '.metrics.validationIntegrity')
  
  echo "  Passed: $passed"
  echo "  Scope Creep: $scope_creep"
  echo "  Constraint Violations: $violations"
  echo "  Validation Integrity: $integrity"
  echo ""
done
```

### Generate Changes from Git Diff

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
