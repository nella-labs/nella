# Claude Desktop

Set up Nella as an MCP server for Claude Desktop.

## Prerequisites

- [Claude Desktop](https://claude.ai/download) installed
- Node.js 18 or later

## Setup

### Option A: Use the CLI

```bash
nella connect --client claude
```

Use `--mode hosted --api-key nella_...` if you want to skip prompts and write a hosted config directly.

### Step 1: Locate the configuration file

**macOS:**

```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**

```
%APPDATA%\Claude\claude_desktop_config.json
```

If the file doesn't exist, create it.

### Step 2: Add Nella manually for local stdio

Open the config file and add:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "--workspace", "/path/to/your/project"]
    }
  }
}
```

Replace `/path/to/your/project` with the absolute path to your workspace. Direct stdio/local MCP requires `--workspace`.

### Step 3: Restart Claude Desktop

Close and reopen Claude Desktop to load the new configuration.

### Step 4: Verify

Ask Claude:

> "What Nella tools are available?"

Claude should list tools like `nella_search`, `nella_index`, `nella_get_context`, etc.

## Automatic Setup

You can also let the CLI write the config:

```bash
nella connect --client claude
```

In hosted mode, `nella connect` can use `NELLA_API_KEY`, prompt for an existing key, or create one if you are already logged in with `nella auth login`.

## Multiple Workspaces

Configure multiple Nella instances for different projects:

```json
{
  "mcpServers": {
    "nella-frontend": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "--workspace", "/projects/frontend"]
    },
    "nella-backend": {
      "command": "npx",
      "args": ["-y", "@getnella/mcp", "--workspace", "/projects/backend"]
    }
  }
}
```

## Usage Examples

Once connected, Claude uses Nella tools automatically. You can also request them explicitly:

### Search the Codebase

```
Use nella_search to find how authentication is implemented in this project.
```

### Record Assumptions

```
Use nella_add_assumption to record that this project uses Express with TypeScript.
```

### Check Dependencies

```
Use nella_check_dependencies to see if any packages changed since we started.
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Tools not appearing | Restart Claude Desktop. Check that `npx -y @getnella/mcp --workspace /path/to/project` runs without errors in your terminal |
| "MCP server disconnected" | Check that Node.js 18+ is installed and accessible from the default shell |
| Workspace errors | Ensure the `--workspace` path exists and is readable |
| Slow startup | First run downloads the package via npx. Subsequent starts are faster |
