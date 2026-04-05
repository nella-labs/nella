# Troubleshooting

Common issues and how to resolve them.

## First Steps

Most issues are resolved by checking your Node.js version and reinstalling:

```bash
node --version   # Must be 18+
nella help        # Should show available commands
```

## Installation

### `nella: command not found`

The global npm bin directory isn't in your PATH. Fix:

```bash
# Check where npm installs global packages
npm config get prefix

# Add to your shell profile (~/.zshrc, ~/.bashrc)
export PATH="$(npm config get prefix)/bin:$PATH"
```

Then restart your terminal and try again.

## Connection Issues

### Tools not appearing in my client

1. Restart your MCP client (IDE)
2. Check that the workspace path in your MCP config is correct
3. Verify Nella is running: `nella help`
4. Re-run `nella connect --client <your-client>`

### Server disconnects frequently

This usually means the Nella process is being killed. Check:

- Your IDE's MCP server timeout settings
- Whether the workspace path exists and is accessible
- System memory — indexing large codebases needs adequate RAM

### Slow startup

First launch downloads dependencies. Subsequent launches are faster. If consistently slow, check your network connection and npm registry settings.

## Search Issues

### No results

- Run `nella_index` first — search requires an index
- Check your query: use `lexical` mode for exact symbol names
- Check `filePattern` and `language` filters aren't too restrictive

### Irrelevant results

- Use `filePattern` to narrow to specific directories
- Use `language` to filter by file type
- Try `lexical` mode for precise symbol matching
- Re-index with `force: true` if the codebase changed significantly

## Authentication

### Login not opening browser

Try running `nella auth login` from a terminal (not from within an IDE terminal). Some embedded terminals block browser launches.

### Rate limit errors

Wait for the rate limit window to reset. Check your current usage with `nella auth status`.

## FAQ

**Do I need an account?**

No. Nella works locally without authentication. An account is only needed for hosted features.

**Does Nella modify my source code?**

No. Nella only reads your codebase for indexing and search. It never writes to your files.

**What languages are supported?**

Nella works best with TypeScript and JavaScript. Other languages are indexed as plain text and searchable, but without structure-aware parsing.
