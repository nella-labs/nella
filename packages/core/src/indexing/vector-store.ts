/**
 * Vector Store
 *
 * HNSW-based vector storage for semantic search.
 * Uses usearch for efficient approximate nearest neighbor search
 * with fallback to brute-force for environments without native deps.
 */

import * as fs from "fs";
import * as path from "path";
import type { CodeChunk } from "./types";
import { saveBest, loadAny, compressedPath, removePersistedFile } from "./persistence";

// =============================================================================
// Types
// =============================================================================

export interface VectorStoreConfig {
  dimensions: number;
  maxElements: number;
  efConstruction: number;  // Build-time parameter (higher = better recall, slower build)
  efSearch: number;        // Query-time parameter (higher = better recall, slower query)
  M: number;               // Number of connections per element
  backend: "hnsw" | "hnswlib" | "brute-force" | "auto";  // Backend selection
  metric: "cosine" | "l2" | "ip";  // Distance metric
}

interface VectorEntry {
  id: string;
  chunkId: string;
  vector: number[];
}

/** Slim entry for v2 persistence (vectors stored only in backend file) */
interface VectorEntrySlim {
  id: string;
  chunkId: string;
}

interface VectorStoreData {
  config: VectorStoreConfig;
  entries: VectorEntry[] | VectorEntrySlim[];
  version: string;
  formatVersion?: number; // 2 = deduplicated (no vectors in metadata)
}

// =============================================================================
// Vector Backend Interface
// =============================================================================

export interface VectorBackend {
  add(id: number, vector: Float32Array): void;
  addBatch(startId: number, vectors: Float32Array[]): void;
  search(query: Float32Array, limit: number): { id: number; distance: number }[];
  remove(id: number): boolean;
  size: number;
  save(path: string): void;
  load(path: string): void;
  clear(): void;
}

// =============================================================================
// HNSW Backend (using usearch)
// =============================================================================

class HNSWBackend implements VectorBackend {
  private index: any;  // usearch.Index type
  private config: VectorStoreConfig;
  private count: number = 0;

  constructor(config: VectorStoreConfig) {
    this.config = config;
    this.initIndex();
  }

  private initIndex(): void {
    try {
      // Dynamic import to handle environments without native deps
      const usearch = require("usearch");
      
      this.index = new usearch.Index({
        metric: this.config.metric === "cosine" ? "cos" :
                this.config.metric === "ip" ? "ip" : "l2sq",
        connectivity: this.config.M,
        dimensions: this.config.dimensions,
        quantization: "f32",
      });
    } catch (error) {
      throw new Error(`Failed to initialize HNSW: ${error}`);
    }
  }

  add(id: number, vector: Float32Array): void {
    this.index.add(BigInt(id), vector);
    this.count++;
  }

  addBatch(startId: number, vectors: Float32Array[]): void {
    for (let i = 0; i < vectors.length; i++) {
      this.add(startId + i, vectors[i]);
    }
  }

  search(query: Float32Array, limit: number): { id: number; distance: number }[] {
    const results = this.index.search(query, Math.min(limit, this.count));
    
    return Array.from({ length: results.count }, (_, i) => ({
      id: Number(results.keys[i]),
      distance: results.distances[i],
    }));
  }

  remove(id: number): boolean {
    try {
      this.index.remove(BigInt(id));
      this.count--;
      return true;
    } catch {
      return false;
    }
  }

  get size(): number {
    return this.count;
  }

  save(filepath: string): void {
    this.index.save(filepath);
  }

  load(filepath: string): void {
    if (fs.existsSync(filepath)) {
      this.index.load(filepath);
      this.count = this.index.size();
    }
  }

  clear(): void {
    this.initIndex();
    this.count = 0;
  }
}

// =============================================================================
// HNSWLib Backend (using hnswlib-node)
// =============================================================================

class HNSWLibBackend implements VectorBackend {
  private index: any; // HierarchicalNSW type
  private config: VectorStoreConfig;
  private count: number = 0;
  private HierarchicalNSW: any;

