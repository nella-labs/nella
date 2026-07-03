# Nella

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Health Check](https://github.com/nella-labs/nella/actions/workflows/health-check.yml/badge.svg)](https://github.com/nella-labs/nella/actions/workflows/health-check.yml)

**Codebase intelligence for AI coding agents.** Nella gives agents real codebase understanding, persistent context, and grounded search.

## What is Nella?

Nella is a framework that sits between AI coding agents and your codebase. It provides:

- **Codebase indexing & search** — AST-based chunking with hybrid search (semantic + BM25) so agents work with real code, not hallucinated references
- **Context tracking** — Persistent session state with assumption tracking, change ledgers, and dependency drift detection
- **Traceability** — Structured logs of what changed, why, and linked decisions

## Why Nella?

LLMs used as coding agents suffer from fundamental limitations. Nella addresses them:

| Problem | What Happens | How Nella Solves It |
|---------|-------------|---------------------|
| **Hallucinated Code** | Agents reference imports, symbols, and APIs that don't exist | Index the real codebase and verify generated code against it |
| **Lost Context** | Agents forget prior decisions, assumptions, and changes across turns | Maintain persistent session state with assumption tracking and change ledgers |
| **Contradictions** | Agents contradict earlier decisions or generate code not grounded in the codebase | Track assumptions, detect conflicts, and verify all referenced symbols exist |

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@getnella/mcp](./packages/nella) | CLI + MCP Server | [![npm](https://img.shields.io/npm/v/@getnella/mcp)](https://www.npmjs.com/package/@getnella/mcp) |
| [@usenella/core](./packages/core) | Core library | [![npm](https://img.shields.io/npm/v/@usenella/core)](https://www.npmjs.com/package/@usenella/core) |

## Quick Start

### MCP setup

```bash
npm install -g @getnella/mcp

# Configure a supported client
nella connect --client claude
nella connect --client vscode
nella connect --client cursor

# Claude Code shortcut
nella setup
```

For a manual local stdio setup, use the package entrypoint directly and pass a workspace:

```bash
npx -y @getnella/mcp --workspace /path/to/project
```

### Index your codebase

```bash
nella auth login
nella index --force
```

`nella index` needs either a Nella login or Azure embedding environment variables.

### Configuration

All configuration is read from the environment — nothing is hardcoded. Copy
[`.env.example`](./.env.example) to `.env` and set only the values you need:

```bash
cp .env.example .env
```

Core secrets (embeddings/auth) and each optional cloud-sync tier are documented
in `.env.example`. Never commit `.env` — it is gitignored.

**Google Cloud (optional `gcp` sync tier).** Nella uses Application Default
Credentials (ADC), the same pattern as any Google Cloud client. Point it at a
service account or use ambient credentials, then set the project/resource env
vars:

```bash
# Auth — pick ONE:
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json  # explicit key file
# ...or run on GCP / after `gcloud auth application-default login` for ambient ADC

# Project + resources (read from env, never hardcoded):
export GCP_PROJECT_ID=your-project          # also honored: GOOGLE_CLOUD_PROJECT
export GCP_STORAGE_BUCKET=your-index-bucket
export GCP_CLOUD_SQL_INSTANCE=project:region:instance
export GCP_DB_USER=... GCP_DB_PASSWORD=... GCP_DB_NAME=nella
```

If you self-host the full GCP stack, `scripts/setup-gcp.sh` provisions it and
also reads these same env vars (with overridable defaults).

### CLI commands

`nella` currently exposes `index`, `mcp`, `serve`, `connect`, `auth`, `setup`, and `help`.

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `nella_index` | Index workspace for semantic and lexical search |
| `nella_search` | Hybrid search (semantic + BM25) across indexed codebase |
| `nella_get_context` | Get current session context |
| `nella_add_assumption` | Record an assumption about the codebase |
| `nella_check_assumptions` | Get status of recorded assumptions |
| `nella_check_dependencies` | Check for dependency drift |
| `nella_heartbeat` | Verify trust-chain continuity between tool calls |

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Coding Agent   │────▶│   Nella Core    │────▶│   Your Repo     │
│  (Claude, GPT)  │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

Nella Core is **agent-agnostic**. The agent calls Core (via MCP, CLI, or library), not the other way around.

## Core Modules

- **Indexing & search** — Create vector + lexical indexes for RAG workflows.
- **Context tracking** — Assumption tracking with auto-invalidation, dependency drift detection.
- **Workspace management** — Register and switch between multiple workspaces.
- **Authentication & rate limiting** — API key management and per-agent throttling.
- **Cloud sync** — Push/pull run artifacts to Google Cloud Storage.
See [Core Modules](./docs/core/modules.md) for setup guides and examples.

## Development

```bash
# Clone the repo
git clone https://github.com/nella-labs/nella.git
cd nella

# Install dependencies
pnpm install

# Build all packages
pnpm build

```

## Documentation

- [How to Use Nella](./docs/how-to-use.md) — End-to-end workflow and examples
- [Core API](./packages/core/README.md) — Core library documentation
- [CLI + MCP Reference](./packages/nella/README.md) — CLI command reference and MCP setup

## License

[MIT](./LICENSE)

---

Built by [Nella Labs](https://github.com/nella-labs)
