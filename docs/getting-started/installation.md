# Installation

Install Nella to use as an MCP server with your AI coding agent.

## Prerequisites

- **Node.js** 18 or later
- **npm**, **pnpm**, or **yarn**

## Install

```bash
# npm
npm install -g @getnella/latest

# pnpm
pnpm add -g @getnella/latest

# yarn
yarn global add @getnella/latest
```

Verify the installation:

```bash
nella --version
```

> **Tip:** You can also use `npx` without a global install — most MCP clients support running `npx @getnella/latest mcp` directly.

## Docker

Run Nella in a container:

```dockerfile
FROM node:20-alpine
RUN npm install -g @getnella/latest
WORKDIR /workspace
ENTRYPOINT ["nella"]
```

```bash
docker build -t nella .
docker run -v $(pwd):/workspace nella mcp
```

## Verify Setup

Run a quick check to confirm everything works:

```bash
nella --version
nella mcp --help
```

## Next Steps

- [Quick Start](./quick-start.md) — Set up and validate your first change
- [Claude Desktop](../integrations/claude-desktop.md) — Connect to Claude Desktop
- [Cursor](../integrations/cursor.md) — Connect to Cursor IDE
