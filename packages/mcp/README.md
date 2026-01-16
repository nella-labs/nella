# @nella-labs/mcp

MCP (Model Context Protocol) server that exposes Nella's reliability layer to AI agents like Claude.

## Overview

This package provides an MCP server that allows AI agents to:

- **Validate changes** against task constraints before/after making them
- **Detect risks** in proposed code modifications
- **Track context** across conversation sessions (dependencies, assumptions, changes)
- **Check prerequisites** before starting work

## Installation

```bash
npm install @nella-labs/mcp
# or
pnpm add @nella-labs/mcp
```

## Usage with Claude Desktop

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

### macOS/Linux

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx",
      "args": ["@nella-labs/mcp", "--workspace", "/path/to/your/project"]
    }
  }
}
```

### Windows

```json
{
  "mcpServers": {
    "nella": {
      "command": "npx.cmd",
      "args": ["@nella-labs/mcp", "--workspace", "C:\\path\\to\\your\\project"]
    }
  }
}
```

### Using a local installation

```json
{
  "mcpServers": {
    "nella": {
      "command": "node",
      "args": ["/path/to/nella/packages/mcp/dist/server.js", "--workspace", "/path/to/project"]
    }
  }
}
```

## Available Tools

### Validation Tools

#### `nella_check`
Quick constraint checking without running validations. Verifies:
- File modifications are within allowed scope
- No forbidden patterns in changes
- Files-not-to-modify rules are respected

#### `nella_validate`
Run validation commands (tests, lints, builds) to verify changes work correctly.

#### `nella_run`
Complete Nella run: constraint checking + validation execution + scope creep detection.

### Safety Tools

#### `nella_detect_risks`
Analyze proposed changes for risky patterns:
- Hardcoded credentials
- Debug code
- Insecure patterns
- Production modifications

#### `nella_should_refuse`
Determine if a request should be refused based on cumulative risk analysis.

#### `nella_check_prerequisites`
Verify required prerequisites are met before proceeding.

### Context Tools

#### `nella_get_context`
Get current session context including:
- Recent changes
- Active assumptions
- Dependency status
- Session statistics

#### `nella_add_assumption`
Record an assumption about the codebase for later validation:
- Schema assumptions (database structure)
- Dependency assumptions (package versions)
- Code structure assumptions (patterns, conventions)

#### `nella_check_assumptions`
Check if any recorded assumptions have been invalidated by recent changes.

#### `nella_get_file_history`
Get the change history for a specific file within the session.

#### `nella_check_dependencies`
Check for package.json/lockfile changes since last snapshot.

#### `nella_record_change`
Manually record a change to keep context accurate when making changes outside of `nella_run`.

## Example Usage

Once configured, Claude can use Nella tools naturally:

```
User: Add a pagination endpoint to the users API

Claude: I'll first check if there are any prerequisites and constraints for this task.
[Uses nella_check_prerequisites]
[Uses nella_add_assumption to record API structure assumptions]
[Makes changes]
[Uses nella_run to validate the changes]
```

## Context Persistence

Session context (changes, assumptions, dependency snapshots) is persisted to `.nella/session.json` in your workspace. This allows context to survive across conversations.

> **TODO**: Future versions will include memory management features:
> - Context summarization for long sessions
> - Automatic pruning of old data
> - Tiered storage (hot/warm/cold)

## Development

```bash
# Build
pnpm build

# Development with auto-rebuild
pnpm dev

# Start server manually
pnpm start -- --workspace /path/to/project
```

## Related Packages

- [@nella-labs/core](../core) - Core reliability layer
- [@nella-labs/cli](../cli) - Command-line interface

## License

Apache-2.0
