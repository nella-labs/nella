# What Nella Does (and How It Helps People)

A reference for writing DMs, replies, and posts. Everything below is grounded in the real product — pull from any section without making things up.

---

## The 30-second pitch

Nella is **codebase intelligence for AI coding agents**. It sits between your agent (Claude, Cursor, Copilot, GPT) and your repo, giving the agent:

1. **Real search** over your code — semantic + lexical hybrid, AST-chunked.
2. **Persistent context** — assumptions, change ledgers, and session state that survive across turns and sessions.
3. **Trust signals** — auto-invalidating assumptions, dependency drift detection, and a heartbeat that keeps the trust chain intact.

It ships as a CLI + MCP server (`@getnella/mcp`) and a core library (`@usenella/core`).

---

## The problems Nella solves

These are the failure modes you can name in posts/DMs. Each one is a real, observable pain.

| # | Problem | What it looks like in the wild |
|---|---------|-------------------------------|
| 1 | **Hallucinated code** | Agent imports a function that doesn't exist, calls a method off a wrong type, references a file path that's never been in the repo. |
| 2 | **Lost context across turns** | You explained the architecture 6 messages ago. The agent forgot. Now it's contradicting decisions you already made. |
| 3 | **Self-contradiction** | Turn 3 says "use Zustand." Turn 7 ships Redux. No memory of the earlier choice. |
| 4 | **Stale assumptions** | Agent assumed `users.email` exists. Schema changed an hour ago. Nobody told the agent. It generates broken SQL. |
| 5 | **Dependency drift** | A teammate added a package. Your agent doesn't know. Or your agent removed one and forgot to tell anyone. |
| 6 | **No grounding** | "How does auth work in this repo?" — agent guesses from training data instead of reading your actual code. |
| 7 | **Prompt injection via repo content** | Malicious instructions hidden in code/comments hijack the agent. Nella flags suspicious content in search results. |
| 8 | **Re-onboarding every session** | New chat = blank slate. You re-explain everything. Nella's context persists in `.nella/` across sessions. |

---

## What Nella actually does (feature-by-feature, plain English)

### 1. Indexing (`nella_index`)
- AST-based chunking — splits code along function/class/module boundaries, not blind line ranges.
- Builds **two** indexes in one pass: a vector index (semantic) and a BM25 index (lexical).
- Stored locally in `.nella/`, persists across sessions.
- Re-runnable with `--force` after major changes.
- Can scope to specific paths.

**Why it matters:** the agent searches the *real* repo state, not its training data, not a single file you happened to paste.

### 2. Hybrid search (`nella_search`)
- Three modes: `hybrid` (default), `semantic`, `lexical`.
- Returns file paths, line ranges, matched content, **confidence scores**.
- Filterable by language and file pattern.
- **Flags suspicious content** — content that looks like a prompt injection attempt is marked with a warning so the agent (and you) can skip it.

**Why it matters:** "find the auth flow" works even when nobody calls it `auth`. "Find `getUserById`" works when you need exact symbols. Same tool, right mode for the question.

### 3. Session context (`nella_get_context`)
- One call returns: recent file changes (with timestamps), all recorded assumptions and their status, dependency snapshot status, session stats.
- Includes a **trust-chain challenge** value used by `nella_heartbeat` to verify continuity.

**Why it matters:** the agent can pick up exactly where it left off — what changed, what was assumed, what's outstanding — without you re-explaining.

### 4. Assumption tracking (`nella_add_assumption`)
- Categorize: `schema`, `interface`, `dependency`, `behavior`, `config`, `structure`, `other`.
- Attach related files (glob patterns supported).
- Set a confidence score (0.0–1.0).
- **Auto-invalidates** when related files change.

**Why it matters:** the agent's beliefs about your code become *checkable artifacts* instead of vibes that drift across turns.

### 5. Assumption verification (`nella_check_assumptions`)
- Returns valid vs invalidated assumptions, grouped by type.
- **Returns an error signal** when anything is invalidated — forces the agent to re-evaluate before proceeding.

**Why it matters:** catches contradictions *before* they ship as broken code.

### 6. Dependency drift (`nella_check_dependencies`)
- Snapshots `package.json` + lockfile on first call.
- On subsequent calls reports added / removed / updated packages.
- Returns an error signal when drift is detected.

**Why it matters:** "it worked on my machine" gets caught at the agent layer. Teammates' installs, agent-side installs, version bumps — all visible.

### 7. Trust-chain heartbeat (`nella_heartbeat`)
- Takes a `challenge_response` from the previous context call.
- Confirms the agent is in a continuous, uncompromised session.

**Why it matters:** integrity check that's invisible to the user but blocks attempts to swap context out from under the agent.

---

## How Nella helps, by audience

Pull the framing that matches who you're DMing.

### For solo developers using Claude Code / Cursor / Copilot
- Stops your agent from inventing imports.
- Keeps the agent honest across long sessions — no more "wait, you said the opposite earlier."
- Indexes your repo once, searches it instantly forever.
- Persistent `.nella/` context = picking up a Claude Code session next morning means it actually remembers what you were doing.

### For teams shipping with AI agents
- Shared constraints in `tasks/` files — every teammate's agent reads the same rules.
- Multi-workspace config — frontend repo, backend repo, infra repo, all routed correctly.
- Dependency drift catches the "Bob added a package" problem at the agent layer.
- Hosted MCP at `https://mcp.getnella.dev/mcp` for shared state and telemetry across the team.