  constructor(config: VectorStoreConfig) {
    this.config = config;
    this.initIndex();
  }

  private initIndex(): void {
    try {
      const hnswlib = require("hnswlib-node");
      this.HierarchicalNSW = hnswlib.HierarchicalNSW;

      const space = this.config.metric === "cosine" ? "cosine"
        : this.config.metric === "ip" ? "ip" : "l2";

      this.index = new this.HierarchicalNSW(space, this.config.dimensions);
      this.index.initIndex(this.config.maxElements, this.config.M, this.config.efConstruction);
      this.index.setEf(this.config.efSearch);
    } catch (error) {
      throw new Error(`Failed to initialize hnswlib-node: ${error}`);
    }
  }

  add(id: number, vector: Float32Array): void {
    this.index.addPoint(Array.from(vector), id);
    this.count++;
  }

  addBatch(startId: number, vectors: Float32Array[]): void {
    for (let i = 0; i < vectors.length; i++) {
      this.add(startId + i, vectors[i]);
    }
  }

  search(query: Float32Array, limit: number): { id: number; distance: number }[] {
    if (this.count === 0) return [];

    const k = Math.min(limit, this.count);
    const result = this.index.searchKnn(Array.from(query), k);

    const results: { id: number; distance: number }[] = [];
    for (let i = 0; i < result.neighbors.length; i++) {
      const id = result.neighbors[i];
      let distance = result.distances[i];

      // hnswlib returns distance; convert to similarity for cosine/ip
      if (this.config.metric === "cosine") {
        distance = 1 - distance; // hnswlib cosine distance → similarity
      }

      results.push({ id, distance });
    }

    // Sort: higher similarity first for cosine/ip, lower distance first for l2
    if (this.config.metric === "cosine" || this.config.metric === "ip") {
      results.sort((a, b) => b.distance - a.distance);
    } else {
      results.sort((a, b) => a.distance - b.distance);
    }

    return results;
  }

  remove(id: number): boolean {
    try {
      this.index.markDelete(id);
      this.count--;
      return true;
    } catch {
      return false;
    }
  }

  get size(): number {
    return this.count;
  }

  save(filepath: string): void {
    this.index.writeIndexSync(filepath);
  }

  load(filepath: string): void {
    if (fs.existsSync(filepath)) {
      this.index.readIndexSync(filepath);
      this.count = this.index.getCurrentCount();
    }
  }

  clear(): void {
    this.initIndex();
    this.count = 0;
  }
}

// =============================================================================
// Brute-Force Backend (fallback)
// =============================================================================

class BruteForceBackend implements VectorBackend {
  private vectors: Map<number, Float32Array> = new Map();
  private config: VectorStoreConfig;

  constructor(config: VectorStoreConfig) {
    this.config = config;
  }

  add(id: number, vector: Float32Array): void {
    this.vectors.set(id, vector);
  }

  addBatch(startId: number, vectors: Float32Array[]): void {
    for (let i = 0; i < vectors.length; i++) {
      this.add(startId + i, vectors[i]);
    }
  }

  search(query: Float32Array, limit: number): { id: number; distance: number }[] {
    const results: { id: number; distance: number }[] = [];

    for (const [id, vector] of this.vectors) {
      const distance = this.computeDistance(query, vector);
      results.push({ id, distance });
    }

    // Sort by distance (ascending for l2, descending for similarity)
    results.sort((a, b) => {
      if (this.config.metric === "cosine" || this.config.metric === "ip") {
        return b.distance - a.distance;  // Higher similarity is better
      }
      return a.distance - b.distance;  // Lower distance is better
    });

    return results.slice(0, limit);
  }

