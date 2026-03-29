# MCP Tools Reference

Complete reference for the tools exposed by the local Nella MCP server.

The server currently registers 7 tools:

| Category | Tools |
|----------|-------|
| Context | [`nella_get_context`](../api-reference/tools/nella-get-context.md), [`nella_add_assumption`](../api-reference/tools/nella-add-assumption.md), [`nella_check_assumptions`](../api-reference/tools/nella-check-assumptions.md), [`nella_check_dependencies`](../api-reference/tools/nella-check-dependencies.md) |
| Indexing | [`nella_index`](../api-reference/tools/nella-index.md), [`nella_search`](../api-reference/tools/nella-search.md) |
| Trust Chain | [`nella_heartbeat`](../api-reference/tools/nella-heartbeat.md) |

## Table of Contents

- [Context Tools](#context-tools)
- [Indexing Tools](#indexing-tools)
- [Trust Chain Tool](#trust-chain-tool)

## Context Tools

### `nella_get_context`

Returns session state for the current workspace, including recent changes, assumption counts, dependency snapshot details, and the prompt-injection trust metadata issued for the session.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `changesLimit` | `number` | No | Maximum number of recent changes to include. Default: `20`. |

**Behavior**

- Includes session statistics, hotspot files, active assumptions, and recent invalidations when present.
- Also returns the session trust token, HMAC integrity guidance, and the current heartbeat challenge.

See [`nella_get_context`](../api-reference/tools/nella-get-context.md) for the full per-tool reference.

### `nella_add_assumption`

Records an assumption about the codebase so later changes can invalidate it automatically.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | `string` | Yes | One of `schema`, `interface`, `dependency`, `behavior`, `config`, `structure`, `other`. |
| `description` | `string` | Yes | Human-readable assumption text. |
| `relatedFiles` | `string[]` | No | Files or glob patterns related to the assumption. Matching uses `minimatch` in the core assumption tracker. |
| `confidence` | `number` | No | Confidence from `0` to `1`. Default: `0.8`. |

See [`nella_add_assumption`](../api-reference/tools/nella-add-assumption.md).

### `nella_check_assumptions`

Lists valid and recently invalidated assumptions and summarizes them by type.

**Parameters**

None.

**Behavior**

- Returns `isError: true` when any assumptions have been invalidated.

See [`nella_check_assumptions`](../api-reference/tools/nella-check-assumptions.md).

### `nella_check_dependencies`

Compares the current dependency state to the last recorded snapshot.

**Parameters**

None.

**Behavior**

- Reports added, removed, and updated packages.
- Returns `isError: true` when dependency drift is detected.

See [`nella_check_dependencies`](../api-reference/tools/nella-check-dependencies.md).

## Indexing Tools

### `nella_index`

Builds or refreshes the workspace index used by `nella_search`.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `force` | `boolean` | No | Rebuild the index and ignore cached embeddings. Default: `false`. |
| `paths` | `string[]` | No | Files or directories to index. Each path is resolved relative to the workspace root before indexing. |

**Behavior**

- Requires an authenticated Nella session (`nella auth login`).
- Stores index data under `.nella/index` in the workspace.

See [`nella_index`](../api-reference/tools/nella-index.md).

### `nella_search`

Searches the indexed workspace with `hybrid`, `semantic`, or `lexical` retrieval.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | `string` | Yes | Search query text. |
| `mode` | `string` | No | One of `hybrid`, `semantic`, `lexical`. Default: `hybrid`. |
| `topK` | `number` | No | Maximum number of results. Default: `10`. |
| `language` | `string` | No | File type filter. Accepts language names like `typescript` or raw extensions like `ts`. |
| `filePattern` | `string` | No | Case-insensitive substring match against indexed file paths. This is not glob matching. |

**Behavior**

- Requires a non-empty index; otherwise the tool returns an error telling you to run `nella_index`.
- Returns wrapped code chunks with relative paths, line ranges, type/language metadata, symbol names when available, and injection warnings or HMAC integrity markers when present.

See [`nella_search`](../api-reference/tools/nella-search.md).

## Trust Chain Tool

### `nella_heartbeat`

Verifies trust-chain continuity by checking the challenge issued from `nella_get_context` or the previous `nella_heartbeat` response.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `challenge_response` | `string` | Yes | The current challenge value returned by Nella. |

**Behavior**

- Returns an `OK` or `FAILED` status in the response body and always issues a new challenge.
- Failure is communicated in the markdown response body rather than through `isError`.

See [`nella_heartbeat`](../api-reference/tools/nella-heartbeat.md).
