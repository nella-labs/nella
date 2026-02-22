# Claude Desktop

Set up Nella as an MCP server for Claude Desktop.

## Prerequisites

- [Claude Desktop](https://claude.ai/download) installed
- Node.js 18 or later

## Setup

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

### Step 2: Add Nella

Open the config file and add:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["-y", "@getnella/latest", "mcp"],
      "env": {
        "NELLA_REPO_PATH": "/path/to/your/project"
      }
    }
  }
}
```

Replace `/path/to/your/project` with the absolute path to your workspace.

### Step 3: Restart Claude Desktop

Close and reopen Claude Desktop to load the new configuration.

### Step 4: Verify

Ask Claude:

> "What Nella tools are available?"

Claude should list tools like `nella_check`, `nella_validate`, `nella_run`, etc.

## Automatic Setup

You can also use the `nella connect` command:

```bash
nella connect
```

This command:
1. Authenticates with your Nella account (opens browser if needed)
2. Creates an API key
3. Writes the MCP configuration to Claude Desktop's config file
4. Verifies the connection

## Multiple Workspaces

Configure multiple Nella instances for different projects:

```json
{
  "mcpServers": {
    "nella-frontend": {
      "command": "npx",
      "args": ["-y", "@getnella/latest", "mcp"],
      "env": { "NELLA_REPO_PATH": "/projects/frontend" }
    },
    "nella-backend": {
      "command": "npx",
      "args": ["-y", "@getnella/latest", "mcp"],
      "env": { "NELLA_REPO_PATH": "/projects/backend" }
    }
  }
}
```

## Usage Examples

Once connected, Claude uses Nella tools automatically. You can also request them explicitly:

### Check Constraints

```
Please use nella_check to verify my changes don't violate any constraints.
The constraints are:
- Don't modify package.json
- No console.log statements
```

### Run Full Validation

```
Use nella_run to validate all my changes against the task definition.
```

### Detect Risks

```
Use nella_detect_risks to scan the diff for security issues.
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Tools not appearing | Restart Claude Desktop. Check that `npx @getnella/latest mcp` runs without errors in your terminal |
| "MCP server disconnected" | Check that Node.js 18+ is installed and accessible from the default shell |
| Permission errors | Ensure `NELLA_REPO_PATH` points to a directory you have read access to |
| Slow startup | First run downloads the package via npx. Subsequent starts are faster |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NELLA_REPO_PATH` | Path to the project being validated | Current directory |
| `NELLA_API_KEY` | API key for cloud features | None |
| `NELLA_LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) | `info` |
