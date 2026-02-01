# Documentation Sync

This folder contains scripts for syncing documentation from `nella/docs` to the website at `nella-website/apps/docs`.

## How It Works

```
nella/docs/               nella-website/apps/docs/src/content/docs/
├── mcp/tools.md    ──►   ├── api-reference/tools-reference.mdx
├── core/api.md     ──►   ├── api-reference/core-api.mdx
├── cli/commands.md ──►   ├── cli/commands.mdx
└── ...                   └── ...
```

The sync script:
1. Reads markdown files from `nella/docs`
2. Transforms them to MDX format with proper frontmatter
3. Converts callouts to Astro components
4. Fixes relative links
5. Writes to the website docs folder

## Local Usage

```bash
# Preview what would be synced (no changes)
pnpm sync-docs:dry

# Sync docs now
pnpm sync-docs

# Watch for changes and sync automatically
pnpm sync-docs:watch
```

## Automatic Sync (GitHub Actions)

Documentation is automatically synced when changes are pushed to `docs/**` on the `main` branch.

### Setup Instructions

#### 1. Create a Personal Access Token (PAT)

1. Go to [GitHub Token Settings](https://github.com/settings/tokens)
2. Click **"Generate new token (classic)"**
3. Configure the token:
   - **Name:** `Docs Sync Token`
   - **Expiration:** 90 days (or your preference)
   - **Scopes:** Check `repo` (Full control of private repositories)
4. Click **"Generate token"**
5. **Copy the token** (you won't see it again!)

#### 2. Add the Secret to the Repository

1. Go to [nella repo secrets](https://github.com/nella-labs/nella/settings/secrets/actions)
2. Click **"New repository secret"**
3. Configure:
   - **Name:** `DOCS_SYNC_TOKEN`
   - **Value:** Paste the PAT you copied
4. Click **"Add secret"**

#### 3. Verify Permissions

The PAT owner must have **write access** to `nella-labs/nella-website` for the PR creation to work.

### How the Workflow Works

```
Push to docs/** on main
        │
        ▼
┌───────────────────┐
│  Checkout both    │
│  repositories     │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  Run sync script  │
│  (transform docs) │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  Create PR in     │
│  nella-website    │
└───────────────────┘
```

### Manual Trigger

You can manually trigger the workflow:

1. Go to [Actions tab](https://github.com/nella-labs/nella/actions)
2. Select **"Sync Documentation"** workflow
3. Click **"Run workflow"**
4. Optionally enable **"Dry run"** to preview without creating a PR

## Files Synced

| Source (`nella/docs`) | Target (`nella-website`) |
|----------------------|--------------------------|
| `mcp/tools.md` | `api-reference/tools-reference.mdx` |
| `mcp/context.md` | `guides/context-management.mdx` |
| `mcp/examples.md` | `examples/mcp-examples.mdx` |
| `mcp/integration.md` | `guides/mcp-integration.mdx` |
| `mcp/README.md` | `api-reference/mcp-overview.mdx` |
| `core/api-reference.md` | `api-reference/core-api.mdx` |
| `core/configuration.md` | `configuration/core-config.mdx` |
| `core/auth.md` | `guides/authentication.mdx` |
| `core/context-sharing.md` | `guides/context-sharing.mdx` |
| `core/indexing.md` | `guides/indexing.mdx` |
| `core/workspace.md` | `guides/workspace.mdx` |
| `core/types.md` | `api-reference/types.mdx` |
| `core/examples.md` | `examples/core-examples.mdx` |
| `cli/commands.md` | `cli/commands.mdx` |
| `cli/examples.md` | `cli/cli-examples.mdx` |
| `how-to-use.md` | `getting-started/usage-guide.mdx` |
| `spec.md` | `guides/specification.mdx` |

## Troubleshooting

### "Resource not accessible by integration"

The PAT doesn't have write access to `nella-website`. Ensure:
- The token has `repo` scope
- The token owner has write access to `nella-labs/nella-website`

### "Secret not found: DOCS_SYNC_TOKEN"

The secret hasn't been added. Follow step 2 in the setup instructions.

### Sync runs but no PR is created

Check if there were actual changes:
- The workflow only creates a PR if files differ
- Run `pnpm sync-docs:dry` locally to preview changes

### MDX syntax errors after sync

Some markdown patterns may not convert cleanly. Edit the sync script's transform functions in `scripts/sync-docs.ts`.
