# CLI Reference

Complete command reference for `@usenella/nella`.

## Table of Contents

- [Commands](#commands)
  - [nella check](#nella-check)
  - [nella validate](#nella-validate)
  - [nella run](#nella-run)
  - [nella mcp](#nella-mcp)
  - [nella serve](#nella-serve)
  - [nella connect](#nella-connect)
  - [nella auth](#nella-auth)
  - [nella playground](#nella-playground)
- [Options](#options)
- [Task Loading](#task-loading)
- [Changes File Format](#changes-file-format)
- [Exit Codes](#exit-codes)
- [Programmatic Usage](#programmatic-usage)

---

## Commands

### `nella check`

Pre-flight check to determine if a task can proceed.

```bash
nella check --task <path> --repo <path> [options]
```

**Purpose:** Detect issues before running the agent — risk patterns, missing prerequisites, invalid task structure.

**Example:**
```bash
nella check -t tasks/get-user-by-id -r ./my-project

# Output:
# ✅ OK TO PROCEED

# or:
# 🚫 SHOULD REFUSE
#    Reason: Risk patterns detected in prompt
#    Patterns: log.*password
#    Confidence: 90%
```

**What it checks:**
1. **Risk patterns** — Dangerous requests like logging passwords, disabling auth
2. **Prerequisites** — `package.json` exists, `node_modules` installed
3. **Task structure** — Valid YAML, required fields present

**Returns:** Exit code `0` if OK to proceed, `1` if should refuse.

---

### `nella validate`

Validate agent changes against task constraints.

```bash
nella validate --task <path> --repo <path> --changes <path> [options]
```

**Purpose:** Check if agent changes satisfy all constraints and pass validations.

**Example:**
```bash
nella validate -t tasks/get-user-by-id -r ./project -c changes.json

# Output:
# ✅ PASSED
#
# Constraints:
#   ✓ no-auth-changes
#   ✓ no-console-log
#
# Validation:
#   Test:    ✓
#   Lint:    ✓
#   Compile: ✓
#
# Scope Creep: 0.0%
```

**What it validates:**
1. **Constraints** — Forbidden files not modified, forbidden patterns not in diff
2. **Scope** — Files modified match expected files
3. **Validation** — test/lint/compile commands pass (unless `--skip-validation`)

---

### `nella run`

Full run: combines check + validate + metrics calculation + artifact generation.

```bash
nella run --task <path> --repo <path> [--changes <path>] [options]
```

**Purpose:** Complete validation flow with metrics and artifacts.

**Example:**
```bash
nella run -t tasks/get-user-by-id -r ./project -c changes.json

# Output:
# ✅ PASSED
#
# Constraints:
#   ✓ no-auth-changes
#
# Validation:
#   Test:    ✓
#   Lint:    ✓
#   Compile: ✓
#
# Scope Creep: 0.0%
#
# Metrics:
#   Scope Creep: 0
#   Constraint Violations: 0
#   Validation Integrity: 1
#
# Artifacts: .nella/runs/2026-01-11_143052_a1b2
```

**Without changes:** Run without `--changes` to just check prerequisites and task validity.

```bash
nella run -t tasks/get-user-by-id -r ./project
```

---

### `nella mcp`

Start an MCP (Model Context Protocol) server for AI agent integration.

```bash
nella mcp [--workspace <path>]
```

**Purpose:** Run Nella as an MCP server that AI agents (Claude, GPT, etc.) can connect to for validation capabilities.

**Example:**
```bash
# Start MCP server for current directory
nella mcp

# Start MCP server for specific workspace
nella mcp --workspace /path/to/project
nella mcp -w ./my-project
```

**MCP Tools Exposed:**
- `nella_check` — Pre-flight task validation
- `nella_validate` — Validate agent changes
- `nella_run` — Full validation run
- `nella_detect_risks` — Detect dangerous patterns in prompts
- `nella_should_refuse` — Check if task should be refused
- `nella_check_prerequisites` — Verify project setup
- `nella_get_context` — Get current validation context
- `nella_add_assumption` — Add context assumption
- `nella_check_assumptions` — Validate assumptions
- `nella_get_file_history` — Track file modifications
- `nella_check_dependencies` — Verify dependencies
- `nella_record_change` — Record a file change

**Claude Desktop Integration:**

Add to `~/.config/Claude/claude_desktop_config.json` (macOS/Linux) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@usenella/nella", "mcp", "--workspace", "/path/to/project"]
    }
  }
}
```

---

### `nella serve`

Start a hosted MCP server using Streamable HTTP transport.

```bash
nella serve [--port <number>] [--host <host>]
```

**Purpose:** Run Nella as a hosted MCP server accessible over HTTP. This is the production-ready server with API key authentication (via Supabase), Redis-backed rate limiting, and WebSocket support for real-time events.

**Example:**
```bash
# Start on default port
nella serve

# Start on custom port and host
nella serve --port 8080 --host 0.0.0.0
```

**Environment Variables:**

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL (required for auth) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (required for auth) |
| `REDIS_URL` | Redis URL for rate limiting (falls back to in-memory) |
| `PORT` | Override port (default: 3847) |
| `NELLA_LOG_LEVEL` | Log verbosity level |

**Server Endpoint:** `http://localhost:3847/mcp` (Streamable HTTP)

**Health Check:** `http://localhost:3847/health`

**Production URL:** `https://mcp.getnella.dev/mcp`

---

### `nella connect`

Configure MCP clients to use Nella's hosted server.

```bash
nella connect [--api-key <key>] [--server-url <url>] [--client <name>]
```

**Purpose:** Automatically configure Claude Desktop and/or VS Code to connect to the Nella hosted MCP server. If you're logged in, it auto-creates an API key for you.

**Example:**
```bash
# Auto-configure all clients (creates API key if logged in)
nella connect

# Configure with an existing API key
nella connect --api-key nella_your_key_here

# Configure only Claude Desktop
nella connect --client claude

# Connect to a custom server URL
nella connect --server-url http://localhost:3847/mcp --api-key nella_your_key
```

**What it does:**
1. Verifies authentication (or uses provided API key)
2. If logged in with no key, auto-creates an API key
3. Checks server health/reachability
4. Writes MCP config to Claude Desktop config file and/or VS Code settings
5. Reports success per client

**Options:**

| Option | Short | Description |
|--------|-------|-------------|
| `--api-key` | `-k` | API key (must start with `nella_`). Auto-created if logged in. |
| `--server-url` | `-u` | Server URL (default: `https://mcp.getnella.dev/mcp`) |
| `--client` | | Target client: `claude`, `vscode`, or `all` (default: `all`) |

**Prerequisite:** Either run `nella auth login` first, or provide `--api-key` directly.

---

### `nella auth`

Manage authentication for the Nella hosted service.

```bash
nella auth <subcommand>
```

**Subcommands:**

#### `nella auth login`

Open a browser for authentication via your Nella account.

```bash
nella auth login

# Flow:
# 1. Opens browser to app.getnella.dev/auth/cli
# 2. Sign in with your account
# 3. CLI receives session tokens via local redirect
# 4. Session saved to ~/.nella/auth.json
```

**Output on success:**
```
✓ Logged in as you@example.com
  Session saved to ~/.nella/auth.json

  Next: nella connect to configure your MCP clients
```

#### `nella auth logout`

Clear stored credentials.

```bash
nella auth logout

# Output:
# ✓ Logged out — credentials removed
```

#### `nella auth status`

Show current login state.

```bash
nella auth status

# Output (if logged in):
# ✓ Authenticated
#   Email:   you@example.com
#   User ID: abc-123-...
#   Expires: 2/10/2026, 3:00:00 PM

# Output (if not logged in):
# ⚠ Not logged in
#   Run nella auth login to authenticate
```

**Session Storage:** `~/.nella/auth.json` — contains access token, refresh token, expiry, and user info.

---

### `nella playground`

Start the playground server with a real-time debugging dashboard.

```bash
nella playground [--workspace <path>] [--repo <url|path>] [--port <number>] [--host <host>]
```

**Purpose:** Launch an interactive dashboard for debugging agent sessions in real-time. Includes WebSocket support for live updates, chain-of-thought visualization, tool call tracking, and cost estimation.

**Example:**
```bash
# Start playground for current directory
nella playground

# Start for a specific workspace
nella playground --workspace /path/to/project

# Clone and use a git repo
nella playground --repo https://github.com/user/repo

# Custom port
nella playground --port 4000
```

**Dashboard:** Opens at `http://localhost:3847` (HTML dashboard)

**WebSocket:** `ws://localhost:3847/ws` (real-time session events)

**Features:**
- Real-time session tracking
- Chain-of-thought visualization
- Tool call history and timing
- Token usage and cost tracking
- Live validation results

**Options:**

| Option | Short | Description |
|--------|-------|-------------|
| `--workspace` | `-w` | Workspace path |
| `--repo` | `-r` | Git repo URL or local path (auto-clones URLs) |
| `--port` | `-p` | Port (default: 3847) |
| `--host` | | Host (default: localhost) |

---

## Options

| Option | Short | Description | Commands |
|--------|-------|-------------|----------|
| `--task <path>` | `-t` | Path to task.yaml or task directory | check, validate, run |
| `--workspace <path>` | `-w` | Path to workspace/project | mcp, playground |
| `--repo <path>` | `-r` | Path to repository or git URL | check, validate, run, playground |
| `--changes <path>` | `-c` | Path to changes.json file | validate, run |
| `--port <number>` | `-p` | Port for HTTP server (default: 3847) | serve, playground |
| `--host <host>` | | Host for HTTP server (default: localhost) | serve, playground |
| `--api-key <key>` | `-k` | API key for connect command | connect |
| `--server-url <url>` | `-u` | Server URL for connect | connect |
| `--client <name>` | | Target MCP client: claude, vscode, all | connect |
| `--skip-validation` | | Skip test/lint/compile commands | validate, run |
| `--skip-prerequisites` | | Skip package.json/node_modules checks | check, run |
| `--json` | | Output as JSON (for programmatic use) | All |
| `--help` | `-h` | Show help message | All |

### JSON Output

Use `--json` for machine-readable output:

```bash
nella run -t tasks/get-user-by-id -r ./project -c changes.json --json
```

```json
{
  "runId": "2026-01-11_143052_a1b2",
  "taskId": "get-user-by-id",
  "passed": true,
  "constraints": [
    { "id": "no-auth-changes", "passed": true }
  ],
  "validation": {
    "test": { "success": true, "exitCode": 0 },
    "lint": { "success": true, "exitCode": 0 },
    "compile": { "success": true, "exitCode": 0 },
    "allPassed": true
  },
  "scope": {
    "scopeCreepRatio": 0,
    "extraFiles": [],
    "missingFiles": []
  },
  "metrics": {
    "scopeCreep": 0,
    "constraintViolations": 0,
    "validationIntegrity": 1,
    "refusalCorrectness": null
  }
}
```

---

## Task Loading

The CLI loads tasks from YAML files. You can specify either:

1. **Direct path to task.yaml:**
   ```bash
   nella check -t ./tasks/get-user-by-id/task.yaml -r ./project
   ```

2. **Path to task directory** (will look for `task.yaml` inside):
   ```bash
   nella check -t ./tasks/get-user-by-id -r ./project
   ```

### Task YAML Schema

```yaml
id: get-user-by-id
name: "Add GET /users/:id endpoint"
prompt: |
  Add a new endpoint GET /users/:id that returns a user by ID.
category: feature        # feature | bug-fix | refactor | edge-case | refusal
difficulty: easy         # easy | medium | hard
fixture: my-express-app

constraints:
  - id: no-auth-changes
    description: "Do not modify auth logic"
    rule: "Auth files must not be touched"
    files_not_to_modify:
      - "src/auth/**"
    forbidden_patterns:
      - "console\\.log"

validation:
  test: "npm run test"
  lint: "npm run lint"
  compile: "npm run check:types"

expected:
  files_to_modify:
    - "src/routes/users.ts"
  files_to_ignore:
    - "**/*.test.ts"

# For refusal tasks:
refusal_expected: false
timeout_seconds: 120
```

---

## Changes File Format

The `--changes` option expects a JSON file with this structure:

```json
{
  "files": [
    {
      "path": "src/users.ts",
      "operation": "modify",
      "content": "// Full new file content...\nexport const getUser = () => {};"
    },
    {
      "path": "src/new-file.ts",
      "operation": "create",
      "content": "// New file content..."
    },
    {
      "path": "src/deprecated.ts",
      "operation": "delete",
      "content": ""
    }
  ],
  "diff": "optional git diff string"
}
```

### File Operations

| Operation | Description |
|-----------|-------------|
| `create` | New file being added |
| `modify` | Existing file being changed |
| `delete` | File being removed |

### Notes

- `content` should contain the **complete file content**, not a diff
- `diff` is optional — if not provided, the CLI will compute it
- Paths should be **relative to repository root**

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success / OK to proceed / Validation passed |
| `1` | Failure / Should refuse / Validation failed |

**Scripting example:**
```bash
if nella check -t ./task -r ./repo; then
  echo "Task can proceed"
  # Run agent...
else
  echo "Task should be refused"
  exit 1
fi
```

---

## Programmatic Usage

The package re-exports everything from `@usenella/core` and includes the MCP server:

```typescript
// Core validation functions
import {
  runTask,
  check,
  validate,
  checkConstraints,
  detectRiskPatterns,
  // ... all core exports
} from '@usenella/nella';

// MCP server (for programmatic use)
import { startMcpServer } from '@usenella/nella/mcp';
```

### Example: Custom CLI wrapper

```typescript
import { runTask, check, Task, Changes } from '@usenella/nella';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

async function validateAgentOutput(
  taskPath: string,
  repoPath: string,
  agentOutput: { files: Array<{ path: string; content: string }> }
) {
  // Load task
  const taskYaml = fs.readFileSync(taskPath, 'utf-8');
  const rawTask = yaml.load(taskYaml);
  
  // Transform to Task type
  const task: Task = {
    id: rawTask.id,
    name: rawTask.name,
    prompt: rawTask.prompt,
    category: rawTask.category,
    difficulty: rawTask.difficulty,
    fixture: rawTask.fixture,
    constraints: (rawTask.constraints ?? []).map(c => ({
      id: c.id,
      description: c.description,
      rule: c.rule,
      filesNotToModify: c.files_not_to_modify,
      forbiddenPatterns: c.forbidden_patterns,
    })),
    validation: rawTask.validation ?? {},
    expected: {
      filesToModify: rawTask.expected?.files_to_modify ?? [],
      filesToIgnore: rawTask.expected?.files_to_ignore ?? [],
    },
  };
  
  // Pre-flight check
  const preflight = check(task, repoPath);
  if (preflight.shouldRefuse) {
    return { success: false, reason: 'refused', details: preflight };
  }
  
  // Prepare changes
  const changes: Changes = {
    files: agentOutput.files.map(f => ({
      path: f.path,
      operation: 'modify' as const,
      content: f.content,
    })),
  };
  
  // Validate
  const result = await runTask(repoPath, task, changes);
  
  return {
    success: result.passed,
    metrics: result.metrics,
    violations: result.constraints.filter(c => !c.passed),
  };
}
```
