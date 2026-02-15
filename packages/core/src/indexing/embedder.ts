/**
 * Embedder Module
 *
 * Handles embedding generation via OpenAI (primary), Voyage Code 2 (fallback),
 * or local ONNX models for fully offline operation.
 * Includes SQLite caching to avoid redundant API calls.
 */

import * as fs from "fs";
import * as path from "path";
import { saveBest, loadAny } from "./persistence";
import * as crypto from "crypto";
import type { EmbedderConfig, EmbeddingRequest, EmbeddingResponse } from "./types";

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: EmbedderConfig = {
  provider: "openai",
  model: "text-embedding-3-small",
  dimensions: 1536,
  batchSize: 128,
  maxRetries: 3,
};

// Pricing per 1M tokens (as of 2026)
const PRICING: Record<string, number> = {
  "voyage-code-2": 0.12,
  "text-embedding-3-small": 0.02,
  "text-embedding-3-large": 0.13,
  "local": 0, // Free!
};

// Local model configurations
const LOCAL_MODELS: Record<string, { dimensions: number; modelPath: string }> = {
  "all-MiniLM-L6-v2": { dimensions: 384, modelPath: "all-MiniLM-L6-v2" },
  "nomic-embed-text-v1": { dimensions: 768, modelPath: "nomic-embed-text-v1" },
  "bge-small-en-v1.5": { dimensions: 384, modelPath: "bge-small-en-v1.5" },
};

// =============================================================================
// SQLite Embedding Cache
// =============================================================================

interface CacheEntry {
  embedding: number[];
  model: string;
  timestamp: string;
}

interface SQLiteCacheOptions {
  maxSize?: number;  // Max entries before cleanup
  ttlDays?: number;  // TTL in days
}

class SQLiteEmbeddingCache {
  private db: any = null;
  private dbPath: string;
  private options: Required<SQLiteCacheOptions>;
  private useSQLite: boolean = false;

  constructor(cachePath: string, options: SQLiteCacheOptions = {}) {
    this.dbPath = cachePath;
    this.options = {
      maxSize: options.maxSize ?? 100000,
      ttlDays: options.ttlDays ?? 30,
    };
    this.init();
  }

