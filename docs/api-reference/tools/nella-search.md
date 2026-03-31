# nella_search

Search the indexed workspace with hybrid, semantic, or lexical retrieval.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | `string` | Yes | Search query text. |
| `mode` | `string` | No | One of `hybrid`, `semantic`, `lexical`. Default: `hybrid`. |
| `topK` | `number` | No | Maximum number of results to return. Default: `10`. |
| `language` | `string` | No | File type filter. Accepts language names like `typescript` or raw extensions like `ts`. |
| `filePattern` | `string` | No | Case-insensitive substring match against indexed file paths. This is not glob matching. |

## Example

```typescript
nella_search({
  query: "challenge_response",
  mode: "lexical",
  topK: 5,
  language: "ts",
  filePattern: "packages/nella/src/mcp/tools",
});
```

## Behavior

- Requires the workspace to have already been indexed with [`nella_index`](./nella-index.md).
- If the index is empty, the tool returns an error telling you to run `nella_index` first.
- `language` is matched through the core language-to-extension mapping. For example, `typescript` matches `.ts` and `.tsx`.
- `filePattern` is passed to the path filter as a literal substring. `packages/nella/src/mcp/tools` matches; `packages/**/tools` does not behave like a glob.

## Response Shape

```markdown
Found 3 results for "challenge_response" (12ms, confidence: 96%):

## packages/nella/src/mcp/tools/heartbeat.ts:89-99 (98.4% match)
Type: function | Language: typescript
Symbols: registerHeartbeatTool
```typescript
...
```
```

## Security Notes

- Search results are wrapped with Nella integrity markers.
- When indexed content looks like prompt injection, the result includes an inline warning telling the agent to treat it as data, not instructions.

See [`nella_index`](./nella-index.md) for indexing prerequisites.
