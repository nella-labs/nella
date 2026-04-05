# MCP Tools

Nella exposes 7 tools through the Model Context Protocol. Your agent calls these automatically during conversations.

## nella_index

Index your codebase for search.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `force` | boolean | No | Rebuild the index from scratch, ignoring cache |
| `paths` | string[] | No | Specific files or directories to index |

Call `nella_index` before your first search, or after major code changes. The index is stored locally in `.nella/` and persists across sessions.

## nella_search

Search across your indexed codebase.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | What to search for |
| `mode` | string | No | `hybrid` (default), `semantic`, or `lexical` |
| `topK` | number | No | Number of results (default: 10) |
| `language` | string | No | Filter by language (e.g., `typescript`) |
| `filePattern` | string | No | Filter by file path substring |

**Search modes:**

- **hybrid** — Best for most queries. Combines keyword matching with meaning-based search.
- **semantic** — Best for conceptual queries like "error handling strategy" or "authentication flow."
- **lexical** — Best for exact symbol names like `getUserById` or `AuthMiddleware`.

Results include file paths, line ranges, matched content, and confidence scores. Content flagged as potentially suspicious is marked with warnings.

## nella_get_context

Review the current session state.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `changesLimit` | number | No | Max number of recent changes to return (default: 20) |

Returns session metadata, recent file changes, recorded assumptions, dependency status, and session statistics.

## nella_add_assumption

Record an assumption about your codebase for later verification.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | Yes | Category: `schema`, `interface`, `dependency`, `behavior`, `config`, `structure`, or `other` |
| `description` | string | Yes | What you're assuming |
| `relatedFiles` | string[] | No | File paths this assumption depends on (supports glob patterns) |
| `confidence` | number | No | How confident you are (0.0 to 1.0, default: 0.8) |

Assumptions are automatically invalidated when their related files change. This catches contradictions before they become bugs.

## nella_check_assumptions

Verify that all recorded assumptions still hold.

No parameters. Returns a summary of valid, invalidated, and total assumptions, grouped by type. Returns an error signal when any assumptions have been invalidated, prompting the agent to re-evaluate.

## nella_check_dependencies

Detect changes to project dependencies since the last check.

No parameters. Compares the current `package.json` and lockfile against a stored snapshot. Reports added, removed, and updated packages. Creates an initial snapshot on first call. Returns an error signal when dependency drift is detected.

## nella_heartbeat

Session verification check.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `challenge_response` | string | Yes | Response value from the previous session context |

Confirms session continuity between tool calls. The agent receives a challenge value from `nella_get_context` and responds here.

## Quick Reference

| If you want to... | Use |
|-------------------|-----|
| Search for code | `nella_search` |
| Index or re-index | `nella_index` |
| Check session state | `nella_get_context` |
| Record a belief about the code | `nella_add_assumption` |
| Verify your beliefs | `nella_check_assumptions` |
| Check for package changes | `nella_check_dependencies` |
| Verify session continuity | `nella_heartbeat` |
