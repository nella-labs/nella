/**
 * Lexical Index
 *
 * BM25-based full-text search using MiniSearch.
 * Optimized for code identifiers and exact matches.
 */

import * as fs from "fs";
import * as path from "path";
import type { CodeChunk } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface LexicalIndexConfig {
  fields: string[];           // Fields to index
  storeFields: string[];      // Fields to store in results
  boost: Record<string, number>; // Field boost weights
  fuzzy: number;              // Fuzzy matching threshold (0-1)
  prefix: boolean;            // Enable prefix search
}

interface IndexedDocument {
  id: string;
  chunkId: string;
  content: string;
  symbols: string;
  filePath: string;
  type: string;
}

interface LexicalIndexData {
  documents: IndexedDocument[];
  config: LexicalIndexConfig;
  version: string;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: LexicalIndexConfig = {
  fields: ["content", "symbols", "filePath"],
  storeFields: ["chunkId", "filePath", "type"],
  boost: {
    symbols: 2.0,    // Boost exact symbol matches
    content: 1.0,
    filePath: 0.5,
  },
  fuzzy: 0.2,
  prefix: true,
};

// =============================================================================
// Simple BM25 Implementation
// =============================================================================

interface BM25Params {
  k1: number;  // Term frequency saturation (1.2-2.0)
  b: number;   // Document length normalization (0.75)
}

const DEFAULT_BM25: BM25Params = {
  k1: 1.5,
  b: 0.75,
};

// =============================================================================
// Lexical Index Class
// =============================================================================

export class LexicalIndex {
  private config: LexicalIndexConfig;
  private documents: Map<string, IndexedDocument> = new Map();
  private chunkIdToDocId: Map<string, string> = new Map();

  // Inverted index: term -> { docId -> termFrequency }
  private invertedIndex: Map<string, Map<string, number>> = new Map();

  // Document stats
  private docLengths: Map<string, number> = new Map();
  private avgDocLength: number = 0;
  private totalDocs: number = 0;

  private persistPath: string | null = null;
  private bm25: BM25Params = DEFAULT_BM25;

