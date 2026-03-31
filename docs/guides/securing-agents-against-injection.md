# Securing Agents Against Prompt Injection

Nella automatically defends your AI coding agent against prompt injection attacks that arrive through search results. No configuration is required — the defense is always active.

## What It Does

When you index your codebase and use `nella_search`, Nella applies multiple layers of defense behind the scenes:

- **Content scanning** — Detects injection patterns in indexed content and flags them before the agent sees the results.
- **Result isolation** — Each search result is wrapped in boundaries that prevent injected instructions from being interpreted as agent commands.
- **Trust verification** — Content is tagged with trust metadata based on its origin, so the agent can distinguish your code from external sources.
- **Risk scoring** — Every indexed chunk receives a risk score. High-scoring content is annotated with warnings visible to the agent.
- **Session integrity** — A per-session mechanism ensures that injected content cannot impersonate Nella or extract session secrets.

## What You Need to Do

Nothing. The defense system runs automatically every time the agent interacts with Nella. There are no flags to set, no configuration files to edit, and no thresholds to tune.

When a search result contains suspicious content, the agent will see clear warnings alongside the result. It can still use the legitimate parts of the content while disregarding injected instructions.

## Common Questions

**Does this affect search speed?**
No. Content scanning and risk scoring happen during indexing, not at query time. Search performance is unaffected.

**Can trusted workspace files contain injection attacks?**
Yes. A compromised dependency or malicious contributor could introduce injection payloads into workspace files. Nella scans all content regardless of origin.

**Will legitimate code trigger false positives?**
Occasionally. Code comments with imperative language, test descriptions, and CLI documentation may receive slightly elevated risk scores, but they rarely reach the warning threshold.

**Do I need to configure trust levels?**
No. Trust classification is automatic based on content origin.

## Further Reading

- [Introduction](../introduction.md) — Overview of Nella's features and capabilities
- [Tips & Best Practices](./tips-and-best-practices.md) — General best practices for using Nella with AI agents
