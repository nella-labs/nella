# Context Tools

Context tools keep a local Nella session grounded in what has already changed, what assumptions are in play, and whether dependency drift or prompt-injection trust issues need attention.

## Tools

| Tool | Purpose |
|------|---------|
| [`nella_get_context`](./nella-get-context.md) | Return session context, dependency snapshot details, trust metadata, and the current heartbeat challenge. |
| [`nella_add_assumption`](./nella-add-assumption.md) | Record an assumption and tie it to related files or glob patterns. |
| [`nella_check_assumptions`](./nella-check-assumptions.md) | Summarize valid and invalidated assumptions by type. |
| [`nella_check_dependencies`](./nella-check-dependencies.md) | Compare the current dependency state to the last snapshot. |

## Shared Behavior

- `nella_add_assumption.relatedFiles` supports exact paths and glob patterns.
- `nella_check_assumptions` returns `isError: true` when any recorded assumption has been invalidated.
- `nella_check_dependencies` returns `isError: true` when it detects dependency changes.
- `nella_get_context` is the entry point for the session trust chain: it returns the trust token, HMAC integrity metadata, and the heartbeat challenge used by [`nella_heartbeat`](./nella-heartbeat.md).

## Typical Flow

1. Call [`nella_get_context`](./nella-get-context.md) to understand the current session.
2. Record assumptions with [`nella_add_assumption`](./nella-add-assumption.md) before making changes.
3. Re-check assumptions with [`nella_check_assumptions`](./nella-check-assumptions.md) after edits.
4. Run [`nella_check_dependencies`](./nella-check-dependencies.md) when package state may have changed.
