# Sync

The Sync module synchronizes Nella state (runs, context, workspace config) between local storage and cloud backends. It supports tiered sync, delta compression, encryption at rest, and conflict resolution.

> **Warning:** The Sync module is under active development. Some features (notably compression and encryption) are experimental and may change in future releases.

## Key Exports

- `createSyncManager` / `SyncManager` — orchestrate sync operations
- `SyncAdapter` — interface for sync backends
- Built-in adapters: `SupabaseSyncAdapter`, `GCPSyncAdapter`, `FileSyncAdapter`
- `WorkspaceCloudSyncManager` — per-workspace cloud sync with delta tracking

## Quick Start

```ts
import { createSyncManager, SupabaseSyncAdapter } from '@usenella/core';

const sync = createSyncManager({
  adapter: new SupabaseSyncAdapter({
    url: process.env.SUPABASE_URL!,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  }),
  tier: 'full',
});

// Push local state to cloud
await sync.push();

// Pull cloud state to local
await sync.pull();

// Two-way sync with conflict resolution
await sync.sync({ strategy: 'last-write-wins' });
```

## Sync Tiers

| Tier | Syncs | Use Case |
|------|-------|----------|
| `metadata` | Workspace registry, settings | Lightweight sync |
| `context` | + Context entries, assumptions | Team collaboration |
| `full` | + Run records, metrics, indices | Full backup/restore |

```ts
const sync = createSyncManager({
  adapter: new SupabaseSyncAdapter({ ... }),
  tier: 'context',  // Only sync metadata + context
});
```

## Sync Adapters

### Supabase Adapter

```ts
import { SupabaseSyncAdapter } from '@usenella/core';

const adapter = new SupabaseSyncAdapter({
  url: process.env.SUPABASE_URL!,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  bucket: 'nella-sync',  // Storage bucket name
});
```

### GCP Adapter

```ts
import { GCPSyncAdapter } from '@usenella/core';

const adapter = new GCPSyncAdapter({
  projectId: 'my-project',
  bucket: 'nella-sync-bucket',
  keyFilePath: '/path/to/service-account.json',
});
```

### File Adapter (Local)

```ts
import { FileSyncAdapter } from '@usenella/core';

const adapter = new FileSyncAdapter({
  syncDir: '/shared/nella-sync',  // Shared network drive or local path
});
```

## Cloud Sync Features

The `WorkspaceCloudSyncManager` provides advanced sync features per workspace:

| Feature | Description |
|---------|-------------|
| Delta sync | Only sync changed data since last sync |
| Encryption | AES-256-GCM encryption at rest |
| Compression | gzip compression for large payloads |
| Conflict resolution | `last-write-wins`, `merge`, or `manual` strategies |
| Offline queue | Queue changes while offline, sync when back |

```ts
import { WorkspaceCloudSyncManager } from '@usenella/core';

const cloudSync = new WorkspaceCloudSyncManager({
  workspaceId: 'repo-1',
  adapter: new SupabaseSyncAdapter({ ... }),
  encryption: { enabled: true, key: process.env.SYNC_ENCRYPTION_KEY! },
  compression: { enabled: true },
  conflictStrategy: 'merge',
});

// Sync with delta tracking
await cloudSync.sync();

// Check sync status
const status = cloudSync.getStatus();
console.log(status.lastSynced, status.pendingChanges, status.conflicts);
```

## Conflict Resolution

```ts
// Last-write-wins (default)
await sync.sync({ strategy: 'last-write-wins' });

// Merge — combines non-conflicting changes
await sync.sync({ strategy: 'merge' });

// Manual — returns conflicts for user resolution
const result = await sync.sync({ strategy: 'manual' });
if (result.conflicts.length > 0) {
  for (const conflict of result.conflicts) {
    console.log(`Conflict on ${conflict.key}: local=${conflict.local} remote=${conflict.remote}`);
    sync.resolve(conflict.key, 'local');  // or 'remote'
  }
}
```

## Configuration

```ts
interface SyncConfig {
  adapter: SyncAdapter;
  tier: 'metadata' | 'context' | 'full';
  autoSync?: boolean;          // Auto-sync on changes (default: false)
  syncIntervalMs?: number;     // Interval for auto-sync
  conflictStrategy?: 'last-write-wins' | 'merge' | 'manual';
}

interface SyncState {
  lastSynced: Date | null;
  pendingChanges: number;
  conflicts: number;
  status: 'idle' | 'syncing' | 'error';
}
```

## Related Docs

- [Core Modules Guide](modules.md) — All modules overview
- [GCP Backend](../core/gcp.md) — GCP-specific configuration
- [Supabase Backend](../core/supabase.md) — Supabase-specific configuration
