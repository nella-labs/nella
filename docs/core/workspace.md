# Workspace Management

> **Internal Module** — This documentation covers internal nella infrastructure. These modules are not exported from the public `@usenella/core` package and are intended for nella platform developers only.

> **Note:** The main classes (`WorkspaceRegistry`, `WorkspaceSwitcher`, `Workspace`) and their factory functions **are** exported from `@usenella/core`. The utility classes (`FileLock`, `RegistryBackupManager`, `RegistryMigrationManager`, `WorkspaceValidator`, `FileWatcher`, `LRUCache`) are only available via `@usenella/core/workspace`.

Nella Core supports multi-workspace setups so agents can safely operate across multiple repos. The workspace module maintains a registry, switches active workspaces, provides file watching, backup/migration, validation, and concurrency control.

## Key Exports

- `createWorkspaceRegistry` / `WorkspaceRegistry` — store workspace entries on disk
- `createWorkspaceSwitcher` / `WorkspaceSwitcher` — switch between registered workspaces
- `Workspace` — active workspace instance with indexing, context, and metadata
- `FileLock` — file-level concurrency control
- `RegistryBackupManager` — backup and restore workspace registry

## Register Workspaces

```ts
import { createWorkspaceRegistry } from '@usenella/core';

const registry = createWorkspaceRegistry('/path/to/.nella');

// Register a workspace
const entry = registry.register('/repos/backend', 'Backend API');
console.log(entry.id, entry.path);

// Register with config
const entry2 = registry.register('/repos/frontend', 'Frontend App', {
  language: 'typescript',
  framework: 'react',
  indexOnRegister: true,
});
```

## Switch Active Workspace

```ts
import { createWorkspaceRegistry, createWorkspaceSwitcher } from '@usenella/core';

const registry = createWorkspaceRegistry('/path/to/.nella');
registry.register('/repos/backend', 'Backend API');
registry.register('/repos/frontend', 'Frontend App');

const switcher = createWorkspaceSwitcher({ registry });

// Switch by ID
const workspace = await switcher.switchTo(entry.id);
console.log(workspace.id, workspace.path);

// Switch by path (register + switch in one call)
const workspace2 = await switcher.switchToPath('/repos/new-project', 'New Project');
```

## Registry Methods

```ts
// List all registered workspaces
const workspaces = registry.list();

// Get by ID
const ws = registry.get(entry.id);

// Set active workspace
registry.setActive(entry.id);

// Get currently active workspace
const active = registry.getActive();

// Unregister a workspace
registry.unregister(entry.id);
```

## File Watching

Workspaces can watch for file changes and trigger re-indexing automatically:

```ts
const workspace = await switcher.switchTo(entry.id);

// Start watching for changes
workspace.watch({
  patterns: ['src/**/*.ts'],
  ignore: ['**/*.test.ts'],
  debounceMs: 500,
  onChanged: async (files) => {
    console.log('Files changed:', files);
    await workspace.reindex({ paths: files });
  },
});

// Stop watching
workspace.unwatch();
```

## Backup & Migration

```ts
import { RegistryBackupManager } from '@usenella/core/workspace';

const backup = new RegistryBackupManager(registry);

// Create a backup
const snapshot = backup.create('before-migration');

// List backups
const backups = backup.list();

// Restore from backup
backup.restore(snapshot.id);
```

## Validation

Validate that a workspace is properly configured:

```ts
const validation = workspace.validate();

if (!validation.valid) {
  for (const issue of validation.issues) {
    console.log(`${issue.severity}: ${issue.message}`);
  }
}
// Checks: package.json exists, node_modules installed, 
// .nella dir writable, index up-to-date
```

## Concurrency Control

Use `FileLock` to prevent concurrent modifications:

```ts
import { FileLock } from '@usenella/core/workspace';

const lock = new FileLock('/repos/backend/src/users.ts');

await lock.acquire();
try {
  // Safely modify the file
  fs.writeFileSync('/repos/backend/src/users.ts', newContent);
} finally {
  lock.release();
}
```

## Workspace Config

```ts
interface WorkspaceConfig {
  id: string;
  path: string;
  name: string;
  language?: string;
  framework?: string;
  indexOnRegister?: boolean;
  watchEnabled?: boolean;
  watchPatterns?: string[];
  metadata?: Record<string, unknown>;
}

interface WorkspaceState {
  id: string;
  status: 'active' | 'inactive' | 'indexing' | 'error';
  lastIndexed?: Date;
  fileCount: number;
  indexedFileCount: number;
}
```

## Notes

- The registry persists to `workspaces.json` under the storage path you provide.
- `switcher.switchToPath()` can register + switch in one call for new repos.
- File watching uses `fs.watch` with debouncing to avoid excessive re-indexing.
- `FileLock` uses OS-level advisory locks where available.

## Related Docs

- [Core Modules Guide](modules.md) — All modules overview
- [Core API Reference](api-reference.md) — Full API surface
- [Indexing & Search](indexing.md) — Per-workspace indexing
