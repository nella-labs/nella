# Agent Setup

Add Nella instructions to your project so your agent uses it on every task — no manual prompting needed.

## Always-On Nella

Most AI coding agents read project instruction files at the start of each conversation. Add Nella usage patterns to these files and your agent will search, track assumptions, and verify context automatically.

## Claude Desktop & Claude Code

Add to your `CLAUDE.md` or project-level `Claude.md`:

```markdown
## Nella

Before making changes, search the codebase with `nella_search` to understand existing patterns.
Record assumptions with `nella_add_assumption` before implementing.
After changes, verify with `nella_check_assumptions` and `nella_check_dependencies`.
```

## Cursor

Add to `.cursorrules` in your project root:

```markdown
## Nella

Always search the codebase with nella_search before generating code.
Record assumptions about the codebase with nella_add_assumption.
After making changes, run nella_check_assumptions to verify nothing broke.
```

## VS Code / GitHub Copilot

Add to `.github/copilot-instructions.md`:

```markdown
## Nella

Use nella_search to find existing implementations before writing new code.
Track assumptions with nella_add_assumption for later verification.
Run nella_check_dependencies after modifying package.json.
```

## Windsurf

Add to `.windsurfrules`:

```markdown
## Nella

Search before coding: use nella_search to find relevant existing code.
Track what you assume: use nella_add_assumption to record beliefs.
Verify after changes: use nella_check_assumptions to catch contradictions.
```

## Prompting Tips

**Good patterns:**

- "Search for the existing implementation before writing new code"
- "Record your assumption about the database schema"
- "Check assumptions after modifying the auth module"
- "Verify dependencies haven't changed"

**Patterns to avoid:**

- "Always use all Nella tools" — too vague, leads to unnecessary calls
- "Search for everything" — too broad, produces noise
- "Index before every search" — unnecessary, the index persists

> **Tip:** Start simple. A few lines in your project instructions is enough. You can refine based on how your agent behaves.