  constructor(config: Partial<LexicalIndexConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize persistence
   */
  initPersistence(indexPath: string): void {
    this.persistPath = indexPath;
    this.load();
  }

  /**
   * Add a chunk to the index
   */
  add(chunk: CodeChunk): string {
    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const doc: IndexedDocument = {
      id: docId,
      chunkId: chunk.id,
      content: chunk.content,
      symbols: chunk.symbols.map((s) => s.name).join(" "),
      filePath: chunk.filePath,
      type: chunk.type,
    };

    this.documents.set(docId, doc);
    this.chunkIdToDocId.set(chunk.id, docId);

    // Index the document
    this.indexDocument(doc);

    return docId;
  }

  /**
   * Add multiple chunks at once
   */
  addBatch(chunks: CodeChunk[]): string[] {
    return chunks.map((chunk) => this.add(chunk));
  }

  /**
   * Remove a chunk from the index
   */
  remove(chunkId: string): boolean {
    const docId = this.chunkIdToDocId.get(chunkId);
    if (!docId) return false;

    const doc = this.documents.get(docId);
    if (doc) {
      this.removeFromIndex(doc);
    }

    this.documents.delete(docId);
    this.chunkIdToDocId.delete(chunkId);
    return true;
  }

  /**
   * Search the index
   */
  search(query: string, limit: number = 10): { chunkId: string; score: number; highlights: string[] }[] {
    const queryTerms = this.tokenize(query);

    if (queryTerms.length === 0) {
      return [];
    }

    // Calculate BM25 scores for each document
    const scores: Map<string, number> = new Map();
    const highlights: Map<string, Set<string>> = new Map();

    for (const term of queryTerms) {
      const matchingTerms = this.config.prefix
        ? this.getPrefixMatches(term)
        : [term];

      for (const matchTerm of matchingTerms) {
        const postings = this.invertedIndex.get(matchTerm);
        if (!postings) continue;

        const idf = this.calculateIDF(postings.size);

        for (const [docId, tf] of postings) {
          const docLength = this.docLengths.get(docId) || 0;
          const bm25Score = this.calculateBM25(tf, docLength, idf);

          // Apply field boost if we can determine which field matched
          const doc = this.documents.get(docId);
          let boost = 1.0;
          if (doc) {
            if (doc.symbols.toLowerCase().includes(term.toLowerCase())) {
              boost = this.config.boost.symbols || 1.0;
            }
          }

          const currentScore = scores.get(docId) || 0;
          scores.set(docId, currentScore + bm25Score * boost);

          // Track highlights
          if (!highlights.has(docId)) {
            highlights.set(docId, new Set());
          }
          highlights.get(docId)!.add(matchTerm);
        }
      }
    }

    // Sort by score and return top results
    const results = Array.from(scores.entries())
      .map(([docId, score]) => {
        const doc = this.documents.get(docId)!;
        return {
          chunkId: doc.chunkId,
          score,
          highlights: Array.from(highlights.get(docId) || []),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return results;
  }

  /**
   * Check if chunk is indexed
   */
  has(chunkId: string): boolean {
    return this.chunkIdToDocId.has(chunkId);
  }

  /**
   * Get total number of indexed documents
   */
  get size(): number {
    return this.documents.size;
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.documents.clear();
    this.chunkIdToDocId.clear();
    this.invertedIndex.clear();
    this.docLengths.clear();
    this.avgDocLength = 0;
    this.totalDocs = 0;
  }

  /**
   * Save to disk
   */
  save(): void {
    if (!this.persistPath) return;

    const dir = path.dirname(this.persistPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data: LexicalIndexData = {
      documents: Array.from(this.documents.values()),
      config: this.config,
      version: "1.0.0",
    };

    fs.writeFileSync(this.persistPath, JSON.stringify(data));
  }

  /**
   * Load from disk
   */
  load(): void {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;

    try {
      const content = fs.readFileSync(this.persistPath, "utf-8");
      const data: LexicalIndexData = JSON.parse(content);

      this.config = { ...this.config, ...data.config };
      this.clear();

      // Re-index all documents
      for (const doc of data.documents) {
        this.documents.set(doc.id, doc);
        this.chunkIdToDocId.set(doc.chunkId, doc.id);
        this.indexDocument(doc);
      }
    } catch (error) {
      console.error("Failed to load lexical index:", error);
    }
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private indexDocument(doc: IndexedDocument): void {
    // Combine all text fields
    const text = [doc.content, doc.symbols, doc.filePath].join(" ");
    const terms = this.tokenize(text);

    // Count term frequencies
    const termFreqs: Map<string, number> = new Map();
    for (const term of terms) {
      termFreqs.set(term, (termFreqs.get(term) || 0) + 1);
    }

    // Add to inverted index
    for (const [term, freq] of termFreqs) {
      if (!this.invertedIndex.has(term)) {
        this.invertedIndex.set(term, new Map());
      }
      this.invertedIndex.get(term)!.set(doc.id, freq);
    }

    // Update document stats
    this.docLengths.set(doc.id, terms.length);
    this.totalDocs++;
    this.updateAvgDocLength();
  }

  private removeFromIndex(doc: IndexedDocument): void {
    const text = [doc.content, doc.symbols, doc.filePath].join(" ");
    const terms = this.tokenize(text);

    // Remove from inverted index
    for (const term of new Set(terms)) {
      const postings = this.invertedIndex.get(term);
      if (postings) {
        postings.delete(doc.id);
        if (postings.size === 0) {
          this.invertedIndex.delete(term);
        }
      }
    }

    // Update stats
    this.docLengths.delete(doc.id);
    this.totalDocs--;
    this.updateAvgDocLength();
  }

  private updateAvgDocLength(): void {
    if (this.totalDocs === 0) {
      this.avgDocLength = 0;
      return;
    }

    let total = 0;
    for (const length of this.docLengths.values()) {
      total += length;
    }
    this.avgDocLength = total / this.totalDocs;
  }

  private tokenize(text: string): string[] {
    // Split on whitespace and punctuation, lowercase
    return text
      .toLowerCase()
      .split(/[\s\.,;:!?\-_'"()\[\]{}|\\/<>@#$%^&*+=`~]+/)
      .filter((token) => token.length > 1);
  }

  private getPrefixMatches(prefix: string): string[] {
    const matches: string[] = [];
    const lowerPrefix = prefix.toLowerCase();

    for (const term of this.invertedIndex.keys()) {
      if (term.startsWith(lowerPrefix)) {
        matches.push(term);
      }
    }

    return matches.length > 0 ? matches : [prefix];
  }

  private calculateIDF(docFreq: number): number {
    // IDF = log((N - n + 0.5) / (n + 0.5))
    const N = this.totalDocs;
    const n = docFreq;
    return Math.log((N - n + 0.5) / (n + 0.5) + 1);
  }

  private calculateBM25(tf: number, docLength: number, idf: number): number {
    const { k1, b } = this.bm25;
    const avgdl = this.avgDocLength || 1;

    // BM25 formula
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (docLength / avgdl));

    return idf * (numerator / denominator);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalDocuments: number;
    uniqueTerms: number;
    avgDocLength: number;
  } {
    return {
      totalDocuments: this.totalDocs,
      uniqueTerms: this.invertedIndex.size,
      avgDocLength: this.avgDocLength,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createLexicalIndex(config?: Partial<LexicalIndexConfig>): LexicalIndex {
  return new LexicalIndex(config);
}
