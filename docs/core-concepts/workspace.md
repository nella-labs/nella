# Workspace & Search

How Nella indexes your codebase and how search works.

## The .nella/ Directory

When you index a project, Nella creates a `.nella/` directory:

```
your-project/
  src/
  package.json
  .nella/
    index/        # Search index data
    context/      # Session and assumption data
```

> **Tip:** Add `.nella/` to your `.gitignore`. The index is local to your machine and rebuilds automatically.

## Indexing Your Code

Your agent calls `nella_index` to parse and index your codebase. The index enables fast search across all your files.

- Run indexing before your first search
- Re-index after major changes, branch switches, or large merges
- Use `force: true` for a complete rebuild
- Use `paths` to index specific files or directories

Nella understands code structure — it indexes functions, classes, interfaces, and other symbols so your agent can find exactly what it needs.

## Searching Your Code

`nella_search` supports three modes:

| Mode | Best For | Example Query |
|------|----------|---------------|
| `hybrid` (default) | Most queries | "user authentication flow" |
| `semantic` | Conceptual questions | "how are errors handled" |
| `lexical` | Exact symbol names | "getUserById" |

**Tips for better results:**

- Use the `language` filter to narrow results: `language: "typescript"`
- Use `filePattern` to search specific paths: `filePattern: "src/api/"`
- Start with `hybrid` mode — it works well for nearly everything
- Switch to `lexical` when searching for exact function or class names

## What Gets Indexed

Nella indexes source files in your workspace, skipping common non-code directories like `node_modules/`, `.git/`, and build output. The index includes:

- Function and method definitions
- Class and interface declarations
- Type definitions and exports
- File-level documentation and comments
