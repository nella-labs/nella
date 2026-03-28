# Documentation Sync

The scripts in this folder keep the public docs in `../nella-website` aligned with the source docs in this repo.

## Source and Target

Source docs live in `nella/docs/**`.

Public website docs live in:

- `../nella-website/apps/docs/src/content/docs/**`

The sync script transforms Markdown source files into MDX, adds website frontmatter, imports the shared Astro callout component, and rewrites links so they point at the website routes instead of repo-relative files.

## Commands

```bash
# Preview which files would change
pnpm sync-docs:dry

# Write the synced MDX files into ../nella-website
pnpm sync-docs

# Re-run sync when docs change locally
pnpm sync-docs:watch
```

## Current Mapped Pages

The sync currently covers the public docs routes that are meant to be sourced from `nella/docs`:

- `getting-started/*`
- `api-reference/overview`
- `mcp-tools/overview`
- `mcp-tools/context-tools`
- `mcp-tools/nella-index`
- `mcp-tools/nella-search`
- `mcp-tools/nella-get-context`
- `mcp-tools/nella-add-assumption`
- `mcp-tools/nella-check-assumptions`
- `mcp-tools/nella-check-dependencies`
- `mcp-tools/nella-heartbeat`
- `configuration/overview`
- `configuration/constraints`
- `configuration/validation`
- `configuration/task-authoring`
- `integrations/claude-desktop`
- `integrations/cursor`
- `integrations/vscode`
- `integrations/custom-client`
- `cli/commands`
- `features/prompt-injection-defense`
- `guides/tips-and-best-practices`
- `guides/securing-agents-against-injection`
- `troubleshooting`

Not every docs page in `nella-website` is synced from here. Some pages are still website-local and should be edited in the website repo directly.

## Workflow

1. Edit the source Markdown in `nella/docs/**`.
2. Run `pnpm sync-docs`.
3. Review the generated MDX changes in `../nella-website`.
4. Commit the source-doc changes in `nella`.
5. Commit the generated/public-doc updates in `nella-website`.

## Guardrails

- Do not hand-edit generated files in `../nella-website/apps/docs/src/content/docs/**` when the source page is mapped here.
- Keep private website documentation outside `apps/docs/src/content/docs/**`; anything under that content tree is public.
- If a public docs route changes, update both `scripts/sync-docs.ts` and any hard-coded website navigation or footer links in `../nella-website`.