  private init(): void {
    try {
      const Database = require("better-sqlite3");
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
      
      // Create table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS embeddings (
          key TEXT PRIMARY KEY,
          model TEXT NOT NULL,
          embedding BLOB NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_model ON embeddings(model);
        CREATE INDEX IF NOT EXISTS idx_created ON embeddings(created_at);
      `);

      this.useSQLite = true;
    } catch {
      // SQLite not available, will use JSON fallback
      this.useSQLite = false;
    }
  }

  private computeKey(text: string, model: string): string {
    return crypto.createHash("sha256").update(`${model}:${text}`).digest("hex").slice(0, 32);
  }

  get(text: string, model: string): number[] | null {
    const key = this.computeKey(text, model);

    if (this.useSQLite && this.db) {
      try {
        const stmt = this.db.prepare("SELECT embedding FROM embeddings WHERE key = ? AND model = ?");
        const row = stmt.get(key, model);
        if (row) {
          return this.deserializeEmbedding(row.embedding);
        }
      } catch {
        // Ignore errors
      }
    }

    return null;
  }

  set(text: string, model: string, embedding: number[]): void {
    const key = this.computeKey(text, model);

    if (this.useSQLite && this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO embeddings (key, model, embedding, created_at)
          VALUES (?, ?, ?, ?)
        `);
        stmt.run(key, model, this.serializeEmbedding(embedding), new Date().toISOString());
      } catch {
        // Ignore errors
      }
    }
  }

  private serializeEmbedding(embedding: number[]): Buffer {
    const buffer = Buffer.alloc(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) {
      buffer.writeFloatLE(embedding[i], i * 4);
    }
    return buffer;
  }

  private deserializeEmbedding(buffer: Buffer): number[] {
    const embedding: number[] = [];
    for (let i = 0; i < buffer.length; i += 4) {
      embedding.push(buffer.readFloatLE(i));
    }
    return embedding;
  }

  cleanup(): void {
    if (!this.useSQLite || !this.db) return;

    try {
      // Remove old entries
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - this.options.ttlDays);
      
      this.db.prepare("DELETE FROM embeddings WHERE created_at < ?").run(cutoff.toISOString());

      // Remove excess entries if over limit
      const count = this.db.prepare("SELECT COUNT(*) as count FROM embeddings").get().count;
      if (count > this.options.maxSize) {
        const toDelete = count - this.options.maxSize;
        this.db.prepare(`
          DELETE FROM embeddings WHERE key IN (
            SELECT key FROM embeddings ORDER BY created_at ASC LIMIT ?
          )
        `).run(toDelete);
      }

      this.db.exec("VACUUM");
    } catch {
      // Ignore cleanup errors
    }
  }

  get size(): number {
    if (!this.useSQLite || !this.db) return 0;
    try {
      return this.db.prepare("SELECT COUNT(*) as count FROM embeddings").get().count;
    } catch {
      return 0;
    }
  }

  get isUsingSQLite(): boolean {
    return this.useSQLite;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// =============================================================================
// JSON Cache Fallback
// =============================================================================

interface JSONCacheData {
  entries: Record<string, CacheEntry>;
  version: string;
}

class JSONEmbeddingCache {
  private cache: JSONCacheData;
  private cachePath: string;
  private dirty: boolean = false;

  constructor(cachePath: string) {
    this.cachePath = cachePath;
    this.cache = this.loadCache();
  }

  private loadCache(): JSONCacheData {
    try {
      const result = loadAny<JSONCacheData>(this.cachePath);
      if (result) {
        return result.data;
      }
    } catch {
      // Ignore cache errors
    }
    return { entries: {}, version: "2.0.0" };
  }

  private computeKey(text: string, model: string): string {
    return crypto.createHash("sha256").update(`${model}:${text}`).digest("hex").slice(0, 32);
  }

  get(text: string, model: string): number[] | null {
    const key = this.computeKey(text, model);
    const entry = this.cache.entries[key];
    if (entry && entry.model === model) {
      return entry.embedding;
    }
    return null;
  }

  set(text: string, model: string, embedding: number[]): void {
    const key = this.computeKey(text, model);
    this.cache.entries[key] = {
      embedding,
      model,
      timestamp: new Date().toISOString(),
    };
    this.dirty = true;
  }

  save(): void {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      saveBest(this.cachePath, this.cache);
      this.dirty = false;
    } catch (error) {
      console.error("Failed to save embedding cache:", error);
    }
  }

  clear(): void {
    this.cache.entries = {};
    this.dirty = true;
    this.save();
  }

  get size(): number {
    return Object.keys(this.cache.entries).length;
  }
}

// =============================================================================
// ONNX Local Embedder
// =============================================================================

class ONNXLocalEmbedder {
  private session: any = null;
  private tokenizer: any = null;
  private modelName: string;
  private dimensions: number;
  private available: boolean = false;

  constructor(modelName: string = "all-MiniLM-L6-v2") {
    this.modelName = modelName;
    this.dimensions = LOCAL_MODELS[modelName]?.dimensions ?? 384;
  }

  async init(modelsDir: string): Promise<boolean> {
    try {
      const ort = require("onnxruntime-node");
      
      // Look for model file
      const modelPath = path.join(modelsDir, this.modelName, "model.onnx");
      
      if (!fs.existsSync(modelPath)) {
        console.warn(`ONNX model not found at ${modelPath}`);
        return false;
      }

      this.session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ["cpu"],
      });

      // Try to load tokenizer (if available)
      const tokenizerPath = path.join(modelsDir, this.modelName, "tokenizer.json");
      if (fs.existsSync(tokenizerPath)) {
        const tokenizerData = JSON.parse(fs.readFileSync(tokenizerPath, "utf-8"));
        this.tokenizer = tokenizerData;
      }

