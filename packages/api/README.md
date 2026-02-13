# @usenella/api

REST API server for the Nella coding agent platform. Built with Express 4, TypeScript, and Zod validation.

## Quick Start

```bash
# From monorepo root
pnpm install
pnpm build

# Start the API server
pnpm dev:api
```

## Configuration

Set environment variables (or use a `.env` file):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Server port |
| `NODE_ENV` | No | `development` | Environment |
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Supabase service role key |
| `ALLOWED_ORIGINS` | No | `*` | Comma-separated CORS origins |
| `REDIS_URL` | No | — | Redis URL for caching |
| `LOG_LEVEL` | No | `info` | Pino log level |

## API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe (checks Supabase + Redis) |
| GET | `/metrics` | Prometheus-compatible metrics |

### Protected (requires API key)

All protected routes require an API key via `Authorization: Bearer nla_xxx` or `X-API-Key: nla_xxx`.

#### Workspaces (`/api/v1/workspaces`)

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/` | `workspaces:read` | List workspaces (paginated) |
| POST | `/` | `workspaces:write` | Create workspace |
| GET | `/:id` | `workspaces:read` | Get workspace by ID |
| PATCH | `/:id` | `workspaces:write` | Update workspace |
| DELETE | `/:id` | `workspaces:write` | Remove workspace |
| POST | `/:id/index` | `workspaces:write` | Trigger indexing (202) |
| GET | `/:id/index/status` | `workspaces:read` | Get index status |
| POST | `/:id/sync` | `workspaces:write` | Trigger cloud sync (202) |

#### Search (`/api/v1/search`)

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| POST | `/` | `search:read` | Hybrid/semantic/lexical search |
| POST | `/batch` | `search:read` | Batch search (up to 20 queries) |
| POST | `/verify` | `search:read` | Code verification |

#### Validation (`/api/v1/validate`)

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| POST | `/check` | `validate:run` | Pre-flight safety check |
| POST | `/validate` | `validate:run` | Validate changes against constraints |
| POST | `/run` | `validate:run` | Full validation run |

#### Context (`/api/v1/context`)

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/` | `context:read` | Get context entries |
| POST | `/assumptions` | `context:write` | Add assumption |
| GET | `/assumptions` | `context:read` | Get assumption status |
| GET | `/files/*` | `context:read` | Get file history |
| GET | `/dependencies` | `context:read` | Check dependency diff |
| POST | `/changes` | `context:write` | Record file changes |
| GET | `/sessions` | `context:read` | List active sessions |
| DELETE | `/sessions/:workspaceId` | `context:write` | Delete session |

#### Auth (`/api/v1/auth`)

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| POST | `/keys` | `admin` | Create API key |
| GET | `/keys` | *(auth)* | List user's API keys |
| DELETE | `/keys/:id` | *(auth)* | Revoke API key |
| POST | `/agents` | `admin` | Register agent |
| GET | `/agents` | *(auth)* | List agents |
| GET | `/usage` | *(auth)* | Usage statistics |

## Response Format

### Success

```json
{
  "data": { ... },
  "meta": { "cursor": "...", "hasMore": true }
}
```

### Error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": [ ... ],
    "requestId": "uuid"
  }
}
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AUTHENTICATION_REQUIRED` | 401 | Missing API key |
| `INVALID_API_KEY` | 401 | Invalid or unknown API key |
| `API_KEY_REVOKED` | 401 | Key has been revoked |
| `API_KEY_EXPIRED` | 401 | Key has expired |
| `INSUFFICIENT_SCOPE` | 403 | Missing required scope |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Request body validation failed |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limit hit |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Testing

```bash
# Run all API tests
pnpm --filter @usenella/api test

# Run with coverage
pnpm --filter @usenella/api test:ci
```

## Architecture

```
src/
├── app.ts              # Express app factory
├── config.ts           # Zod-validated env config
├── server.ts           # Server entrypoint
├── middleware/
│   ├── auth.ts         # API key auth + scope enforcement
│   ├── error-handler.ts # Global error handler
│   ├── rate-limit.ts   # Per-key rate limiting
│   └── validation.ts   # Zod body validation
├── routes/
│   ├── auth.ts         # /api/v1/auth
│   ├── context.ts      # /api/v1/context
│   ├── health.ts       # /health, /ready, /metrics
│   ├── search.ts       # /api/v1/search
│   ├── validate.ts     # /api/v1/validate
│   └── workspaces.ts   # /api/v1/workspaces
└── utils/
    ├── errors.ts       # Custom error classes
    ├── logger.ts       # Pino logger
    ├── pagination.ts   # Cursor-based pagination
    └── responses.ts    # Standardized response helpers
```
