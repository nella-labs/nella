# Context Sharing

Context sharing lets multiple agents store and retrieve shared knowledge (decisions, snippets, dependencies) with visibility controls.

## Key Exports

- `createSharedContextManager` / `ContextManager` — store and query shared context
- `DEFAULT_CONTEXT_TTL` — default TTL in seconds

## Create + Store Context

```ts
import { createSharedContextManager } from '@usenella/core';

const manager = createSharedContextManager('/path/to/.nella/shared-context');

manager.set({
  key: 'auth-migration-plan',
  value: 'Migrate JWT to OAuth by Q3',
  sourceAgentId: 'architect-agent',
  workspaceId: 'repo-1',
  type: 'decision',
  visibility: 'team',
  tags: ['auth', 'migration'],
});
```

## Read + Query Context

```ts
const entry = manager.get('auth-migration-plan', 'repo-1', 'viewer-agent');

const results = manager.query('repo-1', {
  types: ['decision'],
  visibility: 'team',
  limit: 10,
});
```

## Notes

- The storage path is a directory; the manager writes `context.json` inside it.
- `workspaceId` and `sourceAgentId` are required for entries.

## Related Docs

- [Core Modules guide](./modules.md)
