# Troubleshooting

Common issues and solutions when using Nella.

## Installation Issues

### `command not found: nella`

The CLI isn't in your PATH. Solutions:

```bash
# Check if it's installed
npx @usenella/nella --version

# Reinstall globally
npm install -g @usenella/nella

# Or use npx instead of a global install
npx @usenella/nella check -t task.yaml -r .
```

On Windows, you may need to restart your terminal or add npm's global bin to your PATH.

### `Cannot find module '@usenella/core'`

Make sure you've installed the package:

```bash
npm install @usenella/core
```

If you installed `@usenella/nella` globally, you need a separate local install of `@usenella/core` to import it in your code.

### Optional dependency warnings

Messages like `usearch not available, falling back to brute-force` are normal. Optional dependencies provide performance improvements but aren't required:

| Warning | Meaning | Impact |
|---------|---------|--------|
| `usearch not available` | HNSW vector index unavailable | Vector search uses brute-force cosine similarity (slower at scale) |
| `better-sqlite3 not available` | SQLite rate limiter unavailable | Rate limiting uses in-memory backend (resets on restart) |
| `onnxruntime-node not available` | Local embeddings unavailable | Embedding requires API calls (OpenAI or Voyage) |

## MCP Server Issues

### Tools not appearing in Claude Desktop

1. **Restart Claude Desktop** — MCP servers are loaded on startup
2. **Verify the config path:**
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
3. **Test the server manually:**
   ```bash
   npx @usenella/nella mcp
   ```
   If this shows errors, fix them before restarting Claude Desktop
4. **Check Node.js version:** Nella requires Node.js 18+
   ```bash
   node --version
   ```

### "MCP server disconnected" in Claude Desktop

Common causes:
- The server process crashed — check Claude Desktop's logs
- `NELLA_REPO_PATH` points to a directory that doesn't exist
- Node.js is not accessible from the shell that Claude Desktop uses

### MCP server is slow to start

The first run downloads the package via `npx`. To speed this up:

```bash
# Pre-install the package
npm install -g @usenella/nella

# Then use the direct path in your config
{
  "mcpServers": {
    "nella": {
      "command": "nella",
      "args": ["mcp"]
    }
  }
}
```

### Cursor MCP issues

1. Check the MCP panel in Cursor settings for error messages
2. Ensure `npx` is accessible from Cursor's integrated terminal
3. Try using an absolute path to `npx` or `nella`

## Validation Issues

### Tests pass locally but fail in Nella

Nella runs tests in a **cloned temporary workspace**. Common causes:

1. **Missing `node_modules`** — Nella doesn't install dependencies in the temp workspace. Your project must have `node_modules` present
2. **Absolute path dependencies** — Code that references absolute paths will break in the cloned directory
3. **Environment variables** — The temp workspace doesn't inherit your shell's environment. Set required vars in the task YAML or Nella config
4. **File permissions** — On Linux/macOS, the temp directory may have different permissions

### "Constraint violation" for valid changes

Check your constraint definitions:

```yaml
constraints:
  - id: no-debug
    forbidden_patterns:
      - "console.log"  # This matches ANY console.log, even in comments
```

Forbidden patterns match against the **unified diff** output, not the final file. If the pattern appears in context lines (unchanged lines shown in the diff), it may trigger a false positive.

> **Tip:** Make patterns more specific: `+ console.log` (with the `+` prefix) matches only added lines in the diff.

### Scope creep false positives

If Nella reports scope creep for files you intended to modify, add them to `files_to_modify`:

```yaml
expected:
  files_to_modify:
    - "src/routes/users.ts"
    - "src/models/user.ts"  # Add forgotten files here
  files_to_ignore:
    - "**/*.test.ts"
    - "**/*.snap"
```

### Validation timeout

If validation commands (test/lint/compile) take too long:

```yaml
timeout_seconds: 300  # Increase from default 120
```

Or skip validation during development:

```bash
nella run -t task.yaml -r . -c changes.json --skip-validation
```

## Indexing Issues

### Indexing is slow

Full indexing is I/O-bound by embedding API calls. Tips:

| Solution | Impact |
|----------|--------|
| Use OpenAI embeddings (default) | Higher rate limits than Voyage free tier |
| Incremental re-indexing | 20x faster for unchanged codebases |
| Use include/exclude globs | Skip large generated files |
| Install `usearch` for HNSW | Faster vector search (not faster indexing) |

### Search results are irrelevant

Hybrid search combines semantic (vector) and lexical (BM25) results. If results are poor:

1. **For exact symbol lookups** — Use lexical search mode directly (it's &lt;2ms and exact)
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

Add `.nella/indexing/` to your `.gitignore` — indexes should not be committed.

### Code verifier false positives

The code verifier may flag valid symbols as "missing" when:

1. **Chunk boundary issue** — A large class declaration is split across chunks, and the export gets separated from the class body. This is a known limitation
2. **Re-exports** — Symbols re-exported via `export * from` may not resolve if the re-export chain crosses multiple files
3. **Dynamic exports** — Computed or conditional exports aren't tracked

If you see a false positive, check that the flagged symbol actually exists:

```bash
# Quick check with grep
grep -r "export.*ClassName" src/
```

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
2. You're passing `enableContextTracking: true` in options
3. The session ID is consistent across calls (a new session starts fresh)

### Stale dependency warnings

`checkDependencies()` compares the current `package.json` and lockfile against the last snapshot. If you recently installed packages, take a new snapshot:

```typescript
const ctx = new ContextManager(repoPath);
await ctx.dependencies.takeSnapshot(repoPath);
```

## FAQ

### Can I use Nella without an account?

Yes. All core features (constraint checking, validation, safety detection, context tracking, indexing) work locally without any account. Cloud features (sync, hosted MCP server, playground) require a Nella account.

### Does Nella modify my source code?

No. Nella works in a temporary cloned workspace. Your source code is never modified. The only files Nella writes are in the `.nella/` directory (indexes, sessions, artifacts).

### What languages does Nella support?

Nella's validators (constraints, scope checking, forbidden patterns) work with any language — they operate on file paths and text diffs. The indexing/RAG features use TypeScript's compiler API for AST-based chunking, so they work best with TypeScript/JavaScript. Other languages are indexed as plain text chunks.

### Is Nella open source?

Yes. Nella is open source under the MIT license. See the [GitHub repository](https://github.com/nella-labs/nella).

### How does Nella compare to writing tests?

Nella complements tests, it doesn't replace them. Tests verify behavior; Nella verifies that the AI agent followed the rules (didn't modify protected files, didn't add forbidden patterns, didn't scope creep, etc.). Nella can also _run_ your tests as part of validation.

## Related Docs

- [CLI Commands](../cli/commands.md) — Full command reference
- [MCP Setup](../user-guide/mcp-setup.md) — Connect Nella to your IDE
- [Configuration Reference](../core/configuration.md) — All configuration options
