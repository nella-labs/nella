# nella_index

Index or re-index the workspace codebase for Nella search.

The local MCP server uses the same index manager for indexing and search.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `force` | `boolean` | No | Rebuild the index and ignore cached embeddings. Default: `false`. |
| `paths` | `string[]` | No | Specific files or directories to index. Each path is resolved relative to the workspace root. |

## Example

```typescript
nella_index({
  force: true,
  paths: ["packages/nella/src/mcp", "docs/api-reference"],
});
```

## Response Shape

```markdown
Index complete.

- Files indexed: 42
- Chunks created: 318
- Embeddings: 318
- Tokens processed: 87124

Storage: /path/to/project/.nella/index
```

## Notes

- The tool stores index data under `.nella/index`.
- `paths` scopes which files are indexed; it does not change the workspace root.
- The server excludes `.nella/**` from indexing.

See [`nella_search`](./nella-search.md) for the query side of the index.
