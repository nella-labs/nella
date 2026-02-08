# Indexing & Search

Nella Core includes an indexing stack for hybrid search (vector + lexical) and code verification. This module powers RAG workflows by chunking code, embedding it, and blending semantic + lexical rankings.

## Key Exports

- `createIndexManager` / `IndexManager` — orchestrates indexing, search, and verification
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

// Incremental indexing (default — skips unchanged files)
await index.index({ incremental: true });
```

### What Gets Indexed

The indexer parses source files, extracts code symbols (functions, classes, interfaces, types, variables), generates embeddings, and builds both vector and lexical indices.

**Default file patterns:**
- Includes: `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`, `**/*.py`, `**/*.java`
- Excludes: `node_modules/**`, `dist/**`, `.git/**`, `*.test.*`, `*.spec.*`

### Chunking

The chunker splits source files into meaningful code chunks based on AST structure:

```ts
import { createChunker } from '@usenella/core';

const chunker = createChunker({
  maxChunkSize: 1500,     // Max tokens per chunk
  overlapSize: 200,       // Token overlap between chunks
  respectBoundaries: true, // Don't split mid-function
});

const chunks = chunker.chunk(sourceCode, 'typescript');
// Each chunk has: { content, startLine, endLine, type, symbols }
```

**Chunk types:**
- `function` — Function or method declaration
- `class` — Class declaration
- `interface` — Interface or type declaration
- `import` — Import block
- `block` — Generic code block

### Embeddings

```ts
import { createEmbedder } from '@usenella/core';

const embedder = createEmbedder({
  provider: 'voyage',           // 'voyage' | 'openai' | 'cohere'
  model: 'voyage-code-3',       // Model name
  dimensions: 1024,             // Embedding dimensions
  batchSize: 32,                // Batch size for API calls
});

const embeddings = await embedder.embed(['function hello() {}', 'class User {}']);
```

## Search

```ts
const results = await index.search({
  query: 'workspace switcher',
  topK: 8,
  mode: 'hybrid',               // 'semantic' | 'lexical' | 'hybrid'
  filter: {
    filePatterns: ['src/**/*.ts'],
    languages: ['typescript'],
    symbolTypes: ['function', 'class'],
  },
});

for (const result of results.results) {
  console.log(`${result.filePath}:${result.startLine} — ${result.score}`);
  console.log(result.content);
}
```

### Search Modes

| Mode | Description | Best For |
|------|-------------|----------|
| `semantic` | Vector similarity search | Natural language queries |
| `lexical` | BM25 text search | Exact symbol/variable names |
| `hybrid` (default) | RRF fusion of both | General code search |

### Hybrid Search Weights

```ts
const config = {
  ...DEFAULT_INDEX_CONFIG,
  searchWeights: {
    semantic: 0.6,   // Weight for vector search
    lexical: 0.4,    // Weight for BM25 search
  },
};
```

## Code Verification

Verify generated code against the indexed codebase:

```ts
const verification = await index.verify({
  code: 'import { PrismaClient } from "@prisma/client";\nconst prisma = new PrismaClient();',
  filePath: 'src/db.ts',
  checkImports: true,    // Verify imports exist
  checkSymbols: true,    // Verify referenced symbols
  checkAPIs: true,       // Verify API usage patterns
});

if (verification.issues.length > 0) {
  for (const issue of verification.issues) {
    console.log(`${issue.severity}: ${issue.message} (line ${issue.line})`);
  }
}
```

### Verification Issue Severities

| Severity | Description |
|----------|-------------|
| `error` | Definite problem (missing import, undefined symbol) |
| `warning` | Likely problem (incorrect API usage, type mismatch) |
| `info` | Suggestion (better alternative exists) |

## Index Storage

The index stores data in the `storagePath` directory:

```
.nella/index/
├── chunks.json       # Extracted code chunks
├── embeddings.bin    # Vector embeddings (binary)
├── lexical.json      # BM25 inverted index
├── symbols.json      # Symbol table
└── hashes.json       # File hashes for incremental indexing
```

## Configuration

```ts
const DEFAULT_INDEX_CONFIG = {
  embedder: {
    provider: 'voyage',
    model: 'voyage-code-3',
    dimensions: 1024,
  },
  chunker: {
    maxChunkSize: 1500,
    overlapSize: 200,
    respectBoundaries: true,
  },
  search: {
    defaultTopK: 10,
    mode: 'hybrid',
    weights: { semantic: 0.6, lexical: 0.4 },
  },
  include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
  exclude: ['node_modules/**', 'dist/**', '.git/**'],
};
```

## Related Docs

- [Core Modules Guide](modules.md) — All modules overview
- [Core API Reference](api-reference.md) — Full API surface
- [MCP Tools](../mcp/tools.md) — `nella_search`, `nella_verify`, `nella_index` tools
