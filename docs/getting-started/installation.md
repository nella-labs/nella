# Installation

Install Nella to use as an MCP server with your AI coding agent.

## Prerequisites

- **Node.js** 18 or later
- **npm**, **pnpm**, or **yarn**

## Install

```bash
# npm
npm install -g @getnella/mcp

# pnpm
pnpm add -g @getnella/mcp

# yarn
yarn global add @getnella/mcp
```

Verify the CLI is available:

```bash
nella help
```

> **Tip:** You can also use `npx` without a global install. For direct stdio/local MCP, use `npx -y @getnella/mcp --workspace /path/to/project`.

## Verify Setup

Run a quick check to confirm everything works:

```bash
nella help
nella mcp --help
```

If you want to test the direct stdio entrypoint instead of the CLI wrapper:

```bash
npx -y @getnella/mcp --help
```

## Next Steps

- [Quick Start](./quick-start.md) — Set up and validate your first change
- [Claude Desktop](../integrations/claude-desktop.md) — Connect to Claude Desktop
- [Cursor](../integrations/cursor.md) — Connect to Cursor IDE