### For engineering leaders / staff engineers
- Traceability: structured logs of what changed, why, and which decisions are linked.
- Constraint authoring (`forbidden_patterns`, `files_not_to_modify`) gives you guardrails the agent can't talk its way past.
- Defense-in-depth: layer file protection + code-quality patterns + security patterns.
- Suspicious-content flagging in search results adds a prompt-injection backstop.

### For the AI-tooling crowd / agent builders
- **Agent-agnostic.** Works with any agent that speaks MCP. Claude, Cursor, Copilot, custom SDK agents.
- Two surfaces: MCP for product use, `@usenella/core` library for embedding directly in your own agent harness.
- Cloud sync option (push/pull run artifacts to GCS).
- API key management + per-agent rate limiting built in.

---

## Stealable one-liners (drop into posts/replies)

- *"Your AI coding agent doesn't have a memory problem. It has a grounding problem."*
- *"Nella is the layer that turns 'the LLM hallucinated again' into 'the LLM searched the actual repo.'"*
- *"Hybrid search — semantic for concepts, lexical for symbols. Same tool, right answer."*
- *"AST-based chunking. Your agent stops getting handed half a function."*
- *"Assumptions that auto-invalidate when the file they depend on changes. The agent finds out *before* shipping the bug."*
- *"`.nella/` persists across sessions. Your next chat doesn't start from zero."*
- *"Agent-agnostic. Bring your own agent — Claude, Cursor, Copilot, custom SDK."*
- *"MCP server + CLI + core library. Use whichever surface fits your stack."*
- *"Dependency drift detection means 'works on my machine' gets caught at the agent layer."*
- *"Suspicious content in search results gets flagged. Prompt injection via repo content has a backstop."*

---

## Comparison framings (for replies to "isn't this just X?")

| "Isn't this just…" | Sharper response |
|---|---|
| **…RAG over my code?** | RAG is one piece. Nella is RAG + persistent assumptions + dependency drift + trust chain. The retrieval is table stakes. |
| **…what Cursor/Copilot already do?** | Those agents do retrieval per-turn and forget. Nella adds a persistence layer they can call into via MCP. Works *with* them, not against. |
| **…Claude's project memory?** | Project memory is unstructured prose. Nella stores typed, file-linked, auto-invalidating assumptions. Different primitive. |
| **…just a vector DB?** | Vector + BM25 + AST chunking + assumption ledger + dep drift + heartbeat. The DB is one of seven moving parts. |
| **…overkill for solo work?** | The always-on `Claude.md` snippet is 6 lines. After that it's invisible. The cost is approximately zero. |

---

## DM / reply hooks (ready to paste, lightly edit)

### Cold DM opener (developer who posted about agent failure)
> Saw your post about [agent] inventing imports. That's the exact problem we built Nella for — it gives the agent a real index of your repo + an assumption ledger that auto-invalidates when files change. Happy to send a 2-line setup if useful.

### Reply to "my agent contradicts itself"
> This is the lost-context failure mode. Nella tracks assumptions as typed, file-linked records so the agent can't quietly walk back a decision it made 5 turns ago. `nella_add_assumption` + `nella_check_assumptions` is the pair that catches it.

### Reply to "RAG isn't enough"
> Agreed — retrieval alone doesn't solve agent drift. The pieces that actually move the needle for us are: (1) AST chunking so the agent gets coherent units, (2) persistent assumption tracking with auto-invalidation, (3) dependency drift signals. Nella bundles all three.

### Reply to a "what's your stack" thread
> Claude Code + Nella MCP. Nella indexes the repo, persists assumptions across sessions, and flags when deps drift. Removes most of the "wait, you forgot what we decided" friction.

### Reply to "how do you trust agent output?"
> Three signals: (1) every referenced symbol came from a real `nella_search` result, not training data, (2) assumptions are recorded and auto-invalidated when underlying files change, (3) `nella_check_dependencies` catches package drift. Trust chain via `nella_heartbeat` ties the session together.

### Post hook — problem-led
> The reason your AI agent keeps inventing imports isn't model size. It's grounding. The agent is guessing because it never read your repo. Fix the grounding, the hallucinations stop. (That's literally what Nella does.)

### Post hook — feature-led
> Three Nella features that punch above their weight:
> 1. AST-based chunking → agent gets whole functions, not slices.
> 2. Auto-invalidating assumptions → "the users table has email" gets revoked when schema.ts changes.
> 3. Dependency drift detection → catches teammate installs the agent never saw.

### Post hook — contrarian
> "Just give the LLM more context window" is the wrong answer. More tokens ≠ better grounding. What you want is *structured*, *checkable*, *invalidatable* context. That's what an assumption ledger gives you. Bigger context just means hallucinating more confidently.

---

## Setup snippet (for "how do I try it?" replies)

```bash
npm install -g @getnella/mcp
nella connect --client claude   # or cursor, vscode
nella auth login
nella index --force
```

Then drop this into `Claude.md` (or `.cursorrules`):

> Before changes: `nella_search` + `nella_get_context`. Document beliefs with `nella_add_assumption`. After changes: `nella_check_assumptions` + `nella_check_dependencies`.

That's it. The agent now uses Nella on every task, automatically.

---

## Source-of-truth links

- Repo: https://github.com/nella-labs/nella
- Hosted MCP: `https://mcp.getnella.dev/mcp`
- npm: `@getnella/mcp`, `@usenella/core`
- Docs: [how-to-use](./how-to-use.md), [tools/overview](./tools/overview.md), [context-tracking](./core-concepts/context-tracking.md), [tips & best practices](./guides/tips-and-best-practices.md)
