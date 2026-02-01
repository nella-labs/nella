/**
 * Hybrid Search
 *
 * Combines semantic (vector) and lexical (BM25) search using
 * Reciprocal Rank Fusion (RRF) for optimal results.
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
}

interface RankedResult {
  chunkId: string;
  semanticRank: number | null;
  lexicalRank: number | null;
  semanticScore: number;
  lexicalScore: number;
  rrfScore: number;
  rerankedScore?: number;
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
  rerankEnabled: false,
  rerankTopK: 20,
};

// =============================================================================
// Hybrid Searcher Class
// =============================================================================

export class HybridSearcher {
  private config: HybridSearchConfig;
  private vectorStore: VectorStore;
  private lexicalIndex: LexicalIndex;
  private embedder: Embedder;
  private chunks: Map<string, CodeChunk> = new Map();

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

    // Semantic search
    if (mode === "hybrid" || mode === "semantic") {
      const { embedding, tokensUsed, cost } = await this.embedder.embedOne(query.query);
      embeddingTokens = tokensUsed;
      embeddingCost = cost;

      const fetchCount = mode === "hybrid" ? limit * 5 : limit;
      semanticResults = this.vectorStore.search(embedding, fetchCount);
    }

    // Lexical search
    if (mode === "hybrid" || mode === "lexical") {
      const fetchCount = mode === "hybrid" ? limit * 5 : limit;
      lexicalResults = this.lexicalIndex.search(query.query, fetchCount);
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

    // Rerank if enabled (placeholder for Cohere integration)
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

      // File type filter
      if (filter.fileTypes && filter.fileTypes.length > 0) {
        const ext = chunk.filePath.split(".").pop()?.toLowerCase();
        if (!ext || !filter.fileTypes.includes(ext)) {
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
   * Rerank results using cross-encoder (placeholder)
   */
  private async rerank(query: string, results: RankedResult[]): Promise<RankedResult[]> {
    // Take top N for reranking
    const toRerank = results.slice(0, this.config.rerankTopK);
    const rest = results.slice(this.config.rerankTopK);

    // Placeholder: In production, call Cohere Rerank API
    // For now, just add a small boost based on query term overlap
    for (const result of toRerank) {
      const chunk = this.chunks.get(result.chunkId);
      if (!chunk) continue;

      const queryTerms = query.toLowerCase().split(/\s+/);
      const contentLower = chunk.content.toLowerCase();
      const symbolsLower = chunk.symbols.map((s) => s.name.toLowerCase());

      let overlap = 0;
      for (const term of queryTerms) {
        if (contentLower.includes(term)) overlap++;
        if (symbolsLower.some((s) => s.includes(term))) overlap += 2;
      }

      result.rerankedScore = result.rrfScore * (1 + overlap * 0.1);
    }

    // Re-sort by reranked score
    toRerank.sort((a, b) => (b.rerankedScore ?? 0) - (a.rerankedScore ?? 0));

    return [...toRerank, ...rest];
  }

  /**
   * Calculate confidence score based on results
   */
  private calculateConfidence(results: SearchResult[]): number {
    if (results.length === 0) return 0;

    // Factors:
    // 1. Top result score
    // 2. Score gap between top results
    // 3. Number of high-quality matches

    const topScore = results[0]?.score ?? 0;
    const secondScore = results[1]?.score ?? 0;
    const scoreGap = topScore - secondScore;

    // High-quality matches (score > 0.5 of top score)
    const threshold = topScore * 0.5;
    const highQualityCount = results.filter((r) => r.score >= threshold).length;

    // Normalize factors
    const topScoreFactor = Math.min(topScore * 2, 1); // Assume max useful score is 0.5
    const gapFactor = Math.min(scoreGap * 5, 1);      // Large gap = more confident
    const countFactor = Math.min(highQualityCount / 5, 1); // More matches = better

    // Weighted average
    return topScoreFactor * 0.5 + gapFactor * 0.3 + countFactor * 0.2;
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
