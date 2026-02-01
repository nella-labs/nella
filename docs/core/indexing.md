# Indexing & Search

Nella Core includes an indexing stack for hybrid search (vector + lexical) and code verification. This module powers RAG workflows by chunking code, embedding it, and blending semantic + lexical rankings.

## Key Exports

- `createIndexManager` — orchestrates indexing, search, and verification
- `DEFAULT_INDEX_CONFIG` — base configuration for embedder, chunking, and search weights
- `createChunker`, `createEmbedder`, `createVectorStore`, `createLexicalIndex` — lower-level building blocks

## Quick Start

```ts
import { createIndexManager, DEFAULT_INDEX_CONFIG } from '@usenella/core';

const index = createIndexManager({
  workspaceId: 'repo-1',
  workspacePath: '/path/to/repo',
  storagePath: '/path/to/repo/.nella/index',
  ...DEFAULT_INDEX_CONFIG,
});

await index.index();
const response = await index.search({ query: 'rate limiter config', topK: 5 });
console.log(response.results);
```

## Indexing

```ts
// Index everything in workspace using include/exclude patterns
await index.index();

// Only index specific paths
await index.index({ paths: ['src', 'packages/core'] });

// Force re-index even if hashes match
await index.index({ force: true });
```

## Search + Verify

```ts
const search = await index.search({
  query: 'workspace switcher',
  topK: 8,
});

const verification = index.verify({
  code: 'export const limit = createRateLimiter({ requestsPerMinute: 120 });',
  filePath: 'src/limits.ts',
  checkImports: true,
  checkSymbols: true,
  checkAPIs: true,
});
```

## Configuration Notes

- `workspacePath` controls where files are scanned.
- `storagePath` stores metadata, chunks, and hashes for reuse.
- `DEFAULT_INDEX_CONFIG` includes default file globs and embedder settings; override to match your repo.

## Related Docs

- [Core Modules guide](./modules.md)
- [Core API reference](./api-reference.md)
