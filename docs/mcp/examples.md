# MCP Examples

Practical examples and workflows for using the Nella MCP Server.

## Table of Contents

- [Basic Workflow](#basic-workflow)
- [Feature Implementation](#feature-implementation)
- [Bug Fix Workflow](#bug-fix-workflow)
- [Refactoring Workflow](#refactoring-workflow)
- [Working with Assumptions](#working-with-assumptions)
- [Handling Risky Requests](#handling-risky-requests)

---

## Basic Workflow

A typical workflow using Nella tools:

### 1. Check Prerequisites

```
User: Add a new endpoint to get user by email

Claude: I'll start by checking if the workspace is set up correctly.
[Uses nella_check_prerequisites]

✅ All prerequisites met
- package.json: Found
- node_modules: 1,247 packages installed
```

### 2. Record Assumptions

```
Claude: Let me record my assumptions about the codebase.
[Uses nella_add_assumption]
  type: "schema"
  description: "User model has email field"
  relatedFiles: ["prisma/schema.prisma"]
  confidence: 0.9

[Uses nella_add_assumption]
  type: "structure"
  description: "Routes are in src/routes/"
  relatedFiles: ["src/routes/"]
  confidence: 0.8
```

### 3. Check for Risks

```
Claude: Let me verify this request is safe.
[Uses nella_should_refuse]
  taskId: "add-email-endpoint"
  prompt: "Add a new endpoint to get user by email"

✅ Safe to proceed
- No risk patterns detected
- Confidence: 0.00
```

### 4. Make Changes and Validate

```
Claude: [Makes code changes]

Now let me validate the changes.
[Uses nella_run]
  taskId: "add-email-endpoint"
  taskName: "Add GET /users/email/:email endpoint"
  prompt: "Add a new endpoint to get user by email"
  changes: [...]
  validation: { test: "npm test", lint: "npm run lint" }

✅ PASSED
- Constraints: 0 violations
- Tests: Passed
- Lint: Passed
- Scope creep: 0.00
```

---

## Feature Implementation

Complete workflow for implementing a new feature.

### Task: Add Pagination to Users API

```
User: Add pagination to the GET /users endpoint

Claude: I'll implement pagination for the users endpoint. Let me start by checking prerequisites and recording my assumptions.

[Uses nella_check_prerequisites]
✅ All prerequisites met

[Uses nella_add_assumption]
  type: "interface"
  description: "API uses Express Router pattern"
  relatedFiles: ["src/routes/users.ts"]
  confidence: 0.8

[Uses nella_add_assumption]
  type: "schema"
  description: "User table supports offset-based pagination"
  relatedFiles: ["prisma/schema.prisma"]
  confidence: 0.9

Now let me check if there are any risks in this request.

[Uses nella_should_refuse]
✅ Safe to proceed

I'll implement the pagination. Here are the changes I'll make:
1. Add pagination parameters to the route handler
2. Add pagination types
3. Update the Prisma query with skip/take

[Makes code changes to src/routes/users.ts, src/types.ts]

Let me validate these changes.

[Uses nella_run]
  taskId: "add-pagination"
  taskName: "Add pagination to users endpoint"
  constraints: [
    {
      id: "no-breaking-changes",
      description: "Don't break existing API contract",
      forbiddenPatterns: ["router\\.delete.*'\\/'"]
    }
  ]
  validation: { test: "npm test", lint: "npm run lint", compile: "npm run check:types" }
  expectedFiles: ["src/routes/users.ts", "src/types.ts"]
  changes: [...]

✅ PASSED
- Run ID: 2026-01-16_143052_a1b2
- Constraints: 0 violations
- Tests: Passed (3.2s)
- Lint: Passed (1.1s)
- Types: Passed (2.4s)
- Scope creep: 0.00

The pagination has been implemented successfully. The endpoint now accepts `page` and `limit` query parameters.
```

---

## Bug Fix Workflow

Workflow for investigating and fixing a bug.

### Task: Fix User Creation Bug

```
User: Users are being created with null emails even when email is provided

Claude: I'll investigate this bug. Let me first check the session context to see what recent changes might be relevant.

[Uses nella_get_context]
Recent changes:
- src/routes/users.ts (modified 30 min ago) - "Added validation"
- src/models/user.ts (modified 2 hours ago) - "Updated type"

Let me check the file history for the users route.

[Uses nella_get_file_history]
  filePath: "src/routes/users.ts"

Change history shows recent validation changes. Let me verify my assumptions about the schema.

[Uses nella_check_assumptions]
Valid assumptions:
- [schema] User has email field (confidence: 0.9)
- [interface] POST /users accepts email in body (confidence: 0.8)

The assumptions look valid. Let me check if there are any dependency changes that might affect this.

[Uses nella_check_dependencies]
✅ No changes since last snapshot

After investigating, I found the issue: the validation middleware is stripping the email field. Here's my fix:

[Makes code changes to src/middleware/validation.ts]

Let me validate the fix.

[Uses nella_run]
  taskId: "fix-email-bug"
  taskName: "Fix user creation email bug"
  constraints: [
    {
      id: "preserve-validation",
      description: "Don't remove existing validation",
      forbiddenPatterns: ["// validation disabled"]
    }
  ]
  validation: { test: "npm test" }
  changes: [...]

✅ PASSED
- Tests: Passed (4.1s)
- Scope creep: 0.00

The bug has been fixed. The validation middleware now correctly passes through the email field.
```

---

## Refactoring Workflow

Workflow for safe refactoring with constraint checking.

### Task: Extract User Service

```
User: Extract the user logic from routes into a separate service

Claude: I'll refactor the user logic into a service layer. This is a significant change, so let me be thorough with constraints.

[Uses nella_check_prerequisites]
✅ All prerequisites met

[Uses nella_add_assumption]
  type: "structure"
  description: "Services go in src/services/"
  relatedFiles: ["src/services/"]
  confidence: 0.7

[Uses nella_add_assumption]
  type: "behavior"
  description: "Routes call service methods"
  relatedFiles: ["src/routes/users.ts", "src/services/"]
  confidence: 0.8

Let me first check the changes won't introduce any risks.

[Uses nella_detect_risks]
  content: [code to be moved]

✅ No risk patterns detected

Now I'll perform the refactoring:
1. Create src/services/user.service.ts
2. Move logic from routes to service
3. Update routes to use service

[Makes code changes]

Before validating, let me do a quick constraint check.

[Uses nella_check]
  constraints: [
    {
      id: "no-route-logic",
      description: "Routes should only handle HTTP concerns",
      forbiddenPatterns: ["prisma\\.", "findUnique", "findMany"]
    },
    {
      id: "service-pattern",
      description: "Service methods should be async",
      forbiddenPatterns: ["function\\s+\\w+\\s*\\([^)]*\\)\\s*\\{[^}]*return\\s+prisma"]
    }
  ]
  modifiedFiles: ["src/routes/users.ts", "src/services/user.service.ts"]
  diff: [git diff]

Constraint check on routes file...
✅ no-route-logic: Passed (no Prisma calls in routes)

Now full validation.

[Uses nella_run]
  validation: { test: "npm test", lint: "npm run lint", compile: "npm run check:types" }
  expectedFiles: ["src/routes/users.ts", "src/services/user.service.ts"]
  changes: [...]

✅ PASSED
- Tests: Passed (5.2s)
- Lint: Passed (1.3s)
- Types: Passed (2.8s)
- Scope creep: 0.00

The refactoring is complete. User logic is now in a dedicated service layer.
```

---

## Working with Assumptions

Examples of effective assumption management.

### Recording Assumptions at Project Start

```
User: Help me add features to this Express API

Claude: I'll explore the codebase and record my assumptions.

[Uses nella_get_context]
New session started.

Let me record what I learn about the codebase:

[Uses nella_add_assumption]
  type: "structure"
  description: "Express app with MVC-like structure"
  relatedFiles: ["src/"]
  confidence: 0.9

[Uses nella_add_assumption]
  type: "dependency"
  description: "Using Prisma as ORM"
  relatedFiles: ["package.json", "prisma/"]
  confidence: 1.0

[Uses nella_add_assumption]
  type: "interface"
  description: "API returns JSON with { data, error } shape"
  relatedFiles: ["src/routes/"]
  confidence: 0.7

[Uses nella_add_assumption]
  type: "config"
  description: "Database URL from DATABASE_URL env var"
  relatedFiles: [".env.example", "prisma/schema.prisma"]
  confidence: 1.0

I've recorded 4 assumptions about the codebase. These will be checked when we make changes.
```

### Handling Invalidated Assumptions

```
Claude: [After making changes]

[Uses nella_check_assumptions]

⚠️ 1 assumption invalidated:
- [interface] "API returns { data, error } shape"
  Invalidated by: nella_run_abc123
  Reason: src/routes/users.ts was modified

Let me verify if this assumption is still valid...

[Reads the modified file]

The assumption is actually still valid - the modification just added a new endpoint with the same shape. Let me re-add it:

[Uses nella_add_assumption]
  type: "interface"
  description: "API returns JSON with { data, error } shape"
  relatedFiles: ["src/routes/"]
  confidence: 1.0  // Higher confidence now that I've verified

Assumption re-recorded with higher confidence since I verified it's still accurate.
```

---

## Handling Risky Requests

How to handle potentially dangerous requests.

### Detecting and Refusing Risky Tasks

```
User: Add logging to track user passwords for debugging

Claude: Let me check if this request is safe to proceed with.

[Uses nella_should_refuse]
  taskId: "add-password-logging"
  prompt: "Add logging to track user passwords for debugging"

🚫 SHOULD REFUSE
- Reason: Risk patterns detected in prompt
- Patterns matched: ["log.*password"]
- Confidence: 0.30

I can't help with logging passwords as that would create a security vulnerability. Passwords should never be logged, even for debugging purposes.

Instead, I can help you with:
1. Logging authentication events (success/failure) without passwords
2. Adding request tracing with sensitive data redacted
3. Setting up secure debugging with breakpoints

Would you like me to implement one of these safer alternatives?
```

### Detecting Risks in Code

```
User: Review this code I wrote

Claude: Let me check this code for any security concerns.

[Uses nella_detect_risks]
  content: [user's code]

⚠️ 2 risk pattern(s) detected:
1. `console.log(user.password)` — Credential exposure
2. `eval(userInput)` — Code injection vulnerability

I found some security issues in this code:

1. **Password logging** (line 15): You're logging the user's password. This should be removed as passwords should never be logged.

2. **eval() usage** (line 23): Using `eval()` with user input is a code injection vulnerability. Consider using a safer alternative like `JSON.parse()` for data parsing.

Here's how I'd fix these issues:
[Provides safe alternatives]
```

### Safe Alternative Workflows

```
User: I need to debug authentication issues

Claude: I understand you need to debug authentication. Let me suggest a safe approach.

[Uses nella_detect_risks]
  content: "Debug authentication by logging auth events and tokens"

⚠️ Pattern detected: log.*token

Instead of logging tokens, here's a safer debugging approach:

1. Log authentication events with user IDs only:
   ```typescript
   logger.info('Auth success', { userId: user.id, timestamp: Date.now() });
   ```

2. Add request tracing:
   ```typescript
   logger.debug('Auth attempt', { requestId, method: 'jwt' });
   ```

3. Use environment-based debug modes:
   ```typescript
   if (process.env.DEBUG_AUTH) {
     logger.debug('Auth state', { isValid, expiresIn });
   }
   ```

Want me to implement this safer debugging approach?
```

---

## Multi-Step Task

Complex task with multiple validation checkpoints.

### Task: Add Complete CRUD for Products

```
User: Add full CRUD operations for a products resource

Claude: I'll implement full CRUD for products. This is a multi-step task, so I'll validate at each step.

[Uses nella_check_prerequisites]
✅ Ready

Step 1: Add Product model
[Makes changes to prisma/schema.prisma]

[Uses nella_validate]
  compile: "npx prisma validate"

✅ Prisma schema valid

Step 2: Generate Prisma client and add types
[Runs prisma generate]

[Uses nella_add_assumption]
  type: "schema"
  description: "Product has id, name, price, description fields"
  relatedFiles: ["prisma/schema.prisma"]
  confidence: 1.0

Step 3: Add Product service
[Creates src/services/product.service.ts]

[Uses nella_check]
  constraints: [{
    id: "service-pattern",
    description: "Services use dependency injection"
  }]

✅ Constraint check passed

Step 4: Add Product routes
[Creates src/routes/products.ts]

Step 5: Full validation
[Uses nella_run]
  taskId: "product-crud"
  taskName: "Add Product CRUD operations"
  validation: { test: "npm test", lint: "npm run lint", compile: "npm run check:types" }
  expectedFiles: [
    "prisma/schema.prisma",
    "src/services/product.service.ts",
    "src/routes/products.ts"
  ]
  changes: [all changes]

✅ PASSED
- Tests: Passed
- Lint: Passed
- Types: Passed
- Scope creep: 0.00

Product CRUD is complete:
- GET /products - List all products
- GET /products/:id - Get product by ID
- POST /products - Create product
- PUT /products/:id - Update product
- DELETE /products/:id - Delete product
```

---

## Session Management

Working with session context over multiple conversations.

### Continuing a Previous Session

```
User: Continue working on the users API from yesterday

Claude: Let me check the session context to see what we worked on.

[Uses nella_get_context]

Session Info:
- Started: 2026-01-15T14:30:00Z
- Duration: 2 hours (yesterday)
- Runs: 5

Recent Changes:
1. src/routes/users.ts - Added pagination (yesterday 15:00)
2. src/services/user.service.ts - Created service layer (yesterday 15:30)
3. src/types/pagination.ts - Added types (yesterday 15:45)

Active Assumptions:
- [schema] User has email, name, createdAt fields
- [interface] Pagination returns { data, meta: { page, total } }
- [structure] Services in src/services/

I can see we added pagination and created a service layer yesterday. What would you like to continue with?
```

### Checking for External Changes

```
Claude: Before continuing, let me check if anything changed since our last session.

[Uses nella_check_dependencies]

⚠️ Dependencies changed:
- Added: @types/jest@29.5.0 (dev)
- Updated: typescript 5.2.0 → 5.3.0

[Uses nella_check_assumptions]

⚠️ 1 assumption may need review:
- [dependency] "Using TypeScript 5.2.x" - dependency changed

I notice TypeScript was updated to 5.3.0. Let me update my assumption and verify the changes don't affect our code.

[Uses nella_validate]
  compile: "npm run check:types"

✅ Types still compile correctly with TypeScript 5.3.0

We're good to continue!
```
