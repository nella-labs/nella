# CLI Commands

Command reference for the Nella CLI.

## Commands

| Command | Description |
|---------|-------------|
| `nella index` | Index the current workspace for search |
| `nella mcp` | Start the local MCP server |
| `nella connect` | Configure MCP client integration |
| `nella auth login` | Sign in via browser |
| `nella auth logout` | Sign out |
| `nella auth status` | Check session status |
| `nella setup` | One-shot Claude Code configuration |
| `nella help` | Show help and available commands |

## Common Options

| Option | Description |
|--------|-------------|
| `--workspace <path>` | Path to the project workspace |
| `--force` | Force rebuild (for `index`) |
| `--client <name>` | Target client: `claude`, `claude-code`, `cursor`, `vscode`, `windsurf` |
| `--yes` | Skip confirmation prompts |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error |
