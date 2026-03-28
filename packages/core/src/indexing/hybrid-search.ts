/**
 * Hybrid Search
 *
 * Combines semantic (vector) and lexical (BM25) search using
 * Reciprocal Rank Fusion (RRF) with optional Cohere reranking.
 */

import type { CodeChunk, SearchQuery, SearchResult, SearchResponse, SearchFilter } from "./types";
import { VectorStore } from "./vector-store";
import { LexicalIndex } from "./lexical-index";
import { Embedder } from "./embedder";

// =============================================================================
// Types
// =============================================================================

export interface HybridSearchConfig {
  vectorWeight: number;   // Weight for semantic results (0-1)
  lexicalWeight: number;  // Weight for lexical results (0-1)
  rrfK: number;           // RRF constant (typically 60)
  topK: number;           // Number of results to return
  minScore: number;       // Minimum score threshold
  rerankEnabled: boolean;
  rerankTopK: number;     // How many to rerank
  rerankModel: string;    // Cohere rerank model
}

interface RankedResult {
  chunkId: string;
  semanticRank: number | null;
  lexicalRank: number | null;
  semanticScore: number;
  lexicalScore: number;
  rrfScore: number;
  rerankedScore?: number;
  relevanceScore?: number;  // Cohere relevance score
}

// Cohere API types
interface CohereRerankRequest {
  model: string;
  query: string;
  documents: string[];
  top_n?: number;
  return_documents?: boolean;
}

interface CohereRerankResponse {
  results: {
    index: number;
    relevance_score: number;
  }[];
}

// =============================================================================
// Language → file extension mapping
// =============================================================================

const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  typescript: ["ts", "tsx"],
  javascript: ["js", "jsx", "mjs", "cjs"],
  python: ["py"],
  java: ["java"],
  go: ["go"],
  rust: ["rs"],
  markdown: ["md"],
  json: ["json"],
  yaml: ["yaml", "yml"],
};

/**
 * Resolve a filter value to file extensions.
 * Accepts both language names ("typescript") and raw extensions ("ts").
 */
