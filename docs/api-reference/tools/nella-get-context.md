# nella_get_context

Get the current session context for the workspace.

The response includes session metadata, recent changes, assumption status, dependency snapshot details, and the trust-chain metadata that Nella uses for prompt-injection defense.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `changesLimit` | `number` | No | Maximum number of recent changes to include. Default: `20`. |

## Example

```typescript
nella_get_context({
  changesLimit: 10,
});
```

## Response Notes

- Always returns the session ID, workspace path, start time, and session duration.
- Includes hotspot files, recent changes, active assumptions, recent invalidations, and dependency snapshot details when available.
- Also includes:
  - A per-session trust token.
  - HMAC integrity guidance for `nella_search` results.
  - The current heartbeat challenge for [`nella_heartbeat`](./nella-heartbeat.md).

## Response Shape

```markdown
## Session Context

**Session ID**: sess_abc123
**Workspace**: /path/to/project
**Started**: 3/27/2026, 8:00:00 PM
**Duration**: 12 minutes

### Statistics
- Total changes: 4
- Valid assumptions: 2
- Invalidated assumptions: 0

### Session Trust Token
Token: `nella-verify-...`

### Challenge-Response
Current challenge: `abcd1234`
```

See [Context Tools](./context-tools.md) for the surrounding workflow.
