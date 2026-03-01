# @usenella/benchmark

[![npm](https://img.shields.io/npm/v/@usenella/benchmark)](https://www.npmjs.com/package/@usenella/benchmark)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Benchmark suite for evaluating coding agents on capability and safety.

## Features

- 🤖 **Multi-agent support** — Claude Sonnet/Opus, GPT-4o/4o-mini
- 📊 **Comprehensive metrics** — Pass rate, constraint violations, scope creep, cost
- 🔄 **Auto-retry** — Retries failed tasks up to 3 iterations
- 📈 **Dashboard** — Interactive HTML comparison dashboard
- ✅ **Validation** — Runs test/lint/compile on each attempt

## Installation

```bash
npm install @usenella/benchmark
```

## Quick Start

```bash
# Set API keys
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...

# Run benchmark
npm run benchmark -- -a claude-sonnet

# Compare multiple agents
npm run benchmark -- -a claude-sonnet -a gpt-4o
```

## Metrics

| Metric | Description |
|--------|-------------|
| **BTP** | Build/Test Pass — all validations passed |
| **VI** | Validation Integrity — ratio of passed validations |
| **CVR** | Constraint Violation Rate — constraints violated |
| **SC** | Scope Creep — files modified outside expected scope |
| **RC** | Refusal Correctness — correctly refused risky tasks |
| **TTG** | Time to Green — seconds to first pass |
| **IC** | Iteration Count — attempts before success |
| **DA** | Diff Accuracy — closeness to golden diff |

## Supported Agents

| Agent ID | Provider | Model |
|----------|----------|-------|
| `claude-sonnet` | Anthropic | claude-sonnet-4-20250514 |
| `claude-opus` | Anthropic | claude-opus-4-20250514 |
| `gpt-4o` | OpenAI | gpt-4o |
| `gpt-4o-mini` | OpenAI | gpt-4o-mini |

## Included Tasks

| ID | Category | Difficulty |
|----|----------|------------|
| `get-user-by-id` | feature | easy |
| `fix-duplicate-email` | bug-fix | easy |
| `add-updated-at` | feature | easy |
| `delete-user-soft` | feature | medium |
| `list-users-paginated` | feature | medium |
| `refactor-repository` | refactor | medium |
| `validate-whitespace` | edge-case | medium |
| `posts-crud-relations` | feature | hard |
| `jwt-auth-implementation` | feature | hard |
| `risky-debug-logging` | refusal | hard |

## Documentation

| Document | Description |
|----------|-------------|
| [API Reference](../../docs/benchmark/api-reference.md) | CLI options, programmatic API, adapters |
| [Metrics Reference](../../docs/benchmark/metrics.md) | Detailed metric definitions and interpretation |
| [Configuration](../../docs/benchmark/configuration.md) | Environment setup, config options |
| [Tasks Reference](../../docs/benchmark/tasks.md) | Task format, creating new tasks |

## Related Packages

- [`@usenella/core`](../core) — Core reliability primitives
- [`@getnella/mcp`](../nella) — CLI + MCP server

## License

[Apache-2.0](../../LICENSE)
