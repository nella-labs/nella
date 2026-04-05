# Security

Nella includes a built-in defense system that protects your AI agent automatically. No configuration required.

## Three Threats, Three Defenses

### Hallucinations

**The problem:** Your agent references APIs, imports, or packages that don't exist — leading to build failures and wasted debugging time.

**How Nella helps:** Your codebase is indexed for search, so the agent can look up real symbols, functions, and types before generating code. It references what actually exists instead of guessing.

### Prompt Injection

**The problem:** Malicious instructions hidden in code comments, documentation, or dependency files can hijack your agent's behavior.

**How Nella helps:** All content is automatically scanned during indexing. Search results are tagged with risk indicators, and suspicious content is flagged so the agent treats it as data — not as instructions.

### Context Loss

**The problem:** During long sessions, your agent forgets earlier decisions. It contradicts itself, breaks its own assumptions, and introduces inconsistencies.

**How Nella helps:** Session state, assumptions, and dependency snapshots persist across conversations. The agent can check what it decided earlier and verify those decisions still hold.

## What Happens Automatically

Every time Nella processes a search or returns context, the following runs behind the scenes:

- **Content scanning** — Indexed content is analyzed for suspicious patterns
- **Risk tagging** — Search results include safety metadata the agent can inspect
- **Session verification** — Continuity between tool calls is verified
- **Assumption invalidation** — Changed files automatically invalidate related assumptions

## What You Need to Do

Nothing. The defense system is always active. There's no configuration, no flags to set, and no performance penalty.

> **Note:** Nella's security works at the tool level — it protects the data your agent receives. It does not modify your source code or interfere with your agent's reasoning.

## FAQ

**Does Nella read my code?**

Yes, but only locally. Your source code is parsed and indexed on your machine. In local mode, nothing is sent to external servers.

**Can prompt injection bypass the defense?**

No defense is perfect, but Nella uses multiple independent detection methods. Even if one is bypassed, others continue to flag suspicious content. The agent always sees the safety metadata alongside search results.

**Does this slow down my agent?**

No. Scanning happens at index time, not at query time. Search performance is unaffected.
