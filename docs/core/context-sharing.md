# Context Sharing

> **Internal Module** — This documentation covers internal nella infrastructure. These modules are not exported from the public `@usenella/core` package and are intended for nella platform developers only.

Context sharing lets multiple agents store and retrieve shared knowledge (decisions, snippets, dependencies) with visibility controls, channels, and conflict detection.

> **Note:** This is different from the single-session `ContextManager` in the context module — the context-sharing `ContextManager` enables **cross-agent** context persistence.

## Key Exports

- `createContextManager` / `ContextManager` — store and query shared context
- `DEFAULT_CONTEXT_TTL` — default TTL in seconds
- `ContextType` — type union of context value types
- `ContextVisibility` — `'private' | 'workspace' | 'shared'`

## Create & Store Context

```ts
import { createContextManager } from '@usenella/core/context-sharing';

const manager = createContextManager({ storagePath: '/path/to/.nella/shared-context' });

manager.set({
  key: 'auth-migration-plan',
  value: 'Migrate JWT to OAuth by Q3',
  sourceAgentId: 'architect-agent',
  workspaceId: 'repo-1',
  type: 'decision',
  visibility: 'workspace',
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
  visibility: 'workspace',
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
  visibility: 'workspace',
});

// Query only a specific channel
const dbChanges = manager.query('repo-1', {
  channel: 'database-team',
  types: ['progress'],
});
```

## Context Types

`ContextType` is a union of value type hints:

| Type | Description |
|------|-------------|
| `string` | Plain text value |
| `number` | Numeric value |
| `boolean` | Boolean value |
| `object` | Structured object |
| `array` | Array value |
| `code` | Code block |
| `snippet` | Code snippet |
| `decision` | Architectural or implementation decision |
| `dependency` | Package or service dependency |
| `preference` | Agent or user preference |

## Visibility

| Level | Description |
|-------|-------------|
| `private` | Visible only to the source agent |
| `workspace` | Visible to all agents in the workspace |
| `shared` | Accessible across workspaces |

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
| `LocalTransport` (default) | Local file-based storage in `.nella/shared-context/` |
| `SupabaseTransport` | Cloud-synced context via Supabase Realtime |

```ts
import { createContextManager, SupabaseTransport } from '@usenella/core/context-sharing';

const manager = createContextManager({
  storagePath: '/path/to/.nella/shared-context',
  transport: new SupabaseTransport({ url: '...', key: '...' }),
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
