# MCP Tools Reference

Complete reference for all tools exposed by the Nella MCP Server.

## Table of Contents

- [Context Tools](#context-tools)
  - [nella_get_context](#nella_get_context)
  - [nella_add_assumption](#nella_add_assumption)
  - [nella_check_assumptions](#nella_check_assumptions)
  - [nella_check_dependencies](#nella_check_dependencies)
- [Indexing Tools](#indexing-tools)
  - [nella_index](#nella_index)
  - [nella_search](#nella_search)

---

## Context Tools

Tools for managing session context, assumptions, and dependency tracking.

### nella_get_context

Get the full session context including recent changes, assumptions, and dependencies.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `changesLimit` | `number` | No | Maximum number of recent changes to return (default: 20) |

**Example:**
```typescript
nella_get_context({ changesLimit: 10 })
```

---

### nella_add_assumption

Record an assumption about the codebase that is automatically checked when related files change.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | `string` | Yes | Category: schema, interface, dependency, behavior, config, structure, other |
| `description` | `string` | Yes | What is being assumed |
| `relatedFiles` | `string[]` | No | Files this assumption relates to (supports globs) |
| `confidence` | `number` | No | Confidence level 0-1 (default: 0.8) |

**Example:**
```typescript
nella_add_assumption({
  type: 'interface',
  description: 'User model has id, name, and email string fields',
  relatedFiles: ['src/types.ts', 'src/models/user.ts'],
  confidence: 0.9,
})
```

---

### nella_check_assumptions

Get the status of all recorded assumptions, including any that have been invalidated.

**Parameters:** None.

**Example:**
```typescript
nella_check_assumptions({})
```

---

### nella_check_dependencies

Check for dependency changes (package.json, lockfile) since the last snapshot.

**Parameters:** None.

**Example:**
```typescript
nella_check_dependencies({})
```

---

## Indexing Tools

Tools for indexing and searching the codebase.

### nella_index

Index workspace codebase for semantic and lexical search.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `force` | `boolean` | No | Force full reindex (default: false) |
| `paths` | `string[]` | No | Specific paths to index (default: entire workspace) |

**Example:**
```typescript
nella_index({ force: true })
```

---

### nella_search

Search the indexed codebase using hybrid search (semantic + BM25 lexical).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | `string` | Yes | Search query |
| `mode` | `string` | No | Search mode: hybrid, semantic, lexical (default: hybrid) |
| `topK` | `number` | No | Number of results (default: 10) |
| `language` | `string` | No | Filter by language |
| `filePattern` | `string` | No | Filter by file glob pattern |

**Example:**
```typescript
nella_search({
  query: 'user authentication middleware',
  mode: 'hybrid',
  topK: 5,
})
```

---

## Tool Categories Summary

| Category | Tools | Purpose |
|----------|-------|---------|
| **Context** | `nella_get_context`, `nella_add_assumption`, `nella_check_assumptions`, `nella_check_dependencies` | Session state, assumptions, dependency tracking |
| **Indexing** | `nella_index`, `nella_search` | Codebase indexing and hybrid search |
