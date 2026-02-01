# Workspace Management

Nella Core supports multi-workspace setups so agents can safely operate across multiple repos. The workspace module maintains a registry, switches active workspaces, and exposes per-workspace configuration.

## Key Exports

- `createWorkspaceRegistry` / `WorkspaceRegistry` — store workspace entries on disk
- `createWorkspaceSwitcher` / `WorkspaceSwitcher` — switch between registered workspaces
- `Workspace` — active workspace instance with indexing, context, and metadata

## Register Workspaces

```ts
import { createWorkspaceRegistry } from '@usenella/core';

const registry = createWorkspaceRegistry('/path/to/.nella');
const entry = registry.register('/repos/backend', 'Backend API');

console.log(entry.id, entry.path);
```

## Switch Active Workspace

```ts
import { createWorkspaceRegistry, createWorkspaceSwitcher } from '@usenella/core';

const registry = createWorkspaceRegistry('/path/to/.nella');
const entry = registry.register('/repos/backend', 'Backend API');

const switcher = createWorkspaceSwitcher({ registry });
const workspace = await switcher.switchTo(entry.id);

console.log(workspace.id, workspace.path);
```

## Helpful Registry Methods

```ts
registry.list();
registry.get(entry.id);
registry.setActive(entry.id);
registry.getActive();
```

## Notes

- The registry persists to `workspaces.json` under the storage path you provide.
- `switcher.switchToPath()` can register + switch in one call for new repos.

## Related Docs

- [Core Modules guide](./modules.md)
- [MCP tools](./mcp-tools.md)
