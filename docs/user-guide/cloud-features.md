# Cloud Features

Nella includes optional cloud features for teams: authentication, cloud sync, and the real-time playground. All cloud features require a Nella account at [app.getnella.dev](https://app.getnella.dev).

## Authentication

### Sign In

```bash
nella auth login
```

This opens your browser for OAuth sign-in. After authenticating, tokens are saved to `~/.nella/auth.json`.

### Check Status

```bash
nella auth status
```

Shows your current auth state, account email, and token expiry.

### Sign Out

```bash
nella auth logout
```

Removes saved tokens.

### API Keys

API keys authenticate MCP server connections and API calls:

```bash
# Create a new API key
nella connect
```

The `connect` command creates an API key and configures your MCP client. API keys have the format `nella_abc123...`.

For programmatic key management, use the TypeScript library:

```typescript
import { KeyManager } from '@usenella/core';

const keyManager = new KeyManager(supabaseClient);

// Create a key
const key = await keyManager.create({
  name: 'ci-pipeline',
  permissions: ['check', 'validate', 'run'],
  expiresAt: new Date('2026-12-31'),
});

// Revoke a key
await keyManager.revoke(key.id);
```

## Cloud Sync

Cloud sync persists your Nella data (workspaces, indexes, context) across machines and team members.

### How It Works

Nella uses a tiered sync architecture with automatic fallback:

| Tier | Backend | When Used |
|------|---------|-----------|
| **1** | Google Cloud (Cloud SQL + Storage) | Preferred, if configured |
| **2** | Supabase (PostgreSQL + pgvector) | Default cloud backend |
| **3** | Local (`.nella/` JSON files) | Always available, no account needed |

### Enable Cloud Sync

```typescript
import { SyncManager } from '@usenella/core';

const syncManager = new SyncManager({
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
  },
});

// Sync workspace data
await syncManager.syncWorkspace(workspaceId);

// Sync search index
await syncManager.syncIndex(workspaceId);
```

### Features

- **Delta syncing** — Only uploads/downloads changed chunks
- **End-to-end encryption** — AES-256-GCM for data at rest
- **Gzip compression** — Reduces bandwidth usage
- **Offline queue** — Queues operations when disconnected, syncs when reconnected
- **Conflict resolution** — Last-writer-wins (default), merge, manual, or server-wins strategies

## Playground

The Nella Playground provides a real-time web dashboard for monitoring agent sessions.

### Start the Playground

```bash
nella playground --port 4000
```

Then open `http://localhost:4000` in your browser.

### Features

The playground shows:
- **Chain of thought** — Live view of the agent's reasoning
- **Tool calls** — Every MCP tool call with inputs and outputs
- **Search results** — Code search queries and results from the indexed codebase
- **Cost tracking** — Token usage and estimated cost per session

### Programmatic Access

```typescript
import { PlaygroundServer } from '@usenella/core';

const server = new PlaygroundServer({
  port: 4000,
  workspace: myWorkspace,
  contextManager: contextManager,
});

await server.start();
```

The playground uses WebSocket for real-time updates. Multiple browser clients can connect simultaneously.

## Hosted MCP Server

For teams, Nella can run as a hosted MCP server accessible to all team members:

```bash
nella serve --port 3001
```

This provides:
- HTTP endpoint at `POST /mcp` for MCP tool calls
- WebSocket at `/ws` for streaming
- Health check at `GET /health`
- API key authentication (each team member gets their own key)
- Per-agent rate limiting

### Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `NELLA_PORT` | Server port | `3001` |
| `NELLA_SUPABASE_URL` | Supabase project URL | Required |
| `NELLA_SUPABASE_ANON_KEY` | Supabase anon key | Required |
| `NELLA_RATE_LIMIT_RPM` | Requests per minute per agent | `60` |
| `NELLA_RATE_LIMIT_RPH` | Requests per hour per agent | `1000` |

## Related Docs

- [Authentication Guide](../core/auth.md) — Detailed auth API reference
- [Cloud Sync Guide](../core/sync.md) — Sync configuration and adapters
- [Playground Guide](../core/playground.md) — Playground server API
- [Rate Limiting](../core/rate-limiting.md) — Rate limiting configuration
