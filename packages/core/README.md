# @usenella/core

[![npm](https://img.shields.io/npm/v/@usenella/core)](https://www.npmjs.com/package/@usenella/core)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)

Reliability layer for coding agents. Enforces behavioral contracts that prevent agents from making unsafe or incorrect changes.

## Features

- **🛡️ Refusal Detection** — Block execution when prerequisites are missing or risk patterns detected
- **📋 Constraint Validation** — Ensure agents don't touch forbidden files or introduce forbidden patterns
- **✅ Validation Execution** — Run test/lint/compile commands and capture proof
- **🔍 Scope Analysis** — Detect scope creep when agents modify files outside the declared plan
- **📊 Metrics Calculation** — Compute scope creep ratio, constraint violations, validation integrity
- **📝 Structured Logging** — Emit JSONL run records for auditing and analysis
- **🧠 Context Tracking** — Track assumptions, dependency drift, and change history across runs

## Advanced Modules

Nella Core ships additional modules for larger agent systems:

- **Indexing & search** — Hybrid vector + lexical search for RAG workflows
- **Workspace management** — Multi-workspace registry and switcher utilities
- **Auth + rate limiting** — API key issuance and per-agent quotas
- **Context sharing** — Cross-agent memory with visibility controls
- **Cloud sync** — Sync run artifacts to Google Cloud Storage
- **Playground server** — Real-time playground with session telemetry

## Installation

```bash
npm install @usenella/core
```

**Prerequisites:** Target repository must have `package.json` and `node_modules` installed.

## Quick Start

```typescript
import { runTask, check, Task, Changes } from '@usenella/core';

// 1. Pre-flight check: should this task be refused?
const refusal = check(task, '/path/to/repo');
if (refusal.shouldRefuse) {
  console.error('Task refused:', refusal.reason);
  process.exit(1);
}

// 2. Validate agent changes
const changes: Changes = {
  files: [
    { path: 'src/users.ts', operation: 'modify', content: '...' }
  ]
};

const result = await runTask('/path/to/repo', task, changes);

console.log('Passed:', result.passed);
console.log('Metrics:', result.metrics);
```

## Playground Server

Start a real-time dashboard for monitoring agent sessions:

```typescript
import { createPlaygroundServer } from '@usenella/core';

const server = createPlaygroundServer({
  workspacePath: '/path/to/repo',
  storagePath: '/path/to/repo/.nella',
  port: 3847,
});

server.on({
  onStart: (port) => console.log(`Dashboard: http://localhost:${port}`),
  onClientConnect: (id) => console.log(`Client connected: ${id}`),
});

await server.start();
```

Features:
- **WebSocket updates** — Real-time tool calls, chain of thought, cost tracking
- **Dashboard UI** — Visual interface at `http://localhost:3847`
- **HTTP API** — `/health`, `/api/status`, `/api/session/:id` endpoints

## API Overview

### Main Functions

| Function | Description |
|----------|-------------|
| `runTask(repoPath, task, changes?, options?)` | Main entrypoint — full validation flow (optionally with context tracking) |
| `check(task, workspacePath, options?)` | Pre-flight refusal check |
| `validate(task, workspacePath, changes, options?)` | Validate without full run |

### Validators

| Function | Description |
|----------|-------------|
| `checkConstraints(files, diff, constraints)` | Check all constraints |
| `checkScope(files, expected)` | Detect scope creep |
| `runValidation(config, workDir)` | Run test/lint/compile |
| `runCommand(command, workDir, timeout?)` | Execute single command |

### Safety

| Function | Description |
|----------|-------------|
| `shouldRefuse(task, workspacePath, options?)` | Full refusal detection |
| `detectRiskPatterns(prompt)` | Check for risky patterns |
| `checkPrerequisites(workspacePath)` | Verify prerequisites |

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

## Metrics

| Metric | Description |
|--------|-------------|
| `scopeCreep` | Ratio of files modified outside expected scope |
| `constraintViolations` | Count of violated constraints |
| `validationIntegrity` | Ratio of validation commands that passed |
| `refusalCorrectness` | Whether refusal matched expectation |

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
- [@getnella/latest](../nella/README.md) — CLI + MCP server
- [@usenella/benchmark](../benchmark/README.md) — Benchmarking tools
