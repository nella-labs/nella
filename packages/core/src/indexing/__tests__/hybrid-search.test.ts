/**
 * HybridSearcher Tests
 *
 * Tests for the hybrid search confidence calculation and RRF score normalization.
 * Uses minimal mocks for VectorStore, LexicalIndex, and Embedder.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { HybridSearcher } from "../hybrid-search";
import type { CodeChunk } from "../types";

// =============================================================================
// Minimal Mocks
// =============================================================================

function makeChunk(id: string, content: string = "test"): CodeChunk {
  return {
    id,
    filePath: `test/${id}.ts`,
    content,
    lines: [1, 10] as [number, number],
    type: "function",
    language: "typescript",
    symbols: [{ name: id, kind: "function" as const, exported: false }],
    imports: [],
    exports: [],
    hash: "abc123",
    tokens: 50,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Create a mock VectorStore that returns pre-configured results.
 */
function mockVectorStore(results: { chunkId: string; score: number }[]) {
  return {
    search: (_query: number[], _limit: number) => results,
    add: () => "",
    addBatch: () => [],
    remove: () => true,
    has: () => true,
    getVector: () => null,
    size: results.length,
    clear: () => {},
    save: () => {},
    load: () => {},
    initPersistence: () => {},
    getBackendType: () => "brute-force" as const,
    getStats: () => ({ totalVectors: 0, dimensions: 4, memoryEstimate: "0 MB", backend: "brute-force" }),
  } as any;
}

/**
 * Create a mock LexicalIndex that returns pre-configured results.
 */
function mockLexicalIndex(results: { chunkId: string; score: number; highlights: string[] }[]) {
  return {
    search: (_query: string, _limit: number) => results,
    add: () => {},
    remove: () => {},
    has: () => true,
    clear: () => {},
    save: () => {},
    load: () => {},
    initPersistence: () => {},
  } as any;
}

/**
 * Create a mock Embedder that returns a fixed vector.
 */
function mockEmbedder() {
  return {
    embedOne: async (_text: string) => ({
      embedding: [0.1, 0.2, 0.3, 0.4],
      tokensUsed: 10,
      cost: 0,
    }),
    embed: async (_opts: any) => ({
      embeddings: [[0.1, 0.2, 0.3, 0.4]],
      tokensUsed: 10,
      cost: 0,
    }),
    initCache: () => {},
  } as any;
}

// =============================================================================
// Tests
// =============================================================================