function resolveFileExtensions(filters: string[]): string[] {
  const resolved = new Set<string>();
  for (const f of filters) {
    const lower = f.toLowerCase();
    const exts = LANGUAGE_EXTENSIONS[lower];
    if (exts) {
      for (const ext of exts) resolved.add(ext);
    } else {
      resolved.add(lower);
    }
  }
  return Array.from(resolved);
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: HybridSearchConfig = {
  vectorWeight: 0.4,
  lexicalWeight: 0.6,
  rrfK: 60,
  topK: 10,
  minScore: 0.0,
  rerankEnabled: true,
  rerankTopK: 20,
  rerankModel: "Cohere-rerank-v4.0-pro",
};

// =============================================================================
// Cohere Reranker
// =============================================================================

class CohereReranker {
  /** Check env vars fresh each time (credentials may rotate mid-session). */
  isAvailable(): boolean {
    return !!(process.env.AZURE_RERANK_API_KEY && process.env.AZURE_RERANK_ENDPOINT);
  }

  async rerank(
    query: string,
    documents: { id: string; text: string }[],
    model?: string,
    topN?: number
  ): Promise<{ id: string; score: number }[]> {
    const apiKey = process.env.AZURE_RERANK_API_KEY;
    const endpoint = process.env.AZURE_RERANK_ENDPOINT;
    if (!apiKey || !endpoint) {
      throw new Error("Azure rerank not configured — set AZURE_RERANK_API_KEY and AZURE_RERANK_ENDPOINT");
    }

    const request: CohereRerankRequest = {
      model: model || "Cohere-rerank-v4.0-pro",
      query,
      documents: documents.map((d) => d.text),
      top_n: topN ?? documents.length,
      return_documents: false,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Client-Name": "nella-core",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Azure Cohere rerank API error: ${response.status} ${error}`);
    }

    const data = await response.json() as CohereRerankResponse;

    return data.results.map((r) => ({
      id: documents[r.index].id,
      score: r.relevance_score,
    }));
  }
}

// =============================================================================
// Local Fallback Reranker (Cross-encoder simulation)
// =============================================================================

class LocalReranker {
  /**
   * Simple term-overlap based reranking
   * In production, this would use a local cross-encoder model
   */
  async rerank(
    query: string,
    documents: { id: string; text: string }[],
    topN?: number
  ): Promise<{ id: string; score: number }[]> {
    const queryTerms = this.tokenize(query);
    
    const scored = documents.map((doc) => {
      const docTerms = this.tokenize(doc.text);
      const score = this.calculateRelevance(queryTerms, docTerms, doc.text);
      return { id: doc.id, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return topN ? scored.slice(0, topN) : scored;
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .split(/[\s\.,;:!?\-_'"()\[\]{}|\\/<>@#$%^&*+=`~]+/)
        .filter((t) => t.length > 2)
    );
  }

  private calculateRelevance(queryTerms: Set<string>, docTerms: Set<string>, docText: string): number {
    let score = 0;
    const docLower = docText.toLowerCase();

    // Term overlap score
    let matchCount = 0;
    for (const term of queryTerms) {
      if (docTerms.has(term)) {
        matchCount++;
        // Boost for exact phrase matches
        if (docLower.includes(term)) {
          score += 0.1;
        }
      }
    }

    // Jaccard-like overlap
    const unionSize = new Set([...queryTerms, ...docTerms]).size;
    const overlapScore = unionSize > 0 ? matchCount / unionSize : 0;
    score += overlapScore;

    // Position boost - earlier matches are better
    for (const term of queryTerms) {
      const pos = docLower.indexOf(term);
      if (pos !== -1) {
        score += (1 - pos / docLower.length) * 0.1;
      }
    }

    // Length normalization - prefer concise matches
    const lengthPenalty = Math.max(0, 1 - (docText.length - 500) / 2000);
    score *= (0.5 + lengthPenalty * 0.5);

    return score;
  }
}

// =============================================================================
// Hybrid Searcher Class
// =============================================================================

export class HybridSearcher {
  private config: HybridSearchConfig;
  private vectorStore: VectorStore;
  private lexicalIndex: LexicalIndex;
  private embedder: Embedder;
  private chunks: Map<string, CodeChunk> = new Map();
  private cohereReranker: CohereReranker;
  private localReranker: LocalReranker;

  constructor(
    vectorStore: VectorStore,
    lexicalIndex: LexicalIndex,
    embedder: Embedder,
    config: Partial<HybridSearchConfig> = {}
  ) {
    this.vectorStore = vectorStore;
    this.lexicalIndex = lexicalIndex;
    this.embedder = embedder;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cohereReranker = new CohereReranker();
    this.localReranker = new LocalReranker();
  }

  /**
   * Check if reranking is available (Azure Cohere deployment configured)
   */
  isRerankingAvailable(): boolean {
    return this.cohereReranker.isAvailable();
  }

  /**
   * Register a chunk for retrieval
   */
  registerChunk(chunk: CodeChunk): void {
    this.chunks.set(chunk.id, chunk);
  }

  /**
   * Register multiple chunks
   */
  registerChunks(chunks: CodeChunk[]): void {
    for (const chunk of chunks) {
      this.registerChunk(chunk);
    }
  }

  /**
   * Perform hybrid search
   */
  async search(query: SearchQuery): Promise<SearchResponse> {
    const startTime = Date.now();
    const limit = query.limit || this.config.topK;
    const mode = query.mode || "hybrid";

    let semanticResults: { chunkId: string; score: number }[] = [];
    let lexicalResults: { chunkId: string; score: number; highlights: string[] }[] = [];
    let embeddingCost = 0;
    let embeddingTokens = 0;

    if (mode === "hybrid") {
      // Run semantic and lexical search in parallel — they're independent
      const fetchCount = limit * 5;
      const [semanticOutput, lexicalOutput] = await Promise.all([
        (async () => {
          const { embedding, tokensUsed, cost } = await this.embedder.embedOne(query.query);
          return { results: this.vectorStore.search(embedding, fetchCount), tokensUsed, cost };
        })(),
        Promise.resolve(this.lexicalIndex.search(query.query, fetchCount)),
      ]);
      semanticResults = semanticOutput.results;
      embeddingTokens = semanticOutput.tokensUsed;
      embeddingCost = semanticOutput.cost;
      lexicalResults = lexicalOutput;
    } else if (mode === "semantic") {
      const { embedding, tokensUsed, cost } = await this.embedder.embedOne(query.query);
      embeddingTokens = tokensUsed;
      embeddingCost = cost;
      semanticResults = this.vectorStore.search(embedding, limit);
    } else {
      lexicalResults = this.lexicalIndex.search(query.query, limit);
    }

    // Combine results based on mode
    let rankedResults: RankedResult[];

    if (mode === "hybrid") {
      rankedResults = this.fuseResults(semanticResults, lexicalResults);
    } else if (mode === "semantic") {
      rankedResults = semanticResults.map((r, i) => ({
        chunkId: r.chunkId,
        semanticRank: i,
        lexicalRank: null,
        semanticScore: r.score,
        lexicalScore: 0,
        rrfScore: r.score,
      }));
    } else {
      rankedResults = lexicalResults.map((r, i) => ({
        chunkId: r.chunkId,
        semanticRank: null,
        lexicalRank: i,
        semanticScore: 0,
        lexicalScore: r.score,
        rrfScore: r.score,
      }));
    }

    // Apply filters
    if (query.filter) {
      rankedResults = this.applyFilters(rankedResults, query.filter);
    }

    // Apply minimum score threshold
    rankedResults = rankedResults.filter((r) => r.rrfScore >= this.config.minScore);

    // Rerank if enabled
    if (this.config.rerankEnabled && rankedResults.length > 0) {
      rankedResults = await this.rerank(query.query, rankedResults);
    }

    // Take top K
    rankedResults = rankedResults.slice(0, limit);

    // Build response
    const results: SearchResult[] = rankedResults.map((r) => {
      const chunk = this.chunks.get(r.chunkId);
      const lexicalResult = lexicalResults.find((lr) => lr.chunkId === r.chunkId);

      return {
        chunk: chunk!,
        score: r.rerankedScore ?? r.rrfScore,
        scores: {
          semantic: r.semanticScore,
          lexical: r.lexicalScore,
          combined: r.rrfScore,
          reranked: r.rerankedScore,
          relevance: r.relevanceScore,
        },
        highlights: lexicalResult?.highlights,
      };
    }).filter((r) => r.chunk !== undefined);

    const searchTime = Date.now() - startTime;

    // Calculate confidence based on top scores
    const confidence = this.calculateConfidence(results);
    const suggestion = this.getSuggestion(results, confidence);

    return {
      results,
      query: query.query,
      totalMatches: results.length,
      searchTime,
      tokensUsed: embeddingTokens,
      cost: embeddingCost,
      confidence,
      suggestion,
    };
  }

  /**
   * Reciprocal Rank Fusion
   */
  private fuseResults(
    semanticResults: { chunkId: string; score: number }[],
    lexicalResults: { chunkId: string; score: number }[]
  ): RankedResult[] {
    const k = this.config.rrfK;
    const scores: Map<string, RankedResult> = new Map();

    // Process semantic results
    semanticResults.forEach((result, rank) => {
      const rrfContribution = this.config.vectorWeight / (k + rank + 1);

      if (!scores.has(result.chunkId)) {
        scores.set(result.chunkId, {
          chunkId: result.chunkId,
          semanticRank: rank,
          lexicalRank: null,
          semanticScore: result.score,
          lexicalScore: 0,
          rrfScore: rrfContribution,
        });
      } else {
        const existing = scores.get(result.chunkId)!;
        existing.semanticRank = rank;
        existing.semanticScore = result.score;
        existing.rrfScore += rrfContribution;
      }
    });

    // Process lexical results
    lexicalResults.forEach((result, rank) => {
      const rrfContribution = this.config.lexicalWeight / (k + rank + 1);

      if (!scores.has(result.chunkId)) {
        scores.set(result.chunkId, {
          chunkId: result.chunkId,
          semanticRank: null,
          lexicalRank: rank,
          semanticScore: 0,
          lexicalScore: result.score,
          rrfScore: rrfContribution,
        });
      } else {
        const existing = scores.get(result.chunkId)!;
        existing.lexicalRank = rank;
        existing.lexicalScore = result.score;
        existing.rrfScore += rrfContribution;
      }
    });

    // Sort by RRF score
    const results = Array.from(scores.values());
    results.sort((a, b) => b.rrfScore - a.rrfScore);

    return results;
  }

  /**
   * Apply filters to results
   */
  private applyFilters(results: RankedResult[], filter: SearchFilter): RankedResult[] {
    return results.filter((r) => {
      const chunk = this.chunks.get(r.chunkId);
      if (!chunk) return false;

      // File type filter (accepts both language names and extensions)
      if (filter.fileTypes && filter.fileTypes.length > 0) {
        const ext = chunk.filePath.split(".").pop()?.toLowerCase();
        const allowedExts = resolveFileExtensions(filter.fileTypes);
        if (!ext || !allowedExts.includes(ext)) {
          return false;
        }
      }

      // Path filter
      if (filter.paths && filter.paths.length > 0) {
        const matchesPath = filter.paths.some((p) =>
          chunk.filePath.toLowerCase().includes(p.toLowerCase())
        );
        if (!matchesPath) return false;
      }

      // Symbol filter
      if (filter.symbols && filter.symbols.length > 0) {
        const chunkSymbols = chunk.symbols.map((s) => s.name.toLowerCase());
        const matchesSymbol = filter.symbols.some((s) =>
          chunkSymbols.includes(s.toLowerCase())
        );
        if (!matchesSymbol) return false;
      }

      // Chunk type filter
      if (filter.chunkTypes && filter.chunkTypes.length > 0) {
        if (!filter.chunkTypes.includes(chunk.type)) {
          return false;
        }
      }

      // Minimum score filter
      if (filter.minScore !== undefined && r.rrfScore < filter.minScore) {
        return false;
      }

      return true;
    });
  }

  /**
   * Rerank results using Cohere or local fallback
   */
  private async rerank(query: string, results: RankedResult[]): Promise<RankedResult[]> {
    // Take top N for reranking
    const toRerank = results.slice(0, this.config.rerankTopK);
    const rest = results.slice(this.config.rerankTopK);

    // Prepare documents for reranking
    const documents = toRerank.map((r) => {
      const chunk = this.chunks.get(r.chunkId);
      return {
        id: r.chunkId,
        text: chunk ? this.prepareForRerank(chunk) : "",
      };
    }).filter((d) => d.text.length > 0);

    if (documents.length === 0) {
      return results;
    }

    try {
      let reranked: { id: string; score: number }[];

      if (this.cohereReranker.isAvailable()) {
        // Use Cohere reranker
        reranked = await this.cohereReranker.rerank(
          query,
          documents,
          this.config.rerankModel
        );
      } else {
        // Use local fallback reranker
        reranked = await this.localReranker.rerank(query, documents);
      }

      // Update scores
      const scoreMap = new Map(reranked.map((r) => [r.id, r.score]));
      
      for (const result of toRerank) {
        const newScore = scoreMap.get(result.chunkId);
        if (newScore !== undefined) {
          result.relevanceScore = newScore;
          // Combine RRF score with relevance score
          result.rerankedScore = result.rrfScore * 0.3 + newScore * 0.7;
        } else {
          result.rerankedScore = result.rrfScore;
        }
      }

      // Re-sort by reranked score
      toRerank.sort((a, b) => (b.rerankedScore ?? 0) - (a.rerankedScore ?? 0));

      return [...toRerank, ...rest];
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError"
        ? "Cohere reranking timed out (10s)"
        : "Reranking failed";
      console.warn(`${reason}, falling back to RRF scores:`, error);
      return results;
    }
  }

  /**
   * Prepare chunk content for reranking
   */
  private prepareForRerank(chunk: CodeChunk): string {
    // Include symbols in the text for better reranking
    const symbols = chunk.symbols.map((s) => s.name).join(", ");
    const header = symbols ? `[${chunk.type}: ${symbols}]\n` : "";
    
    // Truncate content if too long (Cohere has limits)
    const maxLength = 4000;
    const content = chunk.content.length > maxLength
      ? chunk.content.slice(0, maxLength) + "..."
      : chunk.content;

    return header + content;
  }

  /**
   * Calculate confidence score based on results
   */
  /**
   * Calculate confidence score based on results.
   *
   * RRF scores are inherently small (max ≈ 1/(k+1) ≈ 0.016 with k=60),
   * so we normalize them to [0,1] before computing confidence factors.
   */
  private calculateConfidence(results: SearchResult[]): number {
    if (results.length === 0) return 0;

    // Factors:
    // 1. Top result score (normalized to RRF scale)
    // 2. Score gap between top results
    // 3. Number of high-quality matches
    // 4. Reranking confidence (if available)

    const topScore = results[0]?.score ?? 0;
    const secondScore = results[1]?.score ?? 0;
    const scoreGap = topScore - secondScore;

    // Normalize RRF scores to [0,1] range.
    // Max possible RRF score = (vectorWeight + lexicalWeight) / (rrfK + 1)
    // when a result is ranked #0 in both lists.
    const maxRRF = (this.config.vectorWeight + this.config.lexicalWeight) / (this.config.rrfK + 1);
    const normalizedTopScore = maxRRF > 0 ? Math.min(topScore / maxRRF, 1) : 0;
    const normalizedGap = maxRRF > 0 ? Math.min(scoreGap / maxRRF, 1) : 0;

    // High-quality matches (score > 0.5 of top score)
    const threshold = topScore * 0.5;
    const highQualityCount = results.filter((r) => r.score >= threshold).length;

    // Normalize factors (now using normalized scores)
    const topScoreFactor = Math.min(normalizedTopScore * 2, 1);
    const gapFactor = Math.min(normalizedGap * 5, 1);
    const countFactor = Math.min(highQualityCount / 5, 1);

    // Check if we have reranking scores
    const hasReranking = results[0]?.scores?.relevance !== undefined;
    const rerankBoost = hasReranking ? 0.1 : 0;

    // Weighted average
    return Math.min(1, topScoreFactor * 0.5 + gapFactor * 0.3 + countFactor * 0.2 + rerankBoost);
  }

  /**
   * Get suggestion based on results
   */
  private getSuggestion(
    results: SearchResult[],
    confidence: number
  ): "use_results" | "query_unclear" | "no_matches" | "low_confidence" {
    if (results.length === 0) {
      return "no_matches";
    }

    if (confidence < 0.2) {
      return "low_confidence";
    }

    if (confidence < 0.4) {
      return "query_unclear";
    }

    return "use_results";
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HybridSearchConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): HybridSearchConfig {
    return { ...this.config };
  }

  /**
   * Get search statistics
   */
  getStats(): {
    chunksRegistered: number;
    rerankingAvailable: boolean;
    config: HybridSearchConfig;
  } {
    return {
      chunksRegistered: this.chunks.size,
      rerankingAvailable: this.cohereReranker.isAvailable(),
      config: this.config,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createHybridSearcher(
  vectorStore: VectorStore,
  lexicalIndex: LexicalIndex,
  embedder: Embedder,
  config?: Partial<HybridSearchConfig>
): HybridSearcher {
  return new HybridSearcher(vectorStore, lexicalIndex, embedder, config);
}
