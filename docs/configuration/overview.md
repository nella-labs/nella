# Configuration Overview

Learn how to configure Nella for your project.

Nella is configured through its MCP tools and CLI commands. This page provides an overview of the configuration options.

## Configuration Approach

Nella is configured through its MCP tools and CLI commands. No configuration files are required to get started.

- **No setup files** — Start using Nella immediately with `nella index`
- **Context-aware** — Nella indexes your codebase and tracks context automatically

## MCP Tools

The local MCP server currently exposes 7 tools:

| Tool | Description |
|------|-------------|
| `nella_index` | Index codebase for search and context |
| `nella_search` | Search indexed codebase |
| `nella_get_context` | Get session context |
| `nella_add_assumption` | Record an assumption about the codebase |
| `nella_check_assumptions` | Check assumption status and conflicts |
| `nella_check_dependencies` | Check for dependency drift |
| `nella_heartbeat` | Verify trust-chain continuity between tool calls |

## CLI Commands

| Command | Description |
|---------|-------------|
| `nella index` | Index codebase for search and context |
| `nella mcp` | Start MCP server (stdio transport) |
| `nella serve` | Start hosted MCP server (Streamable HTTP) |
| `nella connect` | Configure MCP clients to use Nella |
| `nella auth` | Manage authentication (login/logout/status) |
| `nella setup` | Shortcut for `nella connect --client claude-code --mode local` |
| `nella help` | Show the global or per-command help output |

## Next Steps

- Explore [Validation](./validation.md) options
- See [API Reference](../api-reference/overview.md) for all tool parameters
