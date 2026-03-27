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

export interface ContentSource {
  /** Where this content originated */
  origin: "workspace" | "external_docs" | "external_repo" | "user_provided";
  /** URL or path of the original source */
  sourceUrl?: string;
  /** Trust level computed from origin + injection scan */
  trustLevel: "trusted" | "semi-trusted" | "untrusted";
  /** Injection risk score from content scanner (0.0 - 1.0) */
  injectionScore?: number;
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
  /** Source trust classification for prompt injection defense */
  source?: ContentSource;
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
    estimatedTokens?: number;
    embeddingsCount: number;
    totalCost?: number;
    durationMs?: number;
  };
  config: IndexConfig;
}

export interface IndexConfig {
  // Embedding settings
  embedder: {
    provider: "azure";
    model: string;
    dimensions: number;
    apiKey?: string;
    endpoint?: string;
    deployment?: string;
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
    provider: "azure",
    model: "text-embedding-3-small",
    dimensions: 1536,
  },
  chunking: {
    maxTokens: 1024,
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
  provider: "azure";
  apiKey?: string;
  endpoint?: string;
  deployment?: string;
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
