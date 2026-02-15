# Installation

Install Nella as a CLI tool, a library, or both.

## Prerequisites

- **Node.js** 18 or later
- **npm**, **pnpm**, or **yarn**

## CLI Installation

Install globally to use the `nella` command from anywhere:

```bash
# npm
npm install -g @usenella/nella

# pnpm
pnpm add -g @usenella/nella

# yarn
yarn global add @usenella/nella
```

Verify the installation:

```bash
nella --version
```

## Library Installation

Install `@usenella/core` as a project dependency to use Nella programmatically:

```bash
# npm
npm install @usenella/core

# pnpm
pnpm add @usenella/core

# yarn
yarn add @usenella/core
```

> **Note:** `@usenella/nella` re-exports everything from `@usenella/core`. If you've installed the CLI globally, you can also import from `@usenella/nella` directly.

## Benchmark Installation

To evaluate AI agents against standardized tasks:

```bash
npm install @usenella/benchmark
```

## Optional Dependencies

Some features require additional packages:

| Package | Feature | Install |
|---------|---------|---------|
| `usearch` | Fast HNSW vector search (replaces brute-force) | `npm install usearch` |
| `better-sqlite3` | Persistent rate limiting backend | `npm install better-sqlite3` |
| `onnxruntime-node` | Local embedding model (no API calls) | `npm install onnxruntime-node` |

These are optional — Nella falls back gracefully when they're not installed.

## Docker

Run Nella in a container:

```dockerfile
FROM node:20-alpine
RUN npm install -g @usenella/nella
WORKDIR /workspace
ENTRYPOINT ["nella"]
```

```bash
docker build -t nella .
docker run -v $(pwd):/workspace nella check -t tasks/my-task -r /workspace
```

## Verify Setup

Run a quick check to confirm everything works:

```bash
# Create a minimal task
cat > task.yaml << 'EOF'
id: test
name: Test task
category: feature
difficulty: easy
prompt: Test
constraints: []
validation: {}
expected:
  files_to_modify: []
EOF

# Run a check (should pass with no errors)
nella check -t task.yaml -r .
```

## Next Steps

- [Quick Start](./quick-start.md) — Validate your first agent change
- [CLI Commands](../cli/commands.md) — Full command reference
- [MCP Setup](../user-guide/mcp-setup.md) — Connect Nella to Claude Desktop or Cursor