      this.available = true;
      return true;
    } catch (error) {
      console.warn("Failed to initialize ONNX embedder:", error);
      return false;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.available || !this.session) {
      throw new Error("ONNX embedder not initialized");
    }

    const ort = require("onnxruntime-node");
    const embeddings: number[][] = [];

    for (const text of texts) {
      // Simple tokenization (character-level fallback if no tokenizer)
      const tokens = this.tokenize(text);
      
      // Create input tensors
      const inputIds = new ort.Tensor("int64", BigInt64Array.from(tokens.map(BigInt)), [1, tokens.length]);
      const attentionMask = new ort.Tensor("int64", BigInt64Array.from(tokens.map(() => 1n)), [1, tokens.length]);

      // Run inference
      const results = await this.session.run({
        input_ids: inputIds,
        attention_mask: attentionMask,
      });

      // Get embedding from last_hidden_state and mean pool
      const output = results.last_hidden_state || results.sentence_embedding || Object.values(results)[0];
      const embedding = this.meanPool(output.data, tokens.length, this.dimensions);
      
      // Normalize
      const normalized = this.normalize(embedding);
      embeddings.push(normalized);
    }

    return embeddings;
  }

  private tokenize(text: string): number[] {
    // Simple word-level tokenization with padding
    const maxLength = 512;
    const words = text.toLowerCase().split(/\s+/);
    const tokens: number[] = [101]; // [CLS]

    for (const word of words.slice(0, maxLength - 2)) {
      // Simple hash to token ID
      const hash = this.hashString(word) % 30000 + 1000;
      tokens.push(hash);
    }

    tokens.push(102); // [SEP]
    
    // Pad to fixed length
    while (tokens.length < maxLength) {
      tokens.push(0);
    }

    return tokens.slice(0, maxLength);
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private meanPool(data: Float32Array | number[], seqLength: number, hiddenSize: number): number[] {
    const embedding = new Array(hiddenSize).fill(0);
    
    for (let i = 0; i < seqLength; i++) {
      for (let j = 0; j < hiddenSize; j++) {
        embedding[j] += data[i * hiddenSize + j] || 0;
      }
    }

    return embedding.map((v) => v / seqLength);
  }

  private normalize(embedding: number[]): number[] {
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return embedding;
    return embedding.map((v) => v / norm);
  }
}

// =============================================================================
// Embedder Class
// =============================================================================

export class Embedder {
  private config: EmbedderConfig;
  private sqliteCache: SQLiteEmbeddingCache | null = null;
  private jsonCache: JSONEmbeddingCache | null = null;
  private localEmbedder: ONNXLocalEmbedder | null = null;

  constructor(config: Partial<EmbedderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize cache for embedding storage
   * Uses SQLite if available, falls back to JSON
   */
  initCache(cachePath: string): void {
    // Try SQLite first
    const sqlitePath = cachePath.endsWith(".db") ? cachePath : cachePath + ".db";
    this.sqliteCache = new SQLiteEmbeddingCache(sqlitePath);

    // If SQLite failed, use JSON fallback
    if (!this.sqliteCache.isUsingSQLite) {
      const jsonPath = cachePath.endsWith(".json") ? cachePath : cachePath + ".json";
      this.jsonCache = new JSONEmbeddingCache(jsonPath);
    }
  }

  /**
   * Initialize local ONNX embedder
   */
  async initLocalEmbedder(modelsDir: string, modelName?: string): Promise<boolean> {
    this.localEmbedder = new ONNXLocalEmbedder(modelName);
    const success = await this.localEmbedder.init(modelsDir);
    
    if (success) {
      // Update config for local embedder
      this.config.dimensions = this.localEmbedder.getDimensions();
    }

    return success;
  }

  /**
   * Generate embeddings for a list of texts
   */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const { texts, model = this.config.model } = request;

    if (texts.length === 0) {
      return {
        embeddings: [],
        model,
        tokensUsed: 0,
        cost: 0,
      };
    }

    // Check cache for existing embeddings
    const results: (number[] | null)[] = [];
    const uncachedTexts: string[] = [];
    const uncachedIndices: number[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cached = this.getFromCache(texts[i], model);
      if (cached) {
        results[i] = cached;
      } else {
        results[i] = null;
        uncachedTexts.push(texts[i]);
        uncachedIndices.push(i);
      }
    }

    // If all cached, return early
    if (uncachedTexts.length === 0) {
      return {
        embeddings: results as number[][],
        model,
        tokensUsed: 0,
        cost: 0,
      };
    }

    // Generate embeddings for uncached texts in batches
    let totalTokens = 0;
    const batchSize = this.config.batchSize;

    for (let i = 0; i < uncachedTexts.length; i += batchSize) {
      const batch = uncachedTexts.slice(i, i + batchSize);
      const batchIndices = uncachedIndices.slice(i, i + batchSize);

      const { embeddings, tokens } = await this.callAPI(batch, model);
      totalTokens += tokens;

      // Store results and cache
      for (let j = 0; j < embeddings.length; j++) {
        const originalIndex = batchIndices[j];
        results[originalIndex] = embeddings[j];
        this.setInCache(uncachedTexts[i + j], model, embeddings[j]);
      }
    }

    // Save JSON cache if using it
    this.jsonCache?.save();

    // Calculate cost
    const pricePerMillion = PRICING[model] || PRICING["voyage-code-2"];
    const cost = (totalTokens / 1_000_000) * pricePerMillion;

    return {
      embeddings: results as number[][],
      model,
      tokensUsed: totalTokens,
      cost,
    };
  }

