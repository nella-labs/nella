# Troubleshooting

Common issues and solutions when using Nella.

## Installation Issues

### `command not found: nella`

The CLI isn't in your PATH. Solutions:

```bash
# Check if the CLI is on your PATH
which nella

# Reinstall globally
npm install -g @getnella/mcp

# Or run the local stdio MCP server without a global install
npx -y @getnella/mcp --workspace /path/to/project
```

On Windows, you may need to restart your terminal or add npm's global bin to your PATH.

### `Cannot find module '@usenella/core'`

Make sure you've installed the package:

```bash
npm install @usenella/core
```

If you installed `@getnella/mcp` globally, you need a separate local install of `@usenella/core` to import it in your code.

### Optional dependency warnings

Messages like `usearch not available, falling back to brute-force` are normal. Optional dependencies provide performance improvements but aren't required:

| Warning | Meaning | Impact |
|---------|---------|--------|
| `usearch not available` | HNSW vector index unavailable | Vector search uses brute-force cosine similarity (slower at scale) |
| `better-sqlite3 not available` | SQLite rate limiter unavailable | Rate limiting uses in-memory backend (resets on restart) |
| `onnxruntime-node not available` | Local embeddings unavailable | Embedding requires API calls (Azure or Nella cloud) |

## MCP Server Issues

### Tools not appearing in Claude Desktop

1. **Restart Claude Desktop** — MCP servers are loaded on startup
2. **Verify the config path:**
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
3. **Test the server manually:**
   ```bash
   npx -y @getnella/mcp --workspace /path/to/project
   ```
   If this shows errors, fix them before restarting Claude Desktop
4. **Check Node.js version:** Nella requires Node.js 18+
   ```bash
   node --version
   ```

### "MCP server disconnected" in Claude Desktop

Common causes:
- The server process crashed — check Claude Desktop's logs
- The configured `--workspace` path points to a directory that doesn't exist
- Node.js is not accessible from the shell that Claude Desktop uses

### MCP server is slow to start

The first run downloads the package via `npx`. To speed this up:

```bash
# Pre-install the package
npm install -g @getnella/mcp

# Then use the direct path in your config
{
  "mcpServers": {
    "nella": {
      "command": "nella",
      "args": ["mcp", "--workspace", "/absolute/path/to/project"]
    }
  }
}
```

### Cursor MCP issues

1. Check the MCP panel in Cursor settings for error messages
2. Ensure `npx` is accessible from Cursor's integrated terminal
3. Try using an absolute path to `npx` or `nella`

## Indexing Issues

### Indexing is slow

Full indexing is I/O-bound by embedding API calls. Tips:

| Solution | Impact |
|----------|--------|
| Use Nella cloud embeddings (`nella auth login`) | Higher rate limits than Azure free tier |
| Incremental re-indexing | 20x faster for unchanged codebases |
| Use include/exclude globs | Skip large generated files |
| Install `usearch` for HNSW | Faster vector search (not faster indexing) |

### Search results are irrelevant

Hybrid search combines semantic (vector) and lexical (BM25) results. If results are poor:

1. **For exact symbol lookups** — Use lexical search mode directly (it's <2ms and exact)
2. **For natural language queries** — Semantic search depends on embedding quality and chunk boundaries
3. **Confidence score is always ~0.22** — This is expected for broad queries. The `query_unclear` suggestion indicates the query could be more specific

### Large index size on disk

A typical monorepo index is ~500MB. Breakdown:

| File | ~Size | Reducible? |
|------|-------|-----------|
| `vectors.json` | 140 MB | Future: binary format |
| `chunks.json` | 133 MB | Future: compression |
| `embeddings.cache.json` | 131 MB | Delete to re-embed (costs API calls) |
| `lexical.json` | 2.6 MB | No |

Add `.nella/index/` to your `.gitignore` — indexes should not be committed.

### Code verifier false positives

The code verifier may flag valid symbols as "missing" when:

1. **Chunk boundary issue** — A large class declaration is split across chunks, and the export gets separated from the class body
2. **Re-exports** — Symbols re-exported via `export * from` may not resolve if the re-export chain crosses multiple files
3. **Dynamic exports** — Computed or conditional exports aren't tracked

## Authentication Issues

### `nella auth login` doesn't open browser

Try opening the URL manually. The CLI prints the auth URL:

```
Opening browser to: https://app.getnella.dev/auth?...
```

Copy and paste this URL into your browser.

### "Invalid API key" errors

1. **Key expired** — API keys have an expiry date. Create a new one: `nella connect`
2. **Key revoked** — Check if the key was revoked in the dashboard
3. **Wrong key** — Ensure you're using the full key including the `nella_` prefix

### Rate limit errors

If you see `Error: rate limit exceeded`:

- Wait for the rate limit window to reset (usually 1 minute)
- Reduce the frequency of tool calls
- Contact support for higher limits if you're on a paid plan

## Context Tracking Issues

### Assumptions not persisting

Context is stored in `.nella/sessions/{sessionId}.json`. Check that:

1. The `.nella/` directory exists and is writable
2. The session ID is consistent across calls (a new session starts fresh)

### Stale dependency warnings

`nella_check_dependencies` compares the current `package.json` and lockfile against the last snapshot. If you recently installed packages, the next call will take a fresh snapshot.

## FAQ

### Do I need a Nella account?

Yes. A Nella account is required. Run `nella auth login` to authenticate before using Nella tools.

### Does Nella modify my source code?

No. Nella only reads your codebase for indexing and search. The only files Nella writes are in the `.nella/` directory (indexes, sessions).

### What languages does Nella support?

The indexing/search features use TypeScript's compiler API for AST-based chunking, so they work best with TypeScript/JavaScript. Other languages are indexed as plain text chunks.

### What is Nella's licensing model?

Nella is a commercial product. Visit [getnella.dev](https://getnella.dev) for pricing and plan details.

## Related Docs

- [CLI Commands](../cli/commands.md) — Full command reference
- [Quick Start](../getting-started/quick-start.md) — Connect Nella to your IDE
