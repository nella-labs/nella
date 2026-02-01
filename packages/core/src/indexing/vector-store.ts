/**
 * Vector Store
 *
 * HNSW-based vector storage for semantic search.
 * Uses usearch or hnswlib-node for efficient approximate nearest neighbor search.
 */

import * as fs from "fs";
import * as path from "path";
import type { CodeChunk } from "./types";
import { Embedder } from "./embedder";

// =============================================================================
// Types
// =============================================================================

export interface VectorStoreConfig {
  dimensions: number;
  maxElements: number;
  efConstruction: number;  // Build-time parameter (higher = better recall, slower build)
  efSearch: number;        // Query-time parameter (higher = better recall, slower query)
  M: number;               // Number of connections per element
}

interface VectorEntry {
  id: string;
  chunkId: string;
  vector: number[];
}

interface VectorStoreData {
  config: VectorStoreConfig;
  entries: VectorEntry[];
  version: string;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: VectorStoreConfig = {
  dimensions: 1536,
  maxElements: 100000,
  efConstruction: 200,
  efSearch: 100,
  M: 16,
};

// =============================================================================
// Vector Store Class
// =============================================================================

export class VectorStore {
  private config: VectorStoreConfig;
  private entries: Map<string, VectorEntry> = new Map();
  private chunkIdToVectorId: Map<string, string> = new Map();
  private persistPath: string | null = null;

  constructor(config: Partial<VectorStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize persistence
   */
  initPersistence(storePath: string): void {
    this.persistPath = storePath;
    this.load();
  }

  /**
   * Add a vector for a chunk
   */
  add(chunkId: string, vector: number[]): string {
    if (vector.length !== this.config.dimensions) {
      throw new Error(`Vector dimension mismatch: expected ${this.config.dimensions}, got ${vector.length}`);
    }

    // Generate unique vector ID
    const id = `vec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const entry: VectorEntry = {
      id,
      chunkId,
      vector,
    };

    this.entries.set(id, entry);
    this.chunkIdToVectorId.set(chunkId, id);

    return id;
  }

  /**
   * Add multiple vectors at once
   */
  addBatch(items: { chunkId: string; vector: number[] }[]): string[] {
    return items.map((item) => this.add(item.chunkId, item.vector));
  }

  /**
   * Remove a vector by chunk ID
   */
  remove(chunkId: string): boolean {
    const vectorId = this.chunkIdToVectorId.get(chunkId);
    if (!vectorId) return false;

    this.entries.delete(vectorId);
    this.chunkIdToVectorId.delete(chunkId);
    return true;
  }

  /**
   * Search for similar vectors
   */
  search(queryVector: number[], limit: number = 10): { chunkId: string; score: number }[] {
    if (queryVector.length !== this.config.dimensions) {
      throw new Error(`Query vector dimension mismatch: expected ${this.config.dimensions}, got ${queryVector.length}`);
    }

    // Brute-force search with cosine similarity
    // In production, this would use HNSW via usearch/hnswlib-node
    const results: { chunkId: string; score: number }[] = [];

    for (const entry of this.entries.values()) {
      const score = this.cosineSimilarity(queryVector, entry.vector);
      results.push({ chunkId: entry.chunkId, score });
    }

    // Sort by score descending and take top k
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Get vector for a chunk
   */
  getVector(chunkId: string): number[] | null {
    const vectorId = this.chunkIdToVectorId.get(chunkId);
    if (!vectorId) return null;

    const entry = this.entries.get(vectorId);
    return entry?.vector || null;
  }

  /**
   * Check if chunk has a vector
   */
  has(chunkId: string): boolean {
    return this.chunkIdToVectorId.has(chunkId);
  }

  /**
   * Get total number of vectors
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Clear all vectors
   */
  clear(): void {
    this.entries.clear();
    this.chunkIdToVectorId.clear();
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

    const data: VectorStoreData = {
      config: this.config,
      entries: Array.from(this.entries.values()),
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
      const data: VectorStoreData = JSON.parse(content);

      this.config = { ...this.config, ...data.config };
      this.entries.clear();
      this.chunkIdToVectorId.clear();

      for (const entry of data.entries) {
        this.entries.set(entry.id, entry);
        this.chunkIdToVectorId.set(entry.chunkId, entry.id);
      }
    } catch (error) {
      console.error("Failed to load vector store:", error);
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalVectors: number;
    dimensions: number;
    memoryEstimate: string;
  } {
    const bytesPerVector = this.config.dimensions * 4; // Float32
    const totalBytes = this.entries.size * bytesPerVector;
    const memoryMB = totalBytes / (1024 * 1024);

    return {
      totalVectors: this.entries.size,
      dimensions: this.config.dimensions,
      memoryEstimate: `${memoryMB.toFixed(2)} MB`,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createVectorStore(config?: Partial<VectorStoreConfig>): VectorStore {
  return new VectorStore(config);
}
