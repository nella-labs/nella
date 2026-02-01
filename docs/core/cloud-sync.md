# Cloud Sync (Google Cloud Storage)

Cloud sync keeps Nella workspace artifacts in Google Cloud Storage (GCS). It can push/pull indexes, context, and registry data with optional encryption.

## Key Exports

- `createCloudSyncManager` — create a sync manager
- `DEFAULT_SYNC_CONFIG` — baseline include/exclude patterns and sync defaults

## Quick Start

```ts
import { createCloudSyncManager, DEFAULT_SYNC_CONFIG } from '@usenella/core';

const sync = createCloudSyncManager('repo-1', '/path/to/repo', {
  projectId: 'my-gcp-project',
  bucketName: 'nella-artifacts',
  encryptionKey: process.env.NELLA_SYNC_KEY,
  ...DEFAULT_SYNC_CONFIG,
});

await sync.push();
```

## Pull Updates

```ts
await sync.pull();
```

## Notes

- If `keyFilePath` is not provided, the GCS client uses Application Default Credentials.
- Set `autoSyncInterval` in seconds to enable periodic sync.

## Related Docs

- [Core Modules guide](./modules.md)
