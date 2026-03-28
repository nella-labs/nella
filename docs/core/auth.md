# Authentication

> **Internal Module** — This documentation covers internal nella infrastructure. These modules are not exported from the public `@usenella/core` package and are intended for nella platform developers only.

Nella Core provides a full authentication and authorization system for securing MCP servers and managing agent access. It includes API key management, agent identity, JWT tokens, audit logging, IP filtering, and request signing.

## Key Exports

- `createKeyManager` / `KeyManager` — create, revoke, rotate, and validate API keys
- `createAgentManager` / `AgentManager` — register and authenticate agents
- `createAuthenticator` / `Authenticator` — high-level auth entry point
- `createTokenManager` / `TokenManager` — issue and verify JWT tokens
- `createAuditLog` / `AuditLogManager` — immutable audit trail
- `createIPFilterMiddleware` / `IPFilter` — IP-based allow/deny lists
- `createSigningMiddleware` / `RequestSigner` — HMAC request signing

## API Key Management

```ts
import { createKeyManager } from '@usenella/core/auth';

const keys = createKeyManager('/path/to/.nella/keys');

// Create a new API key
const key = keys.create({
  name: 'claude-desktop',
  permissions: ['read', 'write', 'validate'],
  rateLimit: { requestsPerMinute: 60 },
  expiresAt: new Date('2026-12-31'),
});

console.log(key.key); // nella_abc123... (only shown once)

// Validate an incoming key
const validated = keys.validate('nella_abc123...');
if (validated) {
  console.log(validated.name, validated.permissions);
}

// Rotate a key (old key stays valid for grace period)
const rotated = keys.rotate(key.id, { gracePeriodMs: 86400000 });

// Revoke a key immediately
keys.revoke(key.id);

// List all active keys
const activeKeys = keys.list({ status: 'active' });
```

## Agent Management

```ts
import { createAgentManager } from '@usenella/core/auth';

const agents = createAgentManager('/path/to/.nella/agents');

// Register an agent
const agent = agents.register({
  name: 'backend-claude',
  type: 'claude',        // 'claude' | 'cursor' | 'copilot' | 'custom'
  capabilities: ['code-edit', 'file-read'],
  metadata: { team: 'backend' },
});

// Authenticate by API key → agent identity
const authenticated = agents.authenticate('nella_abc123...');
console.log(authenticated.agent.name, authenticated.agent.type);

// List connected agents
const connected = agents.listConnected();
```

## JWT Tokens

```ts
import { createTokenManager } from '@usenella/core/auth';

const tokens = createTokenManager({
  secret: process.env.JWT_SECRET!,
  issuer: 'nella-server',
  expiresIn: '24h',
});

// Issue a token for an authenticated agent
const token = tokens.issue({
  agentId: agent.id,
  permissions: ['read', 'write'],
});

// Verify and decode a token
const payload = tokens.verify(token);
console.log(payload.agentId, payload.permissions);
```

## Audit Logging

```ts
import { createAuditLog } from '@usenella/core/auth';

const audit = createAuditLog({ storagePath: '/path/to/.nella/audit' });

// Log an action
audit.log({
  action: 'key.created',
  actorId: 'admin',
  resourceId: key.id,
  metadata: { keyName: 'claude-desktop' },
});

// Query audit trail
const entries = audit.query({
  action: 'key.*',
  since: new Date('2026-01-01'),
  limit: 50,
});
```

## IP Filtering & Request Signing

```ts
import { IPFilter, RequestSigner } from '@usenella/core/auth';

// IP allow/deny lists
const ipFilter = new IPFilter({
  allowList: ['10.0.0.0/8', '192.168.1.0/24'],
  denyList: ['192.168.1.100'],
});

const allowed = ipFilter.check('10.0.1.50'); // true

// HMAC request signing
const signer = new RequestSigner({ secret: 'shared-secret' });
const signature = signer.sign({ method: 'POST', path: '/mcp', body: '...' });
const valid = signer.verify({ method: 'POST', path: '/mcp', body: '...' }, signature);
```

## Authenticator (High-Level)

The `Authenticator` class ties together key validation, agent lookup, and token management into a single entry point used by the hosted MCP server:

```ts
import { createAuthenticator } from '@usenella/core/auth';

const auth = createAuthenticator({
  keysPath: '/path/to/.nella/keys',
  agentsPath: '/path/to/.nella/agents',
  jwtSecret: process.env.JWT_SECRET!,
});

// Authenticate a request
const result = auth.authenticate(request);
if (result.authenticated) {
  console.log(result.agent.name, result.permissions);
}
```

## Types

```ts
type ApiKeyPermission = 'read' | 'write' | 'validate' | 'admin';
type AgentType = 'claude' | 'cursor' | 'copilot' | 'custom';

interface ApiKey {
  id: string;
  key: string;              // nella_... prefix
  name: string;
  permissions: ApiKeyPermission[];
  rateLimit?: { requestsPerMinute: number };
  expiresAt?: Date;
  createdAt: Date;
  lastUsedAt?: Date;
  status: 'active' | 'revoked' | 'expired';
}

interface AgentConfig {
  id: string;
  name: string;
  type: AgentType;
  capabilities: string[];
  metadata?: Record<string, unknown>;
}

interface AuditEntry {
  id: string;
  timestamp: Date;
  action: string;
  actorId: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}
```

## Related Docs

- [Core API Reference](api-reference.md) — Full API surface
- [Core Configuration](configuration.md) — Configuration options
- [MCP Integration](../mcp/integration.md) — Server setup with auth
