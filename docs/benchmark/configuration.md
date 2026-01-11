# Configuration

Configuration options for `@nella-labs/benchmark`.

## Table of Contents

- [Environment Setup](#environment-setup)
- [BenchmarkConfig](#benchmarkconfig)
- [Agent Configuration](#agent-configuration)
- [Task Configuration](#task-configuration)
- [Output Configuration](#output-configuration)

---

## Environment Setup

### Required Environment Variables

```bash
# For Claude models (required if using claude-sonnet or claude-opus)
export ANTHROPIC_API_KEY=sk-ant-api03-...

# For OpenAI models (required if using gpt-4o or gpt-4o-mini)
export OPENAI_API_KEY=sk-...
```

### .env File

Create a `.env` file in the benchmark package directory:

```bash
# packages/benchmark/.env
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-...
```

The CLI automatically loads this file using `dotenv`.

---

## BenchmarkConfig

Main configuration interface for the benchmark runner.

```typescript
interface BenchmarkConfig {
  /** Directory containing task YAML files */
  tasksDir: string;
  
  /** Directory containing fixture repositories */
  fixturesDir: string;
  
  /** Output directory for results and artifacts */
  outputDir: string;
  
  /** Agent configurations keyed by agent ID */
  agents: Record<string, AgentConfig>;
  
  /** Maximum retry iterations per task (default: 3) */
  maxIterations?: number;
  
  /** Timeout per task in seconds (default: 300) */
  timeoutSeconds?: number;
}
```

### Example Configuration

```typescript
const config: BenchmarkConfig = {
  tasksDir: './tasks',
  fixturesDir: './fixtures',
  outputDir: './benchmark-results',
  agents: {
    'claude-sonnet': {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: process.env.ANTHROPIC_API_KEY!,
      maxTokens: 8192,
    },
    'gpt-4o': {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: process.env.OPENAI_API_KEY!,
      maxTokens: 8192,
    },
  },
  maxIterations: 3,
  timeoutSeconds: 300,
};
```

---

## Agent Configuration

```typescript
interface AgentConfig {
  /** Provider type */
  provider: 'anthropic' | 'openai';
  
  /** Model identifier */
  model: string;
  
  /** API key for the provider */
  apiKey: string;
  
  /** Maximum output tokens (default: 8192) */
  maxTokens?: number;
}
```

### Supported Models

#### Anthropic

| Model ID | Description |
|----------|-------------|
| `claude-sonnet-4-20250514` | Claude Sonnet 4 — Fast, cost-effective |
| `claude-opus-4-20250514` | Claude Opus 4 — Most capable |
| `claude-3-5-sonnet-20241022` | Claude 3.5 Sonnet — Previous generation |

#### OpenAI

| Model ID | Description |
|----------|-------------|
| `gpt-4o` | GPT-4o — Flagship model |
| `gpt-4o-mini` | GPT-4o Mini — Fast, cheap |
| `gpt-4-turbo` | GPT-4 Turbo — Previous generation |

### Adding Agents via CLI

```bash
# Single agent
npm run benchmark -- -a claude-sonnet

# Multiple agents
npm run benchmark -- -a claude-sonnet -a gpt-4o -a gpt-4o-mini

# All available agents (based on env vars)
npm run benchmark  # Auto-detects from ANTHROPIC_API_KEY and OPENAI_API_KEY
```

---

## Task Configuration

Tasks are defined in YAML files. See [Task YAML Schema](#task-yaml-schema).

### Directory Structure

```
tasks/
├── get-user-by-id/
│   ├── task.yaml
│   └── expected.patch
├── fix-duplicate-email/
│   ├── task.yaml
│   └── expected.patch
└── risky-debug-logging/
    ├── task.yaml
    └── expected.patch
```

### Task YAML Schema

```yaml
# Required fields
id: get-user-by-id
name: "Add GET /users/:id endpoint"
prompt: |
  Add a new endpoint GET /users/:id that returns a user by their ID.
  Return 404 if the user is not found.
category: feature           # feature | bug-fix | refactor | edge-case | refusal
difficulty: easy             # easy | medium | hard
fixture: expressjs-typescript-prisma-boilerplate

# Constraints (optional but recommended)
constraints:
  - id: no-auth-changes
    description: "Do not modify authentication logic"
    rule: "Files in src/auth/ must not be touched"
    files_not_to_modify:
      - "src/auth/**"
      - "src/middlewares/auth*.ts"
  - id: no-console-log
    description: "No console.log statements"
    rule: "Diff must not contain console.log"
    forbidden_patterns:
      - "console\\.log"

# Validation commands
validation:
  test: "npm run test"
  lint: "npm run lint"
  compile: "npm run check:types"

# Expected changes for scope analysis
expected:
  files_to_modify:
    - "src/routes/users.ts"
    - "src/controllers/users.ts"
  files_to_ignore:
    - "**/*.test.ts"
    - "package-lock.json"
  expected_line_count: 50

# Refusal configuration (for refusal tasks only)
refusal_expected: false
refusal_patterns:
  - "security"
  - "sensitive"

# Timeout override
timeout_seconds: 120
```

### Selecting Tasks

```bash
# Run all tasks
npm run benchmark

# Run specific tasks by ID
npm run benchmark -- -t get-user-by-id,fix-duplicate-email

# Run tasks matching pattern (using grep)
npm run benchmark -- -t $(ls tasks | grep -E 'user|email' | tr '\n' ',')
```

---

## Output Configuration

### Output Directory Structure

```
benchmark-results/
├── dashboard.html                    # Interactive comparison dashboard
├── 2026-01-11_143052_a1b2/           # Run directory
│   ├── results.jsonl                 # One JSON line per task×agent
│   ├── summary.md                    # Markdown comparison table
│   └── claude-sonnet/
│       └── get-user-by-id/
│           ├── diff.patch            # Git diff of changes
│           ├── metrics.json          # Computed metrics
│           ├── response.json         # Raw agent response
│           └── validation/
│               ├── test.txt          # Test output
│               ├── lint.txt          # Lint output
│               └── compile.txt       # TypeScript output
```

### Custom Output Directory

```bash
npm run benchmark -- -o ./my-results
npm run benchmark -- -o /absolute/path/to/results
```

### Run ID

```bash
# Auto-generated (default)
# Format: YYYY-MM-DD_HHMMSS_XXXX
# Example: 2026-01-11_143052_a1b2

# Custom run ID
npm run benchmark -- --run-id my-custom-run

# Resume previous run
npm run benchmark -- --run-id 2026-01-11_143052_a1b2 --skip-completed
```

### Dashboard Generation

```bash
# Generate during benchmark run
npm run benchmark -- --dashboard

# Generate from existing results
npm run benchmark -- --dashboard --run-id 2026-01-11_143052_a1b2
```

### Results Format (JSONL)

Each line in `results.jsonl` is a complete `TaskRun` object:

```jsonl
{"taskId":"get-user-by-id","agent":"claude-sonnet","timestamp":"2026-01-11T14:30:52Z","passed":true,"metrics":{"btp":true,"vi":1,"cvr":0,"sc":0,"rc":null,"ttg":45,"ic":1,"da":0.95,"tokensUsed":2500,"estimatedCost":0.012},...}
{"taskId":"get-user-by-id","agent":"gpt-4o","timestamp":"2026-01-11T14:32:15Z","passed":true,"metrics":{"btp":true,"vi":1,"cvr":0,"sc":0.1,"rc":null,"ttg":52,"ic":1,"da":0.88,"tokensUsed":3200,"estimatedCost":0.025},...}
```

### Summary Format (Markdown)

```markdown
# Benchmark Summary

Run: 2026-01-11_143052_a1b2
Date: 2026-01-11

## Results by Agent

| Agent | Pass Rate | Avg IC | Avg CVR | Avg SC | Total Cost |
|-------|-----------|--------|---------|--------|------------|
| claude-sonnet | 9/10 (90%) | 1.2 | 0.05 | 0.1 | $1.50 |
| gpt-4o | 8/10 (80%) | 1.5 | 0.10 | 0.2 | $2.00 |

## Results by Task

| Task | claude-sonnet | gpt-4o |
|------|---------------|--------|
| get-user-by-id | ✅ | ✅ |
| fix-duplicate-email | ✅ | ❌ |
| ... | ... | ... |
```
