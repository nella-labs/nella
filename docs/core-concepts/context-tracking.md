# Context Tracking

How Nella tracks assumptions, dependencies, and session context across conversations.

## Session Context

Every coding session has state: what files changed, what assumptions were made, what dependencies look like. Nella tracks all of this automatically.

Call `nella_get_context` to see the current session state, including:

- Recent file changes with timestamps
- All recorded assumptions and their status
- Dependency snapshot status
- Session statistics

Context persists in `.nella/` across conversations, so your agent picks up where it left off.

## Tracking Assumptions

When your agent makes a decision based on how it believes the code works, it should record that belief:

```
Agent records: "The Users table has an email column"
  → type: schema
  → relatedFiles: ["src/models/user.ts", "src/db/schema.ts"]
  → confidence: 0.9
```

If `user.ts` or `schema.ts` changes later, that assumption is automatically invalidated. The next time the agent checks, it knows to re-verify before proceeding.

**Assumption types:**

| Type | When to use |
|------|------------|
| `schema` | Database tables, columns, relationships |
| `interface` | API contracts, function signatures, type shapes |
| `dependency` | Package availability, version requirements |
| `behavior` | How a function or system behaves at runtime |
| `config` | Configuration values, environment variables |
| `structure` | File organization, directory layout |

## Verifying Assumptions

Call `nella_check_assumptions` to verify all recorded assumptions. It returns:

- **Valid assumptions** — Related files haven't changed
- **Invalidated assumptions** — Related files were modified, assumption needs re-evaluation
- **Summary counts** by type

When assumptions are invalidated, Nella signals an error to the agent, prompting it to investigate before making further changes.

## Dependency Monitoring

Call `nella_check_dependencies` to detect package changes:

- On first call, Nella snapshots your `package.json` and lockfile
- On subsequent calls, it compares the current state against the snapshot
- Reports any added, removed, or updated packages

This catches situations where a teammate added a package, or where the agent's own changes affected dependencies.

## Typical Workflow

```
1. nella_get_context      → Review session state
2. nella_search            → Find relevant code
3. nella_add_assumption    → Record beliefs about the code
4. Make changes
5. nella_check_assumptions → Verify nothing contradicts
6. nella_check_dependencies → Check for package drift
```

> **Tip:** The more assumptions your agent records, the earlier it catches contradictions. Encourage liberal use of `nella_add_assumption` in your project instructions.