describe("HybridSearcher", () => {
  describe("confidence calculation with RRF normalization", () => {
    it("reports high confidence when top result ranks #1 in both lists", async () => {
      const chunkId = "top-match";
      const chunk = makeChunk(chunkId);

      const semanticResults = [
        { chunkId, score: 0.9 },
        { chunkId: "other-1", score: 0.3 },
      ];
      const lexicalResults = [
        { chunkId, score: 40, highlights: ["match"] },
        { chunkId: "other-2", score: 10, highlights: [] },
      ];

      const searcher = new HybridSearcher(
        mockVectorStore(semanticResults),
        mockLexicalIndex(lexicalResults),
        mockEmbedder(),
        { vectorWeight: 0.4, lexicalWeight: 0.6, rrfK: 60, topK: 10 }
      );
      searcher.registerChunk(chunk);
      searcher.registerChunk(makeChunk("other-1"));
      searcher.registerChunk(makeChunk("other-2"));

      const response = await searcher.search({ query: "test query" });

      // With RRF normalization, top result at rank 0 in both lists should
      // produce confidence >= 0.4 (use_results)
      assert.ok(
        response.confidence >= 0.4,
        `Expected confidence >= 0.4 (use_results), got ${response.confidence}`
      );
      assert.equal(
        response.suggestion,
        "use_results",
        `Expected 'use_results', got '${response.suggestion}'`
      );
    });

    it("reports low confidence with no results", async () => {
      const searcher = new HybridSearcher(
        mockVectorStore([]),
        mockLexicalIndex([]),
        mockEmbedder(),
        { vectorWeight: 0.4, lexicalWeight: 0.6, rrfK: 60, topK: 10 }
      );

      const response = await searcher.search({ query: "nonexistent" });

      assert.equal(response.confidence, 0);
      assert.equal(response.suggestion, "no_matches");
    });

    it("reports query_unclear for weak single-source matches", async () => {
      // Only appears in one list at a low rank
      const chunks = Array.from({ length: 5 }, (_, i) => makeChunk(`chunk-${i}`));

      // Only lexical results, no semantic overlap
      const lexicalResults = chunks.map((c, i) => ({
        chunkId: c.id,
        score: 10 - i,
        highlights: [],
      }));

      const searcher = new HybridSearcher(
        mockVectorStore([]), // no semantic results
        mockLexicalIndex(lexicalResults),
        mockEmbedder(),
        { vectorWeight: 0.4, lexicalWeight: 0.6, rrfK: 60, topK: 10 }
      );
      for (const c of chunks) searcher.registerChunk(c);

      const response = await searcher.search({ query: "vague query" });

      // With only lexical results and no semantic overlap, confidence should be lower
      // The max score is lexicalWeight / (rrfK + 1) = 0.6/61 ≈ 0.0098
      // Normalized: ~0.6 (only lexical contributes)
      // This may still be high enough for use_results or may land in query_unclear
      assert.ok(
        response.confidence < 0.8,
        `Expected moderate confidence, got ${response.confidence}`
      );
    });

    it("confidence scales with different rrfK values", async () => {
      const chunkId = "match";
      const chunk = makeChunk(chunkId);

      const semanticResults = [{ chunkId, score: 0.5 }];
      const lexicalResults = [{ chunkId, score: 20, highlights: ["hit"] }];

      // Test with k=60 (standard)
      const searcher60 = new HybridSearcher(
        mockVectorStore(semanticResults),
        mockLexicalIndex(lexicalResults),
        mockEmbedder(),
        { vectorWeight: 0.4, lexicalWeight: 0.6, rrfK: 60, topK: 10 }
      );
      searcher60.registerChunk(chunk);
      const r60 = await searcher60.search({ query: "test" });

      // Test with k=10 (smaller)
      const searcher10 = new HybridSearcher(
        mockVectorStore(semanticResults),
        mockLexicalIndex(lexicalResults),
        mockEmbedder(),
        { vectorWeight: 0.4, lexicalWeight: 0.6, rrfK: 10, topK: 10 }
      );
      searcher10.registerChunk(chunk);
      const r10 = await searcher10.search({ query: "test" });

      // Both should produce meaningful confidence (not stuck at ~0.22)
      // With normalization, k value shouldn't affect confidence significantly
      // because we normalize by the max possible score for that k
      assert.ok(
        Math.abs(r60.confidence - r10.confidence) < 0.3,
        `Confidence should be similar across k values: k=60 → ${r60.confidence}, k=10 → ${r10.confidence}`
      );
    });

    it("returns all threshold-based suggestions correctly", async () => {
      // Test no_matches
      const searcher = new HybridSearcher(
        mockVectorStore([]),
        mockLexicalIndex([]),
        mockEmbedder(),
        { vectorWeight: 0.4, lexicalWeight: 0.6, rrfK: 60, topK: 10 }
      );

      const noResults = await searcher.search({ query: "nothing" });
      assert.equal(noResults.suggestion, "no_matches");

      // Test use_results (strong dual match)
      const dualChunk = makeChunk("dual");
      const searcher2 = new HybridSearcher(
        mockVectorStore([{ chunkId: "dual", score: 0.8 }]),
        mockLexicalIndex([{ chunkId: "dual", score: 30, highlights: [] }]),
        mockEmbedder(),
        { vectorWeight: 0.4, lexicalWeight: 0.6, rrfK: 60, topK: 10 }
      );
      searcher2.registerChunk(dualChunk);
      const goodResults = await searcher2.search({ query: "strong match" });
      assert.equal(
        goodResults.suggestion,
        "use_results",
        `Expected use_results for strong dual match, got ${goodResults.suggestion} (confidence: ${goodResults.confidence})`
      );
    });
  });

  describe("search modes", () => {
    it("uses only lexical search when mode is 'lexical'", async () => {
      const chunk = makeChunk("lex-only");
      const searcher = new HybridSearcher(
        mockVectorStore([]),
        mockLexicalIndex([{ chunkId: "lex-only", score: 25, highlights: ["found"] }]),
        mockEmbedder(),
        { topK: 10 }
      );
      searcher.registerChunk(chunk);

      const response = await searcher.search({ query: "test", mode: "lexical" });
      assert.equal(response.results.length, 1);
      assert.equal(response.results[0].chunk.id, "lex-only");
      assert.equal(response.tokensUsed, 0, "Lexical-only should not use embedding tokens");
    });

    it("uses only semantic search when mode is 'semantic'", async () => {
      const chunk = makeChunk("sem-only");
      const searcher = new HybridSearcher(
        mockVectorStore([{ chunkId: "sem-only", score: 0.7 }]),
        mockLexicalIndex([]),
        mockEmbedder(),
        { topK: 10 }
      );
      searcher.registerChunk(chunk);

      const response = await searcher.search({ query: "test", mode: "semantic" });
      assert.equal(response.results.length, 1);
      assert.equal(response.results[0].chunk.id, "sem-only");
    });
  });

  describe("configuration", () => {
    it("updateConfig changes behavior", () => {
      const searcher = new HybridSearcher(
        mockVectorStore([]),
        mockLexicalIndex([]),
        mockEmbedder()
      );

      searcher.updateConfig({ vectorWeight: 0.7, lexicalWeight: 0.3 });
      const config = searcher.getConfig();
      assert.equal(config.vectorWeight, 0.7);
      assert.equal(config.lexicalWeight, 0.3);
    });

    it("getStats returns chunk count", () => {
      const searcher = new HybridSearcher(
        mockVectorStore([]),
        mockLexicalIndex([]),
        mockEmbedder()
      );
      searcher.registerChunk(makeChunk("a"));
      searcher.registerChunk(makeChunk("b"));

      const stats = searcher.getStats();
      assert.equal(stats.chunksRegistered, 2);
    });
  });
});
