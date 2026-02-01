/**
 * Indexing Types
 *
 * Type definitions for the RAG indexing system.
 */

// =============================================================================
// Code Chunks
// =============================================================================

export type ChunkType = "function" | "class" | "interface" | "type" | "module" | "doc" | "comment" | "other";

export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "variable" | "method" | "property" | "import" | "export";
  signature?: string;
  exported?: boolean;
}

export interface CodeChunk {
  id: string;
  filePath: string;
  content: string;
  lines: [number, number];
  type: ChunkType;
  language: string;
  symbols: CodeSymbol[];
  imports?: string[];
  exports?: string[];
  hash: string;
  tokens: number;
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Index Metadata
// =============================================================================

export interface IndexMetadata {
  workspaceId: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  version: string;
  stats: {
    filesIndexed: number;
    chunksCount: number;
    totalTokens: number;
    embeddingsCount: number;
  };
  config: IndexConfig;
}

export interface IndexConfig {
  // Embedding settings
  embedder: {
    provider: "voyage" | "openai" | "local";
    model: string;
    dimensions: number;
  };

  // Chunking settings
  chunking: {
    maxTokens: number;
    overlap: number;
    strategy: "ast" | "recursive" | "fixed";
  };

  // Search settings
  search: {
    vectorWeight: number;  // 0-1, semantic weight
    lexicalWeight: number; // 0-1, BM25 weight
    rerankEnabled: boolean;
    rerankModel?: string;
    topK: number;
  };

  // File patterns
  include: string[];
  exclude: string[];
}

export const DEFAULT_INDEX_CONFIG: IndexConfig = {
  embedder: {
    provider: "voyage",
    model: "voyage-code-2",
    dimensions: 1536,
  },
  chunking: {
    maxTokens: 512,
    overlap: 50,
    strategy: "ast",
  },
  search: {
    vectorWeight: 0.4,
    lexicalWeight: 0.6,
    rerankEnabled: false,
    topK: 10,
  },
  include: [
    "**/*.ts",
    "**/*.tsx",
    "**/*.js",
    "**/*.jsx",
    "**/*.py",
    "**/*.java",
    "**/*.go",
    "**/*.rs",
    "**/*.md",
    "**/*.json",
  ],
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**",
    "**/coverage/**",
    "**/*.min.js",
    "**/package-lock.json",
    "**/pnpm-lock.yaml",
    "**/yarn.lock",
  ],
};

// =============================================================================
// Search Types
// =============================================================================

export interface SearchQuery {
  query: string;
  filter?: SearchFilter;
  limit?: number;
  mode?: "hybrid" | "semantic" | "lexical";
  includeEmbedding?: boolean;
}

export interface SearchFilter {
  fileTypes?: string[];
  paths?: string[];
  symbols?: string[];
  chunkTypes?: ChunkType[];
  minScore?: number;
}

export interface SearchResult {
  chunk: CodeChunk;
  score: number;
  scores: {
    semantic: number;
    lexical: number;
    combined: number;
    reranked?: number;
    relevance?: number;  // Cohere relevance score
  };
  highlights?: string[];
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  totalMatches: number;
  searchTime: number;
  tokensUsed: number;
  cost: number;
  confidence: number;
  suggestion: "use_results" | "query_unclear" | "no_matches" | "low_confidence";
}

// =============================================================================
// Verification Types
// =============================================================================

export interface VerifyCodeRequest {
  code: string;
  filePath?: string;
  checkImports?: boolean;
  checkSymbols?: boolean;
  checkAPIs?: boolean;
}

export interface VerifyCodeResult {
  valid: boolean;
  issues: VerifyIssue[];
  suggestions: string[];
  confidence: number;
}

export interface VerifyIssue {
  type: "missing_import" | "unknown_symbol" | "invalid_api" | "type_mismatch" | "pattern_mismatch";
  severity: "error" | "warning" | "info";
  message: string;
  location?: {
    line: number;
    column: number;
  };
  suggestion?: string;
}

// =============================================================================
// Embedder Types
// =============================================================================

export interface EmbeddingRequest {
  texts: string[];
  model?: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  tokensUsed: number;
  cost: number;
}

export interface EmbedderConfig {
  provider: "voyage" | "openai" | "local";
  apiKey?: string;
  model: string;
  dimensions: number;
  batchSize: number;
  maxRetries: number;
}

// =============================================================================
// Index Events
// =============================================================================

export type IndexEvent =
  | { type: "index:start"; workspaceId: string; totalFiles: number }
  | { type: "index:progress"; workspaceId: string; processed: number; total: number; currentFile: string }
  | { type: "index:chunk"; workspaceId: string; chunkId: string; filePath: string }
  | { type: "index:embed"; workspaceId: string; batchSize: number; tokensUsed: number; cost: number }
  | { type: "index:complete"; workspaceId: string; stats: IndexMetadata["stats"]; duration: number }
  | { type: "index:error"; workspaceId: string; error: string; filePath?: string }
  | { type: "search:query"; query: string; resultsCount: number; searchTime: number }
  | { type: "search:embed"; tokensUsed: number; cost: number }
  | { type: "verify:check"; filePath: string; valid: boolean; issuesCount: number };