  private getFromCache(text: string, model: string): number[] | null {
    return this.sqliteCache?.get(text, model) ?? this.jsonCache?.get(text, model) ?? null;
  }

  private setInCache(text: string, model: string, embedding: number[]): void {
    if (this.sqliteCache?.isUsingSQLite) {
      this.sqliteCache.set(text, model, embedding);
    } else {
      this.jsonCache?.set(text, model, embedding);
    }
  }

  /**
   * Call the embedding API
   */
  private async callAPI(texts: string[], model: string): Promise<{ embeddings: number[][]; tokens: number }> {
    const provider = this.config.provider;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        if (provider === "local") {
          return await this.callLocalEmbedder(texts);
        } else if (provider === "voyage") {
          return await this.callVoyageAPI(texts, model);
        } else if (provider === "openai") {
          return await this.callOpenAIAPI(texts, model);
        } else {
          // Try local first if available, fallback to openai
          if (this.localEmbedder?.isAvailable()) {
            return await this.callLocalEmbedder(texts);
          }
          return await this.callOpenAIAPI(texts, model);
        }
      } catch (error) {
        if (attempt === this.config.maxRetries - 1) {
          throw error;
        }
        // Exponential backoff
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }

    throw new Error("Failed to generate embeddings after max retries");
  }

  /**
   * Call Voyage AI API
   */
  private async callVoyageAPI(texts: string[], model: string): Promise<{ embeddings: number[][]; tokens: number }> {
    const apiKey = this.config.apiKey || process.env.VOYAGE_API_KEY;
    if (!apiKey) {
      throw new Error("VOYAGE_API_KEY not set");
    }

    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
        input_type: "document",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Voyage API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      data: { embedding: number[] }[];
      usage: { total_tokens: number };
    };

    return {
      embeddings: data.data.map((d) => d.embedding),
      tokens: data.usage.total_tokens,
    };
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAIAPI(texts: string[], model: string): Promise<{ embeddings: number[][]; tokens: number }> {
    const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not set");
    }

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      data: { embedding: number[] }[];
      usage: { total_tokens: number };
    };

    return {
      embeddings: data.data.map((d) => d.embedding),
      tokens: data.usage.total_tokens,
    };
  }

  /**
   * Call local ONNX embedder
   */
  private async callLocalEmbedder(texts: string[]): Promise<{ embeddings: number[][]; tokens: number }> {
    if (this.localEmbedder?.isAvailable()) {
      const embeddings = await this.localEmbedder.embed(texts);
      const tokens = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
      return { embeddings, tokens };
    }

    // Fallback: Generate deterministic pseudo-embeddings for testing
    console.warn("Using deterministic pseudo-embeddings - install onnxruntime-node for real local embeddings");

    const embeddings = texts.map((text) => {
      // Use hash to create deterministic but varied embeddings
      const hash = crypto.createHash("sha256").update(text).digest();
      const embedding = new Array(this.config.dimensions).fill(0).map((_, i) => {
        const byte = hash[i % hash.length];
        return (byte / 127.5) - 1; // Range [-1, 1]
      });
      
      // Normalize
      const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
      return embedding.map((v) => v / norm);
    });

    const tokens = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
    return { embeddings, tokens };
  }

  /**
   * Get a single embedding
   */
  async embedOne(text: string): Promise<{ embedding: number[]; tokensUsed: number; cost: number }> {
    const response = await this.embed({ texts: [text] });
    return {
      embedding: response.embeddings[0],
      tokensUsed: response.tokensUsed,
      cost: response.cost,
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; backend: string } {
    if (this.sqliteCache?.isUsingSQLite) {
      return { size: this.sqliteCache.size, backend: "sqlite" };
    }
    return { size: this.jsonCache?.size ?? 0, backend: "json" };
  }

  /**
   * Cleanup old cache entries
   */
  cleanupCache(): void {
    this.sqliteCache?.cleanup();
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have same length");
    }

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
}

// =============================================================================
// Re-export cache manager for backwards compatibility
// =============================================================================

export { JSONEmbeddingCache as EmbeddingCacheManager };

// =============================================================================
// Factory
// =============================================================================

export function createEmbedder(config?: Partial<EmbedderConfig>): Embedder {
  return new Embedder(config);
}
