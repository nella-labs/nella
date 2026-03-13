# Configuration Overview

Learn how to configure Nella for your project.

Nella is configured through constraints and validation settings that you pass to its tools. This page provides an overview of the configuration options.

## Configuration Approach

Nella is configured through its MCP tools and CLI commands. No configuration files are required to get started.

- **No setup files** — Start using Nella immediately with `nella index`
- **Context-aware** — Nella indexes your codebase and tracks context automatically

## MCP Tools

Nella provides 6 MCP tools:

| Tool | Description |
|------|-------------|
| `nella_index` | Index codebase for search and context |
| `nella_search` | Search indexed codebase |
| `nella_get_context` | Get session context |
| `nella_add_assumption` | Record an assumption about the codebase |
| `nella_check_assumptions` | Check assumption status and conflicts |
| `nella_check_dependencies` | Check for dependency drift |

## CLI Commands

| Command | Description |
|---------|-------------|
| `nella index` | Index codebase for search and context |
| `nella mcp` | Start MCP server (stdio transport) |
| `nella serve` | Start hosted MCP server (Streamable HTTP) |
| `nella connect` | Configure MCP clients to use Nella |
| `nella auth` | Manage authentication (login/logout/status) |
| `nella playground` | Start playground server with real-time dashboard |

## Task YAML Configuration

For the benchmark suite, task configuration lives in YAML files. See the [benchmark documentation](../../packages/benchmark/) for the full task YAML schema, including constraints, validation commands, and expected changes used for evaluation.

## Next Steps

- Explore [Validation](./validation.md) options
- See [API Reference](../api-reference/overview.md) for all tool parameters
