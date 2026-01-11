# API Reference

Complete API documentation for `@nella-labs/benchmark`.

## Table of Contents

- [CLI Reference](#cli-reference)
- [Programmatic API](#programmatic-api)
- [Adapters](#adapters)
- [Types](#types)

---

## CLI Reference

### Basic Usage

```bash
# Run with default settings
npm run benchmark

# Run with specific agent
npm run benchmark -- -a claude-sonnet

# Run specific tasks
npm run benchmark -- -t get-user-by-id,fix-duplicate-email

# Multiple runs for statistical significance
npm run benchmark -- -a gpt-4o --runs 5
```

### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--tasks-dir <path>` | | Directory containing task folders | `../../tasks` |
| `--fixtures-dir <path>` | | Directory containing fixtures | `../../fixtures` |
| `--output <path>` | `-o` | Output directory for results | `./benchmark-results` |
| `--agent <name>` | `-a` | Agent to use (repeatable) | Auto-detect from env |
| `--max-iterations <n>` | | Max retry attempts per task | `3` |
| `--skip-completed` | | Skip tasks already in results | `false` |
| `--tasks <ids>` | `-t` | Comma-separated task IDs | All tasks |
| `--runs <n>` | `-n` | Number of runs per task | `1` |
| `--run-id <id>` | | Custom run ID | Auto-generated |
| `--dashboard` | | Generate dashboard only | `false` |
| `--help` | `-h` | Show help | |

### Supported Agents

| Agent ID | Provider | Model |
|----------|----------|-------|
| `claude-sonnet` | Anthropic | claude-sonnet-4-20250514 |
| `claude-opus` | Anthropic | claude-opus-4-20250514 |
| `gpt-4o` | OpenAI | gpt-4o |
| `gpt-4o-mini` | OpenAI | gpt-4o-mini |

### Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...  # Required for Claude models
OPENAI_API_KEY=sk-...         # Required for OpenAI models
```

---

## Programmatic API

### BenchmarkRunner

Main class for running benchmarks.

```typescript
import { BenchmarkRunner } from '@nella-labs/benchmark';

const runner = new BenchmarkRunner(config);
const results = await runner.runAll(tasks);
```

#### Constructor

```typescript
constructor(config: BenchmarkConfig)
```

**BenchmarkConfig:**
```typescript
interface BenchmarkConfig {
  tasksDir: string;           // Path to tasks directory
  fixturesDir: string;        // Path to fixtures directory
  outputDir: string;          // Output directory for results
  agents: Record<string, AgentConfig>;  // Agent configurations
  maxIterations?: number;     // Max retry attempts (default: 3)
  timeoutSeconds?: number;    // Timeout per task
}
```

#### Methods

##### `runAll(tasks: Task[]): Promise<TaskRun[]>`

Run all tasks with all configured agents.

```typescript
const results = await runner.runAll(tasks);
```

##### `runTask(task: Task, agent: string): Promise<TaskRun>`

Run a single task with a specific agent.

```typescript
const result = await runner.runTask(task, 'claude-sonnet');
```

### Task Loading

```typescript
import { loadAllTasks } from '@nella-labs/benchmark';

const { tasks, errors } = await loadAllTasks('./tasks');

if (errors.length > 0) {
  console.error('Failed to load some tasks:', errors);
}

console.log(`Loaded ${tasks.length} tasks`);
```

### Report Generation

```typescript
import { writeDashboard, writeSummary } from '@nella-labs/benchmark';

// Generate HTML dashboard
await writeDashboard(outputDir);

// Generate Markdown summary
await writeSummary(runs, outputPath);
```

---

## Adapters

### Base Adapter

All adapters implement the `AgentAdapter` interface:

```typescript
interface AgentAdapter {
  name: string;
  
  invoke(
    prompt: string,
    context: TaskContext
  ): Promise<AgentInvocationResult>;
}

interface AgentInvocationResult {
  response: AgentResponse;
  tokenUsage: TokenUsage;
  durationMs: number;
}
```

### Anthropic Adapter

```typescript
import { AnthropicAdapter } from '@nella-labs/benchmark';

const adapter = new AnthropicAdapter({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxTokens: 8192,
});

const result = await adapter.invoke(prompt, context);
```

### OpenAI Adapter

```typescript
import { OpenAIAdapter } from '@nella-labs/benchmark';

const adapter = new OpenAIAdapter({
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY,
  maxTokens: 8192,
});

const result = await adapter.invoke(prompt, context);
```

### Custom Adapter

Create custom adapters for other providers:

```typescript
import { BaseAdapter, AgentConfig } from '@nella-labs/benchmark';

class CustomAdapter extends BaseAdapter {
  constructor(config: AgentConfig) {
    super(config);
  }

  async invoke(prompt: string, context: TaskContext) {
    // Your implementation
    const response = await this.callCustomAPI(prompt);
    
    return {
      response: this.parseResponse(response),
      tokenUsage: {
        inputTokens: response.usage.input,
        outputTokens: response.usage.output,
        totalTokens: response.usage.total,
      },
      durationMs: response.duration,
    };
  }
}
```

---

## Types

### Task Types

```typescript
interface Task {
  id: string;
  name: string;
  prompt: string;
  category: TaskCategory;
  difficulty: TaskDifficulty;
  fixture: string;
  constraints: Constraint[];
  validation: ValidationConfig;
  expected: ExpectedChanges;
  refusalExpected?: boolean;
  refusalPatterns?: string[];
  timeoutSeconds?: number;
}

type TaskCategory = 'feature' | 'bug-fix' | 'refactor' | 'edge-case' | 'refusal';
type TaskDifficulty = 'easy' | 'medium' | 'hard';
```

### Result Types

```typescript
interface TaskRun {
  taskId: string;
  agent: string;
  timestamp: string;
  metrics: Metrics;
  validation: ValidationResults;
  passed: boolean;
  filesModified: string[];
  constraintViolations: string[];
  refused: boolean;
  explanation: string;
}

interface Metrics {
  btp: boolean;      // Build/Test Pass
  vi: number;        // Validation Integrity (0-1)
  cvr: number;       // Constraint Violation Rate (0-1)
  sc: number;        // Scope Creep ratio
  rc: boolean | null; // Refusal Correctness
  ttg: number;       // Time to Green (seconds)
  ic: number;        // Iteration Count
  da: number;        // Diff Accuracy (0-1)
  tokensUsed: number;
  estimatedCost: number;
}
```

### Agent Types

```typescript
type AgentProvider = 'anthropic' | 'openai';

interface AgentConfig {
  provider: AgentProvider;
  model: string;
  apiKey: string;
  maxTokens?: number;
}

interface AgentResponse {
  action: 'edit' | 'refuse';
  files: FileChange[];
  explanation: string;
  reason?: string;
}

interface FileChange {
  path: string;
  operation: 'create' | 'modify' | 'delete';
  content: string;
}
```

### Pricing

```typescript
const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-20250514': { 
    inputCostPerMillion: 3, 
    outputCostPerMillion: 15 
  },
  'claude-opus-4-20250514': { 
    inputCostPerMillion: 15, 
    outputCostPerMillion: 75 
  },
  'gpt-4o': { 
    inputCostPerMillion: 2.5, 
    outputCostPerMillion: 10 
  },
  'gpt-4o-mini': { 
    inputCostPerMillion: 0.15, 
    outputCostPerMillion: 0.6 
  },
};
```
