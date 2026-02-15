/**
 * Lexical Index
 *
 * BM25-based full-text search with Porter stemming and fuzzy matching.
 * Optimized for code identifiers and exact matches.
 */

import * as fs from "fs";
import * as path from "path";
import type { CodeChunk } from "./types";
import { saveBest, loadAny } from "./persistence";

// =============================================================================
// Types
// =============================================================================

export interface LexicalIndexConfig {
  fields: string[];           // Fields to index
  storeFields: string[];      // Fields to store in results
  boost: Record<string, number>; // Field boost weights
  fuzzy: number;              // Fuzzy matching threshold (0-1)
  prefix: boolean;            // Enable prefix search
  stemming: boolean;          // Enable Porter stemming
  stopWords: boolean;         // Filter stop words
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
  stemming: true,
  stopWords: true,
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
// Porter Stemmer (built-in fallback)
// =============================================================================

class PorterStemmer {
  private naturalStemmer: any = null;

  constructor() {
    try {
      const natural = require("natural");
      this.naturalStemmer = natural.PorterStemmer;
    } catch {
      // Use built-in simplified stemmer
    }
  }

  stem(word: string): string {
    if (this.naturalStemmer) {
      return this.naturalStemmer.stem(word);
    }
    return this.simpleStem(word);
  }

  /**
   * Simplified stemmer fallback (handles common cases)
   */
  private simpleStem(word: string): string {
    const lower = word.toLowerCase();
    
    // Common suffix removal
    if (lower.endsWith("ing")) {
      if (lower.length > 4) {
        const base = lower.slice(0, -3);
        // Double consonant check
        if (base.endsWith(base[base.length - 1]) && !"aeiou".includes(base[base.length - 1])) {
          return base.slice(0, -1);
        }
        return base;
      }
    }
    if (lower.endsWith("ed")) {
      if (lower.length > 3) {
        return lower.slice(0, -2);
      }
    }
    if (lower.endsWith("s") && !lower.endsWith("ss")) {
      if (lower.length > 2) {
        if (lower.endsWith("ies")) {
          return lower.slice(0, -3) + "y";
        }
        if (lower.endsWith("es")) {
          return lower.slice(0, -2);
        }
        return lower.slice(0, -1);
      }
    }
    if (lower.endsWith("ly")) {
      if (lower.length > 3) {
        return lower.slice(0, -2);
      }
    }
    if (lower.endsWith("tion")) {
      return lower.slice(0, -4) + "t";
    }
    if (lower.endsWith("ment")) {
      return lower.slice(0, -4);
    }
    if (lower.endsWith("ness")) {
      return lower.slice(0, -4);
    }
    if (lower.endsWith("able") || lower.endsWith("ible")) {
      return lower.slice(0, -4);
    }
    
    return lower;
  }

  tokenizeAndStem(text: string): string[] {
    if (this.naturalStemmer) {
      const natural = require("natural");
      return natural.PorterStemmer.tokenizeAndStem(text);
    }
    
    // Fallback tokenization
    const tokens = text
      .toLowerCase()
      .split(/[\s\.,;:!?\-_'"()\[\]{}|\\/<>@#$%^&*+=`~]+/)
      .filter((t) => t.length > 1);
    
    return tokens.map((t) => this.stem(t));
  }
}

// =============================================================================
// Stop Words
// =============================================================================

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "has", "he", "in", "is", "it", "its", "of", "on", "or", "that",
  "the", "to", "was", "were", "will", "with",
  // Code-specific stop words
  "var", "let", "const", "function", "class", "return", "if", "else",
  "this", "new", "true", "false", "null", "undefined",
]);

// =============================================================================
// Fuzzy Matching (Levenshtein Distance)
// =============================================================================

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // Deletion
        matrix[i][j - 1] + 1,      // Insertion
        matrix[i - 1][j - 1] + cost // Substitution
      );
    }
  }

  return matrix[a.length][b.length];
}

function fuzzyMatch(query: string, target: string, threshold: number): boolean {
  const distance = levenshteinDistance(query.toLowerCase(), target.toLowerCase());
  const maxLen = Math.max(query.length, target.length);
  const similarity = 1 - distance / maxLen;
  return similarity >= (1 - threshold);
}

// =============================================================================
// Lexical Index Class
// =============================================================================

export class LexicalIndex {
  private config: LexicalIndexConfig;
  private documents: Map<string, IndexedDocument> = new Map();
  private chunkIdToDocId: Map<string, string> = new Map();

  // Inverted index: term -> { docId -> termFrequency }
  private invertedIndex: Map<string, Map<string, number>> = new Map();

  // Also keep unstemmed index for exact matches
  private unstemmedIndex: Map<string, Map<string, number>> = new Map();

  // Document stats
  private docLengths: Map<string, number> = new Map();
  private avgDocLength: number = 0;
  private totalDocs: number = 0;

  private persistPath: string | null = null;
  private bm25: BM25Params = DEFAULT_BM25;
  private stemmer: PorterStemmer;

