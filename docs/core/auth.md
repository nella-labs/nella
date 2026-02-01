# Auth & Rate Limiting

Nella Core includes API key management and rate limiting utilities to secure multi-agent systems.

## Key Exports

- `createKeyManager` / `KeyManager` — issue and rotate API keys
- `createAgentManager` / `AgentManager` — manage agents and their metadata
- `createAuthenticator` / `Authenticator` — validate API keys + permissions
- `createRateLimiter` / `RateLimiter` — enforce per-agent limits

## Issue API Keys

```ts
import { createKeyManager } from '@usenella/core';

const keyManager = createKeyManager('/path/to/.nella/auth');
const { key, rawKey } = keyManager.create({
  name: 'ci-agent',
  permissions: ['read', 'write', 'execute'],
});

console.log(key.id, rawKey);
```

## Authenticate Requests

```ts
import { createAuthenticator } from '@usenella/core';

const authenticator = createAuthenticator('/path/to/.nella/auth');
const auth = authenticator.authenticate({ apiKey: rawKey, action: 'execute' });

if (!auth.success) {
  throw new Error(auth.error);
}
```

## Rate Limit Agents

```ts
import { createRateLimiter } from '@usenella/core';

const limiter = createRateLimiter({
  requestsPerMinute: 120,
  requestsPerHour: 2000,
  requestsPerDay: 10000,
  maxTokensPerRequest: 8000,
});

const result = limiter.consume({ entityId: 'ci-agent', entityType: 'agent' });
if (!result.allowed) {
  console.log('Rate limited:', result.reason, result.retryAfter);
}
```

## Notes

- Auth stores data under the path you provide (e.g., `keys.json`, `agents.json`).
- `rawKey` is only returned on creation; store it securely.

## Related Docs

- [Core Modules guide](./modules.md)
