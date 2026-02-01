# MCP Integration Guide

How to set up and configure the Nella MCP Server with various clients.

## Table of Contents

- [Claude Desktop](#claude-desktop)
- [Claude Code (CLI)](#claude-code-cli)
- [Custom MCP Clients](#custom-mcp-clients)
- [Configuration Options](#configuration-options)
- [Troubleshooting](#troubleshooting)

---

## Claude Desktop

### Installation

The Nella MCP Server is included in the main `@usenella/nella` package:

```bash
# Global installation
npm install -g @usenella/nella

# Or use npx (downloads on first use)
npx @usenella/nella mcp --help
```

### Configuration File Location

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

### Basic Configuration

**macOS / Linux:**
```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@usenella/nella", "mcp", "--workspace", "/path/to/your/project"]
    }
  }
}
```

**Windows:**
```json
{
  "mcpServers": {
    "nella": {
      "command": "npx.cmd",
      "args": ["@usenella/nella", "mcp", "--workspace", "C:\\path\\to\\your\\project"]
    }
  }
}
```

### Using Global Installation

If you installed globally, use the direct command:

**macOS / Linux:**
```json
{
  "mcpServers": {
    "nella": {
      "command": "nella",
      "args": ["mcp", "--workspace", "/path/to/your/project"]
    }
  }
}
```

**Windows:**
```json
{
  "mcpServers": {
    "nella": {
      "command": "nella.cmd",
      "args": ["mcp", "--workspace", "C:\\path\\to\\your\\project"]
    }
  }
}
```

### Using Local Development Build

For development or testing with a local build:

```json
{
  "mcpServers": {
    "nella": {
      "command": "node",
      "args": [
        "/path/to/nella/packages/nella/dist/cli.js",
        "mcp",
        "--workspace",
        "/path/to/your/project"
      ]
    }
  }
}
```

### Multiple Workspaces

You can configure multiple Nella servers for different projects:

```json
{
  "mcpServers": {
    "nella-frontend": {
      "command": "npx",
      "args": ["@usenella/nella", "mcp", "--workspace", "/path/to/frontend"]
    },
    "nella-backend": {
      "command": "npx",
      "args": ["@usenella/nella", "mcp", "--workspace", "/path/to/backend"]
    }
  }
}
```

### Verifying Installation

After configuring, restart Claude Desktop and ask Claude:

> "What Nella tools do you have available?"

Claude should list all 12 tools if configured correctly.

---

## Claude Code (CLI)

### Configuration

Claude Code uses the same MCP configuration format. Add to your Claude Code settings:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@usenella/nella", "mcp", "--workspace", "."]
    }
  }
}
```

Using `.` as the workspace path will use the current working directory.

### Dynamic Workspace

For Claude Code, you might want the workspace to follow your current directory:

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@usenella/nella", "mcp", "--workspace", "${workspaceFolder}"]
    }
  }
}
```

---

## Custom MCP Clients

### Starting the Server Programmatically

The MCP server uses stdio transport:

```typescript
import { spawn } from 'child_process';

const server = spawn('npx', ['@usenella/nella', 'mcp', '--workspace', '/path/to/project'], {
  stdio: ['pipe', 'pipe', 'inherit']
});

// Send MCP messages via stdin
server.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list'
}) + '\n');

// Receive responses via stdout
server.stdout.on('data', (data) => {
  const response = JSON.parse(data.toString());
  console.log('Tools:', response.result.tools);
});
```

### MCP Protocol Basics

The server implements the MCP protocol over stdio:

1. **Initialize**: Exchange capabilities
2. **List Tools**: Get available tools
3. **Call Tool**: Execute a specific tool

Example tool call:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "nella_check_prerequisites",
    "arguments": {}
  }
}
```

### Server Context

The server maintains a context object:

```typescript
interface ServerContext {
  workspacePath: string;      // Configured workspace path
  contextManager: ContextManager;  // Session state manager
}
```

---

## Configuration Options

### Command Line Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `--workspace`, `-w` | Yes | Path to the workspace directory |

### Environment Variables

The server respects these environment variables during validation:

| Variable | Description |
|----------|-------------|
| `CI=true` | Set during validation command execution |
| `FORCE_COLOR=0` | Disables color output in validation commands |

### Workspace Requirements

The workspace should have:

1. **package.json** — Required for prerequisite checks
2. **node_modules/** — Required (run `npm install` first)
3. **.nella/** — Created automatically for session data

---

## Troubleshooting

### Server Not Starting

**Symptom**: Claude doesn't see Nella tools

**Solutions**:
1. Check the config file path is correct for your OS
2. Verify JSON syntax is valid
3. On Windows, use `npx.cmd` instead of `npx`
4. Check the workspace path exists

**Debug**: Run the server manually to see errors:
```bash
npx @usenella/nella mcp --workspace /path/to/project
```

### Prerequisites Failing

**Symptom**: `nella_check_prerequisites` reports missing dependencies

**Solution**: Run `npm install` in the workspace:
```bash
cd /path/to/project
npm install
```

### Permission Errors

**Symptom**: Cannot create `.nella` directory

**Solution**: Ensure write permissions on the workspace:
```bash
chmod -R u+w /path/to/project
```

### Context Not Persisting

**Symptom**: Session data lost between conversations

**Check**: Verify `.nella/session.json` exists and is writable:
```bash
ls -la /path/to/project/.nella/
cat /path/to/project/.nella/session.json
```

### Windows Path Issues

**Symptom**: Paths not resolving correctly

**Solutions**:
1. Use forward slashes or escaped backslashes in JSON
2. Use absolute paths
3. Avoid spaces in paths (or quote them)

```json
// Good
"--workspace", "C:/Users/name/project"
"--workspace", "C:\\Users\\name\\project"

// Bad
"--workspace", "C:\Users\name\project"
```

### Timeout Errors

**Symptom**: Validation commands timing out

**Solution**: The default timeout is 2 minutes. For slow test suites, this is handled by the core library. Consider:
1. Running a subset of tests
2. Using `nella_validate` with just the lint/compile commands
3. Splitting validation into multiple calls

### Debugging MCP Communication

To debug MCP messages, you can intercept stdio:

```bash
# Create a debug wrapper script
cat > debug-nella.sh << 'EOF'
#!/bin/bash
tee /tmp/nella-in.log | npx @usenella/nella mcp "$@" | tee /tmp/nella-out.log
EOF
chmod +x debug-nella.sh
```

Then use the wrapper in your config:
```json
{
  "mcpServers": {
    "nella": {
      "command": "/path/to/debug-nella.sh",
      "args": ["--workspace", "/path/to/project"]
    }
  }
}
```

---

## Best Practices

### 1. Use Absolute Paths

Always use absolute paths in configuration to avoid ambiguity:
```json
"--workspace", "/Users/name/projects/myapp"
```

### 2. One Server Per Project

Configure separate MCP servers for different projects rather than switching workspaces:
```json
{
  "mcpServers": {
    "nella-api": { ... },
    "nella-web": { ... }
  }
}
```

### 3. Run npm install First

Ensure dependencies are installed before starting the server:
```bash
cd /path/to/project && npm install
```

### 4. Check Logs on Errors

The `.nella/` directory contains logs that can help diagnose issues:
```
.nella/
├── session.json      # Current session state
└── runs/
    └── {runId}/
        ├── logs.jsonl   # Detailed run logs
        ├── diff.patch   # Changes made
        └── metrics.json # Run metrics
```

### 5. Restart After Config Changes

After modifying `claude_desktop_config.json`, restart Claude Desktop for changes to take effect.
