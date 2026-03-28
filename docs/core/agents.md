# Agent Runner

> **Internal Module** — This documentation covers internal nella infrastructure. These modules are not exported from the public `@usenella/core` package and are intended for nella platform developers only.

The Agent Runner module enables Nella to orchestrate AI coding agents. It supports multi-turn tool-use loops, model cost estimation, and adapter-based architecture for different LLM providers.

## Key Exports

- `AgentRunner` — run multi-turn agent conversations
- `createAgentAdapter` — factory for creating provider-specific adapters
- `MODEL_PRICING` / `estimateAgentCost` — cost-per-token map and estimation
- Agent adapters: `AnthropicAdapter`, `OpenAIAdapter`

## Quick Start

```ts
import { AgentRunner, createAgentAdapter } from '@usenella/core/agents';

const adapter = createAgentAdapter({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const runner = new AgentRunner({
  adapter,
  tools: mcpTools,           // MCP tool definitions
  maxTurns: 10,              // Max conversation turns
  systemPrompt: 'You are a backend developer...',
});

const result = await runner.run({
  prompt: 'Add pagination to the GET /users endpoint',
  workspace: '/path/to/project',
});

console.log(result.turns);        // Number of turns taken
console.log(result.toolCalls);    // Tools invoked
console.log(result.cost);         // Estimated cost in USD
```

## Multi-Turn Tool-Use Loop

The runner executes a conversation loop: user prompt → model response → tool calls → model response → ... until the model signals completion or `maxTurns` is reached.

```ts
const result = await runner.run({
  prompt: 'Refactor the user service to use the repository pattern',
  workspace: '/path/to/project',
  onTurn: (turn) => {
    console.log(`Turn ${turn.number}: ${turn.toolCalls.length} tool calls`);
  },
});

// Result contains full conversation history
for (const turn of result.history) {
  console.log(`[${turn.role}] ${turn.content?.slice(0, 100)}...`);
}
```

## Cost Estimation

```ts
import { MODEL_PRICING } from '@usenella/core/agents';

// Get pricing for a model
const pricing = MODEL_PRICING['claude-sonnet-4-20250514'];
console.log(pricing.inputPer1k, pricing.outputPer1k);

// Estimate cost before running
const estimate = runner.estimateCost({
  prompt: 'Add pagination...',
  estimatedTurns: 5,
  estimatedToolCalls: 8,
});
console.log(`Estimated cost: $${estimate.totalUsd.toFixed(4)}`);
```

## Supported Models

| Provider | Model | Input $/1M | Output $/1M |
|----------|-------|-----------|-------------|
| Anthropic | `claude-sonnet-4-20250514` | $3.00 | $15.00 |
| Anthropic | `claude-opus-4-20250514` | $15.00 | $75.00 |
| Anthropic | `claude-3-5-sonnet-20241022` | $3.00 | $15.00 |
| OpenAI | `gpt-4-turbo` | $10.00 | $30.00 |
| OpenAI | `gpt-4o` | $2.50 | $10.00 |
| OpenAI | `gpt-4o-mini` | $0.15 | $0.60 |

## Adapter Configuration

```ts
import { AnthropicAdapter, OpenAIAdapter, createAgentAdapter } from '@usenella/core/agents';

// Using the factory (recommended)
const adapter = createAgentAdapter({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  maxTokens: 4096,
});

// Or construct directly
const anthropicAdapter = new AnthropicAdapter(
  process.env.ANTHROPIC_API_KEY!,
  'claude-sonnet-4-20250514'
);

const openaiAdapter = new OpenAIAdapter(
  process.env.OPENAI_API_KEY!,
  'gpt-4o'
);
```

## Types

```ts
interface AgentConfig {
  provider: 'anthropic' | 'openai';
  model: string;
  apiKey: string;
  maxTokens?: number;
}

interface AgentRunResult {
  turns: number;
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>;
  cost: { inputTokens: number; outputTokens: number; totalUsd: number };
  history: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }>;
  finalResponse: string;
}

interface ModelPricing {
  inputPer1k: number;
  outputPer1k: number;
  contextWindow: number;
}
```

## Related Docs

- [Core Modules Guide](modules.md) — All modules overview
- [Playground](playground.md) — Interactive testing UI
- [Core Configuration](configuration.md) — Agent configuration options
