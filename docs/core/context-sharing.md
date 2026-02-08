# Context Sharing

Context sharing lets multiple agents store and retrieve shared knowledge (decisions, snippets, dependencies) with visibility controls, channels, and conflict detection.

> **Note:** This is different from the single-session `ContextManager` — `SharedContextManager` enables **cross-agent** context persistence.

## Key Exports

- `createSharedContextManager` / `SharedContextManager` — store and query shared context
- `DEFAULT_CONTEXT_TTL` — default TTL in seconds
- `ContextType` — enum of 10 context types
- `ContextVisibility` — `'public' | 'team' | 'private'`

## Create & Store Context

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
  channel: 'backend-team',
});
```

## Read & Query Context

```ts
// Get a specific entry
const entry = manager.get('auth-migration-plan', 'repo-1', 'viewer-agent');

// Query by type and visibility
const results = manager.query('repo-1', {
  types: ['decision', 'architecture'],
  visibility: 'team',
  channel: 'backend-team',
  limit: 10,
});

// Query entries since a timestamp
const recent = manager.query('repo-1', {
  since: new Date('2026-02-01'),
  limit: 20,
});
```

## Channels

Channels partition context into logical groups. Agents subscribe to channels to receive relevant updates:

```ts
// Store context on a specific channel
manager.set({
  key: 'db-schema-change',
  value: 'Added deletedAt column to users table',
  sourceAgentId: 'migration-agent',
  workspaceId: 'repo-1',
  type: 'progress',
  channel: 'database-team',
  visibility: 'team',
});

// Query only a specific channel
const dbChanges = manager.query('repo-1', {
  channel: 'database-team',
  types: ['progress'],
});
```

## Context Types

The `ContextType` enum defines 10 categories:

| Type | Description |
|------|-------------|
| `decision` | Architectural or implementation decision |
| `assumption` | Recorded belief about the codebase |
| `constraint` | Hard rule or limitation |
| `dependency` | Package or service dependency |
| `architecture` | Structural design decision |
| `risk` | Identified risk or concern |
| `progress` | Work-in-progress update |
| `blocker` | Blocking issue |
| `insight` | Observation or discovery |
| `todo` | Pending task |

## Visibility

| Level | Description |
|-------|-------------|
| `public` | Visible to all agents on all channels |
| `team` | Visible to agents on the same channel |
| `private` | Visible only to the author agent |

## Versioning & Conflict Detection

Context entries are versioned. Updating an existing key increments the version:

```ts
// First write — version 1
manager.set({ key: 'api-design', value: 'REST with JSON', ... });

// Update — version 2
manager.set({ key: 'api-design', value: 'REST with JSON + GraphQL gateway', ... });

// Get with version history
const entry = manager.get('api-design', 'repo-1', 'agent-1');
console.log(entry.version); // 2
```

When two agents update the same key concurrently, the manager detects the conflict and applies the configured strategy (`last-write-wins` by default, or `merge`).

## Transports

Context can be shared via different transports:

| Transport | Use Case |
|-----------|----------|
| `file` (default) | Local file-based storage in `.nella/shared-context/` |
| `redis` | Distributed context via Redis pub/sub |
| `supabase` | Cloud-synced context via Supabase Realtime |

```ts
const manager = createSharedContextManager('/path/to/.nella/shared-context', {
  transport: 'redis',
  redisUrl: 'redis://localhost:6379',
});
```

## Notes

- The storage path is a directory; the manager writes `context.json` inside it.
- `workspaceId` and `sourceAgentId` are required for entries.
- Entries expire after `DEFAULT_CONTEXT_TTL` unless a custom TTL is set.
- Cross-agent visibility is enforced — private entries are never returned to other agents.

## Related Docs

- [Context Management](context.md) — Single-session context tracking
- [Core Modules Guide](modules.md) — All modules overview
- [Core API Reference](api-reference.md) — Full API surface
