# MCP Tools Reference

Complete reference for all tools exposed by the Nella MCP Server.

> **Note:** This documentation is automatically synced to the website. Last updated: February 2026.

## Table of Contents

- [Validation Tools](#validation-tools)
  - [nella_check](#nella_check)
  - [nella_validate](#nella_validate)
  - [nella_run](#nella_run)
- [Safety Tools](#safety-tools)
  - [nella_detect_risks](#nella_detect_risks)
  - [nella_should_refuse](#nella_should_refuse)
  - [nella_check_prerequisites](#nella_check_prerequisites)
- [Context Tools](#context-tools)
  - [nella_get_context](#nella_get_context)
  - [nella_add_assumption](#nella_add_assumption)
  - [nella_check_assumptions](#nella_check_assumptions)
  - [nella_get_file_history](#nella_get_file_history)
  - [nella_check_dependencies](#nella_check_dependencies)
  - [nella_record_change](#nella_record_change)

---

## Validation Tools

### nella_check

> **Objectives:** Prevent Contradictions & Unbacked Behaviors

Quick constraint validation without running full test suites. Use this for fast feedback before committing to changes.

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `constraints` | `Constraint[]` | Yes | Array of constraints to check |
| `modifiedFiles` | `string[]` | Yes | List of files that were modified |
| `diff` | `string` | Yes | Git diff of the changes |

**Constraint Schema:**
```typescript
interface Constraint {
  id: string;                    // Unique identifier
  description: string;           // Human-readable description
  rule: string;                  // Rule statement
  filesNotToModify?: string[];   // Glob patterns for forbidden files
  forbiddenPatterns?: string[];  // Regex patterns forbidden in diff
}
```

**Response:**
```
## Constraint Check Results

✅ All constraints passed

### Checked Constraints
- ✅ no-auth-changes: Do not modify authentication logic
- ✅ no-console-log: No console.log statements
```

Or if violations are found:
```
## Constraint Check Results

❌ 1 constraint(s) violated

### Violations
- **no-auth-changes**: Modified forbidden file: src/auth/login.ts

### Passed Constraints
- ✅ no-console-log: No console.log statements
```

**Example Usage:**
```
Claude: Let me check if my planned changes violate any constraints.
[Uses nella_check with constraints, modifiedFiles, and diff]
```

---

### nella_validate

> **Objectives:** Reduce Hallucinations, Prevent Contradictions

Run validation commands (tests, lints, builds) to verify changes work correctly.

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `test` | `string` | No | Test command (e.g., `npm test`) |
| `lint` | `string` | No | Lint command (e.g., `npm run lint`) |
| `compile` | `string` | No | Compile/typecheck command |

At least one command must be provided.

**Response:**
```
## Validation Results

✅ All validations passed

### Test
- Command: `npm test`
- Status: ✅ Passed
- Duration: 3.2s

### Lint
- Command: `npm run lint`
- Status: ✅ Passed
- Duration: 1.1s

### Compile
- Command: `npm run check:types`
- Status: ✅ Passed
- Duration: 2.4s
```

Or if failures occur:
```
## Validation Results

❌ 1 of 3 validations failed

### Test
- Command: `npm test`
- Status: ❌ Failed (exit code 1)
- Duration: 4.5s
- Output:
  ```
  FAIL src/users.test.ts
    ✕ should return user by id (5ms)
  ```
```

**Example Usage:**
```
Claude: Let me run the test suite to verify my changes.
[Uses nella_validate with test: "npm test"]
```

---

### nella_run

> **Objectives:** All — Hallucination Reduction, Context Expansion, Prompt Injection Protection, Contradiction Prevention

Complete Nella validation workflow. Orchestrates:
1. Refusal check
2. Constraint validation
3. Validation execution (tests/lint/compile)
4. Scope creep analysis
5. Metrics calculation

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | `string` | Yes | Unique task identifier |
| `taskName` | `string` | Yes | Human-readable task name |
| `prompt` | `string` | Yes | The original task prompt |
| `constraints` | `Constraint[]` | No | Constraints to check |
| `validation` | `ValidationConfig` | No | Validation commands |
| `expectedFiles` | `string[]` | No | Files expected to be modified |
| `changes` | `FileChange[]` | Yes | The file changes to validate |

**FileChange Schema:**
```typescript
interface FileChange {
  path: string;
  operation: "create" | "modify" | "delete";
  content: string;
}
```

**ValidationConfig Schema:**
```typescript
interface ValidationConfig {
  test?: string;
  lint?: string;
  compile?: string;
}
```

**Response:**
```
## Nella Run Results

✅ **PASSED**

### Summary
- Run ID: 2026-01-16_143052_a1b2
- Task: Add user endpoint
- Duration: 8.3s

### Metrics
| Metric | Value |
|--------|-------|
| Scope Creep | 0.00 |
| Constraint Violations | 0 |
| Validation Integrity | 1.00 |

### Constraints
✅ All 2 constraints passed

### Validation
- ✅ Test: Passed (3.2s)
- ✅ Lint: Passed (1.1s)
- ✅ Compile: Passed (2.4s)

### Scope Analysis
- Expected files: 2
- Modified files: 2
- Extra files: 0
- Missing files: 0

### Artifacts
- Diff: .nella/runs/2026-01-16_143052_a1b2/diff.patch
- Logs: .nella/runs/2026-01-16_143052_a1b2/logs.jsonl
- Metrics: .nella/runs/2026-01-16_143052_a1b2/metrics.json
```

**Example Usage:**
```
Claude: Now let me run the full validation to ensure everything is correct.
[Uses nella_run with all task details and changes]
```

---

## Safety Tools

### nella_detect_risks

> **Objectives:** Prompt Injection Protection

Analyze text for prompt injection and risky patterns. Scans for:
- Credential exposure (passwords, tokens, API keys)
- Security bypasses (disable auth, skip validation)
- Dangerous operations (drop table, rm -rf)
- Data exposure (dump database, export secrets)
- Backdoors (hardcoded passwords, admin accounts)

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | `string` | Yes | Code or prompt to analyze |

**Response:**
```
## Risk Detection Results

⚠️ 2 risk pattern(s) detected

### Detected Patterns
1. `log.*password` — Potential credential exposure
2. `disable.*auth` — Security bypass attempt

### Recommendation
Review these patterns carefully. They may indicate:
- Accidental logging of sensitive data
- Intentional security weakening
- Debug code that shouldn't be in production
```

Or if no risks found:
```
## Risk Detection Results

✅ No risk patterns detected

The analyzed content does not contain any known risky patterns.
```

**Built-in Risk Patterns (57 total):**

| Category | Example Patterns |
|----------|-----------------|
| Credentials | `log.*password`, `log.*token`, `log.*api_key`, `print.*secret` |
| Security Bypass | `disable.*auth`, `skip.*validation`, `remove.*security`, `bypass.*check` |
| Dangerous Ops | `drop.*table`, `rm -rf`, `format.*disk`, `delete.*all` |
| Data Exposure | `expose.*credential`, `dump.*database`, `export.*secret` |
| Backdoors | `add.*backdoor`, `create.*admin`, `hardcode.*password` |

**Example Usage:**
```
Claude: Let me check if this code has any security concerns.
[Uses nella_detect_risks with the code content]
```

---

### nella_should_refuse

> **Objectives:** Prompt Injection Protection

Determine if a task should be refused. Acts as a prompt injection and safety gate. Evaluates:
- Risk patterns in the prompt
- Missing prerequisites
- Dangerous operation indicators

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | `string` | Yes | Task identifier |
| `prompt` | `string` | Yes | The task prompt to evaluate |
| `skipPrerequisites` | `boolean` | No | Skip prerequisite checks |

**Response:**
```
## Refusal Check Results

🚫 **SHOULD REFUSE**

### Reason
Risk patterns detected in prompt

### Matched Patterns
- `log.*password`
- `expose.*credential`

### Confidence
0.60 (60%)

### Recommendation
This request contains patterns associated with security risks.
Consider declining or requesting clarification.
```

Or if task is safe:
```
## Refusal Check Results

✅ **SAFE TO PROCEED**

### Analysis
- No risk patterns detected
- All prerequisites met
- Confidence: 0.00

The task appears safe to execute.
```

**Confidence Calculation:**
- +0.3 per matched risk pattern (max 0.9 from patterns)
- +0.5 if prerequisites are missing
- Final score capped at 1.0

**Example Usage:**
```
Claude: Before starting, let me verify this task is safe to proceed with.
[Uses nella_should_refuse with taskId and prompt]
```

---

### nella_check_prerequisites

> **Objectives:** Prompt Injection Protection, Reduce Hallucinations

Verify workspace prerequisites are met before starting work.

**Input Parameters:**

None — uses the workspace path configured at server startup.

**Checks Performed:**
1. `package.json` exists in workspace
2. `node_modules` directory exists and is not empty

**Response:**
```
## Prerequisite Check Results

✅ All prerequisites met

### Checks
- ✅ **package.json**: Found at workspace root
- ✅ **node_modules**: Dependencies installed (1,247 packages)
```

Or if prerequisites are missing:
```
## Prerequisite Check Results

❌ 1 prerequisite(s) not met

### Checks
- ✅ **package.json**: Found at workspace root
- ❌ **node_modules**: Missing — run `npm install` first

### Action Required
Please run `npm install` before proceeding with code changes.
```

**Example Usage:**
```
Claude: Let me first verify the workspace is set up correctly.
[Uses nella_check_prerequisites]
```

---

## Context Tools

### nella_get_context

> **Objectives:** Increase Context, Prevent Contradictions

Get the full session context including recent changes, assumptions, and dependencies.

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `changesLimit` | `number` | No | Maximum number of recent changes to return (default: 50) |

**Response:**
```
## Session Context

### Session Info
- **Session ID**: abc123-def456
- **Started**: 2026-01-16T10:30:00Z
- **Duration**: 45 minutes
- **Runs completed**: 3

### Recent Changes (5 total)
| File | Operation | Reason | Time |
|------|-----------|--------|------|
| src/users.ts | modify | Added pagination | 10:45 |
| src/routes.ts | modify | Added route handler | 10:42 |
| src/types.ts | create | Added User type | 10:38 |

### Active Assumptions (2 valid)
1. **Schema**: User table has `id`, `email`, `name` columns (confidence: 0.9)
2. **Interface**: API returns JSON with `data` wrapper (confidence: 0.8)

### Dependency Snapshot
- Taken at: 2026-01-16T10:30:00Z
- Lock file: package-lock.json
- Packages: 1,247 total

### Statistics
- Total changes: 5
- Valid assumptions: 2
- Invalidated assumptions: 0
- Hotspot files: src/users.ts (3 changes)
```

**Example Usage:**
```
Claude: Let me review what we've done in this session so far.
[Uses nella_get_context]
```

---

### nella_add_assumption

> **Objectives:** Prevent Contradictions, Increase Context

Record an assumption about the codebase that can be validated when changes are made.

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | `AssumptionType` | Yes | Category of assumption |
| `description` | `string` | Yes | What is being assumed |
| `relatedFiles` | `string[]` | Yes | Files this assumption relates to |
| `confidence` | `number` | No | Confidence level 0-1 (default: 0.8) |

**Assumption Types:**
- `schema` — Database schema assumptions
- `interface` — API/type interface assumptions
- `dependency` — Package dependency assumptions
- `behavior` — Runtime behavior assumptions
- `config` — Configuration assumptions
- `structure` — Code structure assumptions
- `other` — General assumptions

**Response:**
```
## Assumption Recorded

✅ Successfully added assumption

### Details
- **ID**: asmp_a1b2c3d4
- **Type**: schema
- **Description**: User table has email column with unique constraint
- **Related Files**: prisma/schema.prisma, src/models/user.ts
- **Confidence**: 0.9

### Note
This assumption will be automatically checked when related files are modified.
If changes invalidate this assumption, you will be notified.
```

**Example Usage:**
```
Claude: I'm assuming the User model has an email field. Let me record this.
[Uses nella_add_assumption with type: "schema", description: "User has email field"]
```

---

### nella_check_assumptions

> **Objectives:** Prevent Contradictions

Get the status of all recorded assumptions, including any that have been invalidated.

**Input Parameters:**

None.

**Response:**
```
## Assumption Status

### Summary
- Valid: 3
- Invalidated: 1

### Valid Assumptions
1. **[schema]** User table has email column (confidence: 0.9)
   - Files: prisma/schema.prisma
   - Created: 10:30 AM

2. **[interface]** API returns paginated response (confidence: 0.8)
   - Files: src/types.ts
   - Created: 10:35 AM

3. **[dependency]** Using Express 4.x (confidence: 1.0)
   - Files: package.json
   - Created: 10:30 AM

### Invalidated Assumptions
1. **[behavior]** ~~Users are fetched without pagination~~ ❌
   - Invalidated at: 10:45 AM
   - Invalidated by: nella_run_abc123
   - Reason: src/routes/users.ts was modified to add pagination
```

**Example Usage:**
```
Claude: Let me check if my assumptions are still valid.
[Uses nella_check_assumptions]
```

---

### nella_get_file_history

> **Objectives:** Increase Context, Prevent Contradictions

Get the change history for a specific file within the current session.

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filePath` | `string` | Yes | Relative path to the file |

**Response:**
```
## File History: src/users.ts

### Summary
- Total changes: 3
- First change: 10:30 AM
- Last change: 10:45 AM

### Change Log

#### 1. 10:30 AM — Create
- Run ID: nella_run_001
- Reason: Initial user service implementation
- Dependencies: src/types.ts

#### 2. 10:38 AM — Modify
- Run ID: nella_run_002
- Reason: Added findById method
- Dependencies: src/types.ts, prisma/schema.prisma

#### 3. 10:45 AM — Modify
- Run ID: nella_run_003
- Reason: Added pagination support
- Dependencies: src/types.ts, src/utils/pagination.ts
- Related assumptions: asmp_pagination
```

**Example Usage:**
```
Claude: Let me see what changes we've made to the users service.
[Uses nella_get_file_history with filePath: "src/users.ts"]
```

---

### nella_check_dependencies

> **Objectives:** Reduce Hallucinations, Increase Context

Check for dependency changes (package.json, lockfile) since the last snapshot.

**Input Parameters:**

None.

**Response:**
```
## Dependency Changes

⚠️ Dependencies have changed since last snapshot

### Snapshot
- Taken: 2026-01-16T10:30:00Z
- Lock file: package-lock.json

### Changes Detected

#### Added Packages (2)
| Package | Version | Type |
|---------|---------|------|
| zod | ^3.22.0 | prod |
| @types/zod | ^3.22.0 | dev |

#### Updated Packages (1)
| Package | Old | New |
|---------|-----|-----|
| express | 4.18.0 | 4.19.0 |

#### Removed Packages (0)
None

### Affected Assumptions
The following assumptions may need review:
- **[dependency]** Using Express 4.18.x
```

Or if no changes:
```
## Dependency Changes

✅ No changes since last snapshot

- Snapshot taken: 2026-01-16T10:30:00Z
- Packages: 1,247 total
- Status: Unchanged
```

**Example Usage:**
```
Claude: Let me check if any dependencies have changed.
[Uses nella_check_dependencies]
```

---

### nella_record_change

> **Objectives:** Increase Context, Prevent Contradictions

Manually record file changes to keep context accurate. Use this when making changes outside of `nella_run`.

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `files` | `string[]` | Yes | List of file paths that were changed |
| `operation` | `string` | Yes | Operation type: "create", "modify", or "delete" |
| `reason` | `string` | Yes | Why the change was made |

**Response:**
```
## Changes Recorded

✅ Successfully recorded 2 change(s)

### Recorded
1. **src/utils/helper.ts** — create
2. **src/index.ts** — modify

### Reason
Added helper utility for date formatting

### Assumption Check
1 assumption was invalidated by these changes:
- **[structure]** ~~No utility files in src/utils~~ ❌
```

**Example Usage:**
```
Claude: I made some changes manually. Let me record them for context tracking.
[Uses nella_record_change with files and reason]
```

---

## Tool Response Format

All tools return markdown-formatted text responses that include:

1. **Status Header** — Clear pass/fail indication with emoji
2. **Summary Section** — Key information at a glance
3. **Details Section** — Expanded information as needed
4. **Recommendations** — Suggested next steps when applicable

Responses are designed to be:
- Human-readable in conversation
- Parseable by agents for decision-making
- Consistent across all tools
