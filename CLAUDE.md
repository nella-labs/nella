## Workflow Orchestration

### 1. Plan Node Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

### 7. Test-First Bug Fixes
- When a bug is reported, don't start by trying to fix it
- Instead, start by writing a test that reproduces the bug
- Then, have subagents try to fix the bug and prove it with a passing test

---

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items  
2. **Verify Plan**: Check in before starting implementation  
3. **Track Progress**: Mark items complete as you go  
4. **Explain Changes**: High-level summary at each step  
5. **Document Results**: Add review section to `tasks/todo.md`  
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections  

---

## Nella MCP Tools — Use First

This project has Nella MCP tools available. **Use them before manual search.**

- **nella_search** — Use BEFORE grep/glob for any open-ended code search. Faster and semantically aware.
- **nella_get_context** — Check session state at the start of non-trivial tasks.
- **nella_add_assumption** — Record assumptions about code structure before making changes.
- **nella_check_assumptions** — Verify assumptions still hold after changes.
- **nella_check_dependencies** — Check for dependency drift at session start.

**Rule:** When searching for how something works, where something is defined, or what pattern the codebase uses — call `nella_search` first. Only fall back to grep/glob if Nella returns no results or you need exact file paths.

### When to use `nella_search` (ALWAYS for these):
- "Where is X defined?" → `nella_search` first
- "How does X work?" → `nella_search` first
- "Find all uses of X" → `nella_search` first
- "Explain this module/function" → `nella_search` to find it, then read
- "Modify/refactor X" → `nella_search` to locate it before touching code
- "What pattern does the codebase use for X?" → `nella_search` first
- Exploring unfamiliar parts of the codebase → `nella_search` first
- Any task that starts with understanding existing code → `nella_search` first

### When grep/glob is OK instead:
- You already know the exact file path
- You need a literal string match (e.g. exact import path)
- nella_search returned no results

**Token efficiency:** `nella_search` returns ranked, relevant chunks with file paths and line numbers. One search call replaces 5-10 grep/glob/read calls. Use it aggressively.

---

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.