# REST API

Nella provides a hosted REST API for programmatic access to search, context, and workspace management.

## Base URL

```
https://mcp.getnella.dev/api/v1
```

## Authentication

Include your API key in the request headers:

```bash
curl -H "Authorization: Bearer nella_your_api_key" \
  https://mcp.getnella.dev/api/v1/health
```

## Rate Limits

| Window | Limit |
|--------|-------|
| Per minute | 60 requests |
| Per hour | 1,000 requests |
| Per day | 10,000 requests |

Rate limit headers are included in every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

## Endpoints

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server health check |

### Search

| Method | Path | Description |
|--------|------|-------------|
| POST | `/search` | Search indexed codebase |
| POST | `/search/batch` | Batch search queries |

### Workspaces

| Method | Path | Description |
|--------|------|-------------|
| GET | `/workspaces` | List workspaces |
| POST | `/workspaces` | Register a workspace |
| GET | `/workspaces/:id` | Get workspace details |
| DELETE | `/workspaces/:id` | Remove a workspace |
| POST | `/workspaces/:id/index` | Trigger indexing |

### Context

| Method | Path | Description |
|--------|------|-------------|
| GET | `/context` | Get session context |
| POST | `/context/assumptions` | Add an assumption |
| GET | `/context/assumptions` | List assumptions |
| POST | `/context/assumptions/check` | Verify assumptions |
| GET | `/context/dependencies` | Check dependency status |
| GET | `/context/changes` | List recent changes |

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/keys` | Create API key |
| GET | `/auth/keys` | List API keys |
| DELETE | `/auth/keys/:id` | Revoke API key |
| GET | `/auth/usage` | View usage stats |

## Plans

Some features and limits vary by plan:

| Feature | Free | Pro | Team |
|---------|------|-----|------|
| Workspaces | 3 | 10 | Unlimited |
| Search queries / day | 100 | 5,000 | 50,000 |
| Index size | 50MB | 500MB | 5GB |
| API access | Limited | Full | Full |

## Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Rate limit exceeded. Try again in 30 seconds."
  }
}
```

Standard HTTP status codes: `200` success, `400` bad request, `401` unauthorized, `403` forbidden, `404` not found, `429` rate limited, `500` server error.