  private computeDistance(a: Float32Array, b: Float32Array): number {
    if (this.config.metric === "cosine") {
      return this.cosineSimilarity(a, b);
    } else if (this.config.metric === "ip") {
      return this.innerProduct(a, b);
    } else {
      return this.l2Distance(a, b);
    }
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  private innerProduct(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  private l2Distance(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  remove(id: number): boolean {
    return this.vectors.delete(id);
  }

  get size(): number {
    return this.vectors.size;
  }

  save(filepath: string): void {
    const data = {
      vectors: Array.from(this.vectors.entries()).map(([id, vec]) => ({
        id,
        vector: Array.from(vec),
      })),
    };
    saveBest(filepath, data);
  }

  load(filepath: string): void {
    try {
      const result = loadAny<{ vectors: { id: number; vector: number[] }[] }>(filepath);
      if (!result) return;

      this.vectors.clear();
      for (const entry of result.data.vectors) {
        this.vectors.set(entry.id, new Float32Array(entry.vector));
      }
    } catch (error) {
      console.debug("Brute-force vector store load error:", (error as Error).message);
    }
  }

  clear(): void {
    this.vectors.clear();
  }
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
  backend: "auto",
  metric: "cosine",
};

// =============================================================================
// Vector Store Class
// =============================================================================

export class VectorStore {
  private config: VectorStoreConfig;
  private backend: VectorBackend;
  private entries: Map<string, VectorEntry> = new Map();
  private chunkIdToVectorId: Map<string, string> = new Map();
  private idToNumericId: Map<string, number> = new Map();
  private numericIdToId: Map<number, string> = new Map();
  private nextNumericId: number = 0;
  private persistPath: string | null = null;
  private metadataPath: string | null = null;

  constructor(config: Partial<VectorStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.backend = this.createBackend();
  }

  private createBackend(): VectorBackend {
    if (this.config.backend === "brute-force") {
      return new BruteForceBackend(this.config);
    }

    if (this.config.backend === "hnsw") {
      return new HNSWBackend(this.config);
    }

    if (this.config.backend === "hnswlib") {
      return new HNSWLibBackend(this.config);
    }

    // Auto-detect: try usearch HNSW → hnswlib-node → brute-force
    try {
      return new HNSWBackend(this.config);
    } catch {
      try {
        return new HNSWLibBackend(this.config);
      } catch {
        console.warn("HNSW backends unavailable (usearch, hnswlib-node), using brute-force fallback");
        return new BruteForceBackend(this.config);
      }
    }
  }

  /**
   * Get the current backend type
   */
  getBackendType(): "hnsw" | "hnswlib" | "brute-force" {
    if (this.backend instanceof HNSWBackend) return "hnsw";
    if (this.backend instanceof HNSWLibBackend) return "hnswlib";
    return "brute-force";
  }

  /**
   * Initialize persistence
   */
  initPersistence(storePath: string): void {
    this.persistPath = storePath;
    this.metadataPath = storePath + ".meta.json";
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
    const numericId = this.nextNumericId++;

    const entry: VectorEntry = {
      id,
      chunkId,
      vector,
    };

    // Add to backend
    this.backend.add(numericId, new Float32Array(vector));

    // Store mappings
    this.entries.set(id, entry);
    this.chunkIdToVectorId.set(chunkId, id);
    this.idToNumericId.set(id, numericId);
    this.numericIdToId.set(numericId, id);

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

    const numericId = this.idToNumericId.get(vectorId);
    if (numericId !== undefined) {
      this.backend.remove(numericId);
      this.idToNumericId.delete(vectorId);
      this.numericIdToId.delete(numericId);
    }

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

    if (this.backend.size === 0) {
      return [];
    }

    const query = new Float32Array(queryVector);
    const rawResults = this.backend.search(query, limit);

    // Convert results
    const results: { chunkId: string; score: number }[] = [];

    for (const result of rawResults) {
      const vectorId = this.numericIdToId.get(result.id);
      if (!vectorId) continue;

      const entry = this.entries.get(vectorId);
      if (!entry) continue;

      // Convert distance to score
      let score: number;
      if (this.config.metric === "cosine" || this.config.metric === "ip") {
        score = result.distance;  // Already similarity
      } else {
        // Convert L2 distance to similarity
        score = 1 / (1 + result.distance);
      }

      results.push({ chunkId: entry.chunkId, score });
    }

    return results;
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
    this.backend.clear();
    this.entries.clear();
    this.chunkIdToVectorId.clear();
    this.idToNumericId.clear();
    this.numericIdToId.clear();
    this.nextNumericId = 0;
  }

  /**
   * Save to disk
   */
  save(): void {
    if (!this.persistPath || !this.metadataPath) return;

    const dir = path.dirname(this.persistPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Save HNSW index (backend stores the raw vectors)
    this.backend.save(this.persistPath);

    // Save metadata — v2: exclude vector arrays (they live in the backend file)
    const slimEntries: VectorEntrySlim[] = Array.from(this.entries.values()).map(e => ({
      id: e.id,
      chunkId: e.chunkId,
    }));

    const metadata: VectorStoreData = {
      config: this.config,
      entries: slimEntries,
      version: "2.0.0",
      formatVersion: 2,
    };

    saveBest(this.metadataPath, metadata);
  }

  /**
   * Load from disk
   */
  load(): void {
    if (!this.persistPath || !this.metadataPath) return;

    // Load metadata first (try compressed, then JSON)
    const metaResult = loadAny<VectorStoreData>(this.metadataPath);
    if (metaResult) {
      try {
        const data = metaResult.data;

        this.config = { ...this.config, ...data.config };
        this.entries.clear();
        this.chunkIdToVectorId.clear();
        this.idToNumericId.clear();
        this.numericIdToId.clear();

        // Rebuild mappings
        let maxNumericId = 0;
        for (let i = 0; i < data.entries.length; i++) {
          const entry = data.entries[i];
          // v2 format: entries may not have vectors (stored in backend)
          const fullEntry: VectorEntry = {
            id: entry.id,
            chunkId: entry.chunkId,
            vector: (entry as VectorEntry).vector || [],
          };
          this.entries.set(entry.id, fullEntry);
          this.chunkIdToVectorId.set(entry.chunkId, entry.id);
          this.idToNumericId.set(entry.id, i);
          this.numericIdToId.set(i, entry.id);
          maxNumericId = Math.max(maxNumericId, i);
        }
        this.nextNumericId = maxNumericId + 1;
      } catch (error) {
        console.error("Failed to load vector store metadata:", error);
        return;
      }
    }

    // Load backend index (try compressed path, then raw path)
    const compPath = compressedPath(this.persistPath);
    const backendPath = fs.existsSync(compPath) ? compPath
      : fs.existsSync(this.persistPath) ? this.persistPath
      : null;

    if (backendPath) {
      try {
        this.backend.load(backendPath);
      } catch (error) {
        console.error("Failed to load vector index:", error);
        // Rebuild index from entries if load fails
        this.rebuildIndex();
      }
    }
  }

  /**
   * Rebuild index from stored entries
   */
  private rebuildIndex(): void {
    this.backend.clear();
    for (const [id, entry] of this.entries) {
      const numericId = this.idToNumericId.get(id);
      if (numericId !== undefined) {
        this.backend.add(numericId, new Float32Array(entry.vector));
      }
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalVectors: number;
    dimensions: number;
    memoryEstimate: string;
    backend: string;
  } {
    const bytesPerVector = this.config.dimensions * 4; // Float32
    const totalBytes = this.entries.size * bytesPerVector;
    const memoryMB = totalBytes / (1024 * 1024);

    return {
      totalVectors: this.entries.size,
      dimensions: this.config.dimensions,
      memoryEstimate: `${memoryMB.toFixed(2)} MB`,
      backend: this.getBackendType(),
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createVectorStore(config?: Partial<VectorStoreConfig>): VectorStore {
  return new VectorStore(config);
}
