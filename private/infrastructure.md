# Infrastructure Map

## Production Services

### Vercel (nella-website repo)
- **app.getnella.dev** — Dashboard, API routes (auth, embeddings, billing, usage)
- **getnella.dev** — Marketing website (www)
- **docs.getnella.dev** — Documentation site (Astro)
- Serverless functions handle: embedding proxy, payments, auth, chat

### GCP Cloud Run (nella repo)
- **mcp.getnella.dev** → `nella-mcp` Cloud Run service in `us-central1`
- This is the **hosted MCP server** that `nella connect` points users to
- Users connect via `nella connect --client claude` → writes `mcp.getnella.dev/mcp` to their MCP config
- Auto-deployed on push to main via `.github/workflows/deploy-gcp.yml`
- Health check: `https://mcp.getnella.dev/health`
- Scaling: 0–3 instances, 512Mi RAM, 1 CPU

### Supabase
- Primary database for both repos
- Tables: api_keys, organizations, usage_logs, usage_events, context, plans
- Auth: user accounts, session management
- Used by: Vercel API routes + Cloud Run hosted server

### Redis (via GCP Secret Manager)
- `REDIS_URL` stored as GCP secret, injected into Cloud Run
- Used by: hosted MCP server for distributed rate limiting
- Status: connected and working (`"redis":"ready"`)

### Azure OpenAI
- **nella-embeddings** resource in East US
- Deployment: `text-embedding-3-small` (Standard)
- Used by: Vercel embedding proxy (`app.getnella.dev/api/embeddings`)
- Env vars: `AZURE_EMBEDDING_ENDPOINT`, `AZURE_EMBEDDING_API_KEY`
- Fallback: `OPENAI_API_KEY` if Azure vars not set

## Domain Mapping

| Domain | Points To | Repo |
|--------|-----------|------|
| `getnella.dev` | Vercel (www) | nella-website |
| `app.getnella.dev` | Vercel (app) | nella-website |
| `docs.getnella.dev` | Vercel (docs) | nella-website |
| `mcp.getnella.dev` | GCP Cloud Run | nella |

## GCP Resources (nella-sync project)

| Resource | Service | Purpose |
|----------|---------|---------|
| `nella-mcp` | Cloud Run | Hosted MCP server |
| `nella-db` | Cloud SQL | PostgreSQL (optional sync tier) |
| `nella-sync-indexes` | Cloud Storage | Index sync bucket |
| `REDIS_URL` | Secret Manager | Redis connection string |
| `SUPABASE_*` | Secret Manager | Supabase credentials |
| `VOYAGE_API_KEY` | Secret Manager | Voyage API key (unused) |
| `nella` | Artifact Registry | Docker images |

## Payment Flow

Lemon Squeezy → webhook → `app.getnella.dev/api/webhooks/lemonsqueezy` → Supabase (plans, credits)

## Env Vars by Service

### Cloud Run (GCP Secrets)
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `GCP_CLOUD_SQL_INSTANCE`, `GCP_DB_USER`, `GCP_DB_PASSWORD`, `GCP_DB_NAME`, `NELLA_AUTH_ENCRYPTION_KEY`, `NELLA_JWT_SECRET`, `VOYAGE_API_KEY`

### Vercel (app.getnella.dev)
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `AZURE_EMBEDDING_ENDPOINT`, `AZURE_EMBEDDING_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `RESEND_API_KEY`, `REDIS_URL`