  constructor(config: Partial<LexicalIndexConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stemmer = new PorterStemmer();
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
    const rawTerms = this.tokenize(query);
    const stemmedTerms = this.config.stemming
      ? rawTerms.map((t) => this.stemmer.stem(t))
      : rawTerms;

    if (rawTerms.length === 0) {
      return [];
    }

    // Calculate BM25 scores for each document
    const scores: Map<string, number> = new Map();
    const highlights: Map<string, Set<string>> = new Map();

    // Search both stemmed and unstemmed indexes
    const searchTerms = [
      ...stemmedTerms.map((t) => ({ term: t, stemmed: true })),
      ...rawTerms.map((t) => ({ term: t, stemmed: false })),
    ];

    for (const { term, stemmed } of searchTerms) {
      const matchingTerms = this.getMatchingTerms(term, stemmed);

      for (const matchTerm of matchingTerms) {
        const index = stemmed ? this.invertedIndex : this.unstemmedIndex;
        const postings = index.get(matchTerm);
        if (!postings) continue;

        const idf = this.calculateIDF(postings.size);

        for (const [docId, tf] of postings) {
          const docLength = this.docLengths.get(docId) || 0;
          const bm25Score = this.calculateBM25(tf, docLength, idf);

          // Apply field boost if we can determine which field matched
          const doc = this.documents.get(docId);
          let boost = 1.0;
          if (doc) {
            const lowerTerm = term.toLowerCase();
            if (doc.symbols.toLowerCase().includes(lowerTerm)) {
              boost = this.config.boost.symbols || 1.0;
            }
          }

          // Exact match bonus (unstemmed match)
          if (!stemmed) {
            boost *= 1.5;
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
    this.unstemmedIndex.clear();
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
      version: "2.0.0",
    };

    saveBest(this.persistPath, data);
  }

  /**
   * Load from disk
   */
  load(): void {
    if (!this.persistPath) return;

    const result = loadAny<LexicalIndexData>(this.persistPath);
    if (!result) return;

    try {
      const data = result.data;

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
    const rawTerms = this.tokenize(text);

    // Filter stop words if enabled
    const filteredTerms = this.config.stopWords
      ? rawTerms.filter((t) => !STOP_WORDS.has(t.toLowerCase()))
      : rawTerms;

    // Stem terms if enabled
    const stemmedTerms = this.config.stemming
      ? filteredTerms.map((t) => this.stemmer.stem(t))
      : filteredTerms;

    // Count term frequencies for stemmed index
    const stemmedFreqs: Map<string, number> = new Map();
    for (const term of stemmedTerms) {
      stemmedFreqs.set(term, (stemmedFreqs.get(term) || 0) + 1);
    }

    // Count term frequencies for unstemmed index
    const unstemmedFreqs: Map<string, number> = new Map();
    for (const term of filteredTerms) {
      const lower = term.toLowerCase();
      unstemmedFreqs.set(lower, (unstemmedFreqs.get(lower) || 0) + 1);
    }

    // Add to stemmed inverted index
    for (const [term, freq] of stemmedFreqs) {
      if (!this.invertedIndex.has(term)) {
        this.invertedIndex.set(term, new Map());
      }
      this.invertedIndex.get(term)!.set(doc.id, freq);
    }

    // Add to unstemmed inverted index
    for (const [term, freq] of unstemmedFreqs) {
      if (!this.unstemmedIndex.has(term)) {
        this.unstemmedIndex.set(term, new Map());
      }
      this.unstemmedIndex.get(term)!.set(doc.id, freq);
    }

    // Update document stats
    this.docLengths.set(doc.id, stemmedTerms.length);
    this.totalDocs++;
    this.updateAvgDocLength();
  }

  private removeFromIndex(doc: IndexedDocument): void {
    const text = [doc.content, doc.symbols, doc.filePath].join(" ");
    const rawTerms = this.tokenize(text);
    const stemmedTerms = this.config.stemming
      ? rawTerms.map((t) => this.stemmer.stem(t))
      : rawTerms;

    // Remove from stemmed index
    for (const term of new Set(stemmedTerms)) {
      const postings = this.invertedIndex.get(term);
      if (postings) {
        postings.delete(doc.id);
        if (postings.size === 0) {
          this.invertedIndex.delete(term);
        }
      }
    }

    // Remove from unstemmed index
    for (const term of new Set(rawTerms.map((t) => t.toLowerCase()))) {
      const postings = this.unstemmedIndex.get(term);
      if (postings) {
        postings.delete(doc.id);
        if (postings.size === 0) {
          this.unstemmedIndex.delete(term);
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
    // Split on whitespace and punctuation, keep case for unstemmed
    return text
      .split(/[\s\.,;:!?\-_'"()\[\]{}|\\/<>@#$%^&*+=`~]+/)
      .filter((token) => token.length > 1);
  }

  private getMatchingTerms(term: string, useStemmed: boolean): string[] {
    const index = useStemmed ? this.invertedIndex : this.unstemmedIndex;
    const matches: string[] = [];
    const lowerTerm = term.toLowerCase();

    // Exact match
    if (index.has(lowerTerm)) {
      matches.push(lowerTerm);
    }

    // Prefix matching
    if (this.config.prefix) {
      for (const indexTerm of index.keys()) {
        if (indexTerm.startsWith(lowerTerm) && indexTerm !== lowerTerm) {
          matches.push(indexTerm);
        }
      }
    }

    // Fuzzy matching (only if no exact/prefix matches and threshold > 0)
    if (matches.length === 0 && this.config.fuzzy > 0) {
      for (const indexTerm of index.keys()) {
        if (fuzzyMatch(lowerTerm, indexTerm, this.config.fuzzy)) {
          matches.push(indexTerm);
        }
      }
    }

    return matches.length > 0 ? matches : [lowerTerm];
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
    uniqueUnstemmedTerms: number;
    avgDocLength: number;
    stemmingEnabled: boolean;
  } {
    return {
      totalDocuments: this.totalDocs,
      uniqueTerms: this.invertedIndex.size,
      uniqueUnstemmedTerms: this.unstemmedIndex.size,
      avgDocLength: this.avgDocLength,
      stemmingEnabled: this.config.stemming,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createLexicalIndex(config?: Partial<LexicalIndexConfig>): LexicalIndex {
  return new LexicalIndex(config);
}
