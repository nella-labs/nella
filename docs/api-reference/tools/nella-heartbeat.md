# nella_heartbeat

Verify trust-chain continuity with a challenge-response check.

This tool is registered by the local MCP server alongside the context and indexing tools. It is meant to be called with the challenge returned by [`nella_get_context`](./nella-get-context.md) or by the previous `nella_heartbeat` response.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `challenge_response` | `string` | Yes | The current challenge value returned by Nella. |

## Example

```typescript
nella_heartbeat({
  challenge_response: "abcd1234",
});
```

## Response Shape

```markdown
### Heartbeat: OK

Trust chain verified successfully.

Next challenge: `ef567890`
Verified: 3 | Failed: 0
```

## Notes

- If the response does not match, the body reports `Heartbeat: FAILED` and explains that the trust chain may be compromised.
- The tool still returns a fresh challenge even after failure.
- Failure is reported in the text body; the handler does not currently set `isError`.

See [`nella_get_context`](./nella-get-context.md) for where the initial challenge comes from.
