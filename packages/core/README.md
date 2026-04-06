# @usenella/core

[![npm](https://img.shields.io/npm/v/@usenella/core)](https://www.npmjs.com/package/@usenella/core)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)

Codebase intelligence for coding agents. Provides grounded search, persistent context, assumption tracking, and dependency awareness.

## Features

- **Indexing & Search** — Hybrid vector + lexical search for RAG workflows
- **Context Tracking** — Track assumptions, dependency drift, and change history across runs
- **Structured Logging** — Emit JSONL run records for auditing and analysis
- **Metrics Calculation** — Compute scope creep ratio and other quality metrics

## Advanced Modules

Nella Core ships additional modules for larger agent systems:

- **Indexing & search** — Hybrid vector + lexical search for RAG workflows
- **Workspace management** — Multi-workspace registry and switcher utilities
- **Auth + rate limiting** — API key issuance and per-agent quotas
- **Context sharing** — Cross-agent memory with visibility controls
- **Cloud sync** — Sync run artifacts to Google Cloud Storage

## Installation

```bash
npm install @usenella/core
```

**Prerequisites:** Target repository must have `package.json` and `node_modules` installed.

## Quick Start

```typescript
import { createIndex, search } from '@usenella/core';

// Index a workspace
await createIndex('/path/to/repo');

// Search the indexed codebase
const results = await search('/path/to/repo', {
  query: 'user authentication',
  mode: 'hybrid',
});

console.log('Results:', results);
```

## API Overview

### Context Management

| Export | Description |
|--------|-------------|
| `ContextManager` | High-level session context orchestrator |
| `SessionStore` | Session metadata and persistence |
| `ChangeLedger` | Track file changes across runs |
| `AssumptionTracker` | Record and validate codebase assumptions |
| `DependencyTracker` | Detect package dependency drift |

### Utilities

| Export | Description |
|--------|-------------|
| `RunLogger` | Structured JSONL logging |
| `generateRunId()` | Generate unique run ID |
| `createTempWorkspace(path)` | Create isolated workspace copy |
| `applyChanges(workspace, changes)` | Apply file changes |

## Documentation

📖 **Full documentation available in [docs/core/](../../docs/core/):**

- [API Reference](../../docs/core/api-reference.md) — Complete function documentation
- [Types Reference](../../docs/core/types.md) — All TypeScript interfaces
- [Configuration](../../docs/core/configuration.md) — Task YAML schema and options
- [Context Management](../../docs/core/context.md) — Session tracking and assumptions
- [Core Modules](../../docs/core/modules.md) — Indexing, workspace, auth, export, and more
- [Examples](../../docs/core/examples.md) — Practical code examples

## Development

```bash
pnpm build      # Build the package
pnpm dev        # Watch mode
pnpm test       # Run tests
```

## License

[Apache-2.0](../../LICENSE)

## See Also

- [Nella Specification](../../docs/spec.md) — Architecture and design
- [@getnella/mcp](../nella/README.md) — CLI + MCP server
- [@usenella/benchmark](../benchmark/README.md) — Benchmarking tools
