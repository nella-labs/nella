# Agent Runner

The Agent Runner module enables Nella to orchestrate AI coding agents. It supports multi-turn tool-use loops, model cost estimation, and adapter-based architecture for different LLM providers.

## Key Exports

- `createAgentRunner` / `AgentRunner` — run multi-turn agent conversations
- `MODEL_PRICING` — cost-per-token map for supported models
- Agent adapters: `ClaudeAdapter`, `OpenAIAdapter`, `CohereAdapter`

## Quick Start

```ts
import { createAgentRunner } from '@usenella/core';

const runner = createAgentRunner({
  adapter: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
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
import { MODEL_PRICING } from '@usenella/core';

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

| Provider | Model | Input $/1K | Output $/1K |
|----------|-------|-----------|-------------|
| Anthropic | `claude-sonnet-4-20250514` | $0.003 | $0.015 |
| Anthropic | `claude-haiku-3.5` | $0.00025 | $0.00125 |
| OpenAI | `gpt-4o` | $0.005 | $0.015 |
| OpenAI | `gpt-4o-mini` | $0.00015 | $0.0006 |
| Cohere | `command-r-plus` | $0.003 | $0.015 |

## Adapter Configuration

```ts
// Anthropic adapter
const anthropicRunner = createAgentRunner({
  adapter: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    maxTokens: 4096,
  },
  // ...
});

// OpenAI adapter
const openaiRunner = createAgentRunner({
  adapter: {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY!,
  },
  // ...
});
```

## Types

```ts
interface AgentAdapterConfig {
  provider: 'anthropic' | 'openai' | 'cohere';
  model: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
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
