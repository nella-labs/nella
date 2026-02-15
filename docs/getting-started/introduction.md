# Introduction

Nella is a **reliability layer for AI coding agents** that solves the three biggest problems with AI-assisted development: hallucinations, prompt injection, and context loss.

## The Problem

AI coding agents are powerful, but they suffer from fundamental reliability issues:

| Problem | What Happens | Consequence |
|---------|--------------|-------------|
| **Hallucinations** | Agent generates code referencing APIs, imports, or packages that don't exist | Build failures, runtime errors, wasted debugging time |
| **Prompt Injection** | Malicious instructions hidden in code or docs hijack agent behavior | Security bypasses, credential exposure, destructive operations |
| **Context Loss** | Agent forgets prior decisions during long sessions | Contradictory changes, scope creep, broken assumptions |

## How Nella Helps

Nella sits between the AI agent and your codebase, validating every change before it's applied:

- **Constraint checking** — Define files that should never be modified, patterns to avoid, and rules to follow
- **Validation** — Run tests, lints, and type checks to verify changes work correctly
- **Risk detection** — Identify dangerous patterns like credential exposure, security bypasses, or destructive operations
- **Code verification** — Index your codebase and verify that AI-generated imports, symbols, and API calls reference real code
- **Session context** — Track changes, assumptions, and dependencies across an entire coding session to prevent contradictions
- **Scope monitoring** — Detect when the agent modifies files outside the expected scope

## How It Works

Nella integrates with AI agents in three ways:

### MCP Server (Recommended)

The Model Context Protocol (MCP) server runs alongside your IDE and gives the AI agent direct access to Nella's tools. The agent can check constraints, detect risks, track context, and validate changes — all without leaving the conversation.

```bash
# Start MCP server for Claude Desktop or Cursor
nella mcp
```

### CLI

Run validation from the command line or in CI/CD pipelines:

```bash
# Check if a task can proceed safely
nella check -t ./tasks/add-endpoint -r ./my-project

# Validate agent output
nella run -t ./tasks/add-endpoint -r ./my-project -c changes.json
```

### TypeScript Library

Import Nella's core functions directly into your application:

```typescript
import { runTask, check, validate } from '@usenella/core';

const result = await runTask('/path/to/repo', task, changes);
console.log(result.passed); // true or false
```

## Core Principles

1. **Agent-agnostic** — Works with any AI coding agent (Claude, GPT, Copilot, Cursor, Cline) via CLI, library, or MCP
2. **Zero config to start** — Install and run immediately. Add task definitions and constraints as needed
3. **Non-blocking** — Validates and reports without modifying your source code
4. **Composable** — Use individual functions (`check`, `validate`, `shouldRefuse`) or the full pipeline (`runTask`)
5. **Offline-capable** — Core validation works without network access. Cloud features (sync, hosted MCP) are optional

## Packages

| Package | Purpose | Install |
|---------|---------|---------|
| `@usenella/nella` | CLI + MCP server | `npm install -g @usenella/nella` |
| `@usenella/core` | Core library (validators, safety, indexing, context) | `npm install @usenella/core` |
| `@usenella/benchmark` | Agent evaluation framework | `npm install @usenella/benchmark` |
| `@usenella/api` | REST API server for hosted deployments | Internal |

> **Note:** `@usenella/nella` re-exports everything from `@usenella/core`, so you only need one package unless you want the core library without CLI/MCP overhead.

## Next Steps

- [Installation](./installation.md) — Set up Nella in your project
- [Quick Start](./quick-start.md) — Validate your first agent change in under 5 minutes
- [Task Authoring](../user-guide/task-authoring.md) — Learn to write task definitions
- [MCP Setup](../user-guide/mcp-setup.md) — Connect Nella to your IDE
