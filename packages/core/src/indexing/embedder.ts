/**
 * Embedder Module
 *
 * Handles embedding generation via Voyage AI (voyage-code-3) or Azure OpenAI.
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
  provider: "voyage",
  model: "voyage-code-3",
  dimensions: 2048,
  batchSize: 128,
  maxRetries: 3,
};

const AZURE_API_VERSION = "2024-06-01";

// Pricing per 1M tokens
const PRICING: Record<string, number> = {
  "text-embedding-3-small": 0.02,
  "text-embedding-3-large": 0.13,
  "voyage-code-3": 0.18,
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
    } catch (error) {
      // SQLite not available (better-sqlite3 not installed), will use JSON fallback
      console.debug("SQLite cache unavailable, using JSON fallback:", (error as Error).message);
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
      } catch (error) {
        console.debug("SQLite cache read error:", (error as Error).message);
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
      } catch (error) {
        console.debug("SQLite cache write error:", (error as Error).message);
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
    } catch (error) {
      console.debug("Embedding cache cleanup error:", (error as Error).message);
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
    } catch (error) {
      console.debug("JSON embedding cache load error:", (error as Error).message);
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
// Embedder Class
// =============================================================================

export class Embedder {
  private config: EmbedderConfig;
  private sqliteCache: SQLiteEmbeddingCache | null = null;
  private jsonCache: JSONEmbeddingCache | null = null;
  private confirmedVoyage = false;

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
   * Generate embeddings for a list of texts
   */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const { texts, model = this.config.model, inputType = "document" } = request;

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

      const { embeddings, tokens } = await this.callAPI(batch, model, inputType);
      totalTokens += tokens;

      // Store results and cache
      for (let j = 0; j < embeddings.length; j++) {
        const originalIndex = batchIndices[j];
        results[originalIndex] = embeddings[j];
        this.setInCache(uncachedTexts[i + j], model, embeddings[j]);
      }
    }

    // Don't save cache here — let the caller decide when to persist.
    // The index manager calls saveCache() once after all batches complete.

    // Calculate cost
    const pricePerMillion = PRICING[model] || PRICING["text-embedding-3-small"];
    const cost = (totalTokens / 1_000_000) * pricePerMillion;

    return {
      embeddings: results as number[][],
      model,
      tokensUsed: totalTokens,
      cost,
    };
  }

  /**
   * Look up an embedding in the cache without calling the API.
   * Returns null if not cached.
   */
  getFromCache(text: string, model?: string): number[] | null {
    const m = model ?? this.config.model;
    return this.sqliteCache?.get(text, m) ?? this.jsonCache?.get(text, m) ?? null;
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
  private async callAPI(texts: string[], model: string, inputType: "document" | "query" = "document"): Promise<{ embeddings: number[][]; tokens: number }> {
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        if (this.config.provider === "nella") {
          return await this.callNellaAPI(texts, model);
        }
        if (this.config.provider === "voyage") {
          return await this.callVoyageAPI(texts, model, inputType);
        }
        return await this.callAzureAPI(texts, model);
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
   * Call Azure OpenAI API
   */
  private async callAzureAPI(texts: string[], model: string): Promise<{ embeddings: number[][]; tokens: number }> {
    const apiKey = this.config.apiKey || process.env.AZURE_EMBEDDING_API_KEY;
    const endpoint = this.config.endpoint || process.env.AZURE_ENDPOINT;
    const deployment = this.config.deployment || process.env.AZURE_EMBEDDING_DEPLOYMENT || model;

    if (!apiKey) {
      throw new Error("AZURE_EMBEDDING_API_KEY not set");
    }
    if (!endpoint) {
      throw new Error("AZURE_ENDPOINT not set");
    }

    // Truncate inputs that would exceed the model's context limit (8192 tokens for text-embedding-3-small).
    // Code tokenizes at ~2-3 chars/token; use 2 chars/token for safety.
    const maxChars = 8000 * 2;
    const truncatedTexts = texts.map((t) => t.length > maxChars ? t.slice(0, maxChars) : t);

    const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/embeddings?api-version=${AZURE_API_VERSION}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        input: truncatedTexts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Azure OpenAI API error: ${response.status} ${error}`);
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
   * Call Voyage AI API (via MongoDB Atlas or direct)
   */
  private async callVoyageAPI(texts: string[], model: string, inputType: "document" | "query" = "document"): Promise<{ embeddings: number[][]; tokens: number }> {
    const apiKey = this.config.apiKey || process.env.VOYAGE_API_KEY;
    const endpoint = this.config.endpoint || process.env.VOYAGE_ENDPOINT || "https://ai.mongodb.com/v1";

    if (!apiKey) {
      throw new Error("Embedding service not configured");
    }

    // voyage-code-3 context: 32K tokens; ~2 chars/token safety factor
    const maxChars = 16000 * 2;
    const truncatedTexts = texts.map((t) => t.length > maxChars ? t.slice(0, maxChars) : t);

    const url = `${endpoint.replace(/\/$/, "")}/embeddings`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: truncatedTexts,
        model,
        input_type: inputType,
        truncation: true,
        output_dimension: this.config.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Voyage AI error (${response.status}): ${error.slice(0, 300)}`);
    }

    const data = await response.json() as {
      data: { embedding: number[]; index: number }[];
      usage: { total_tokens: number };
    };

    if (!this.confirmedVoyage) {
      const dims = data.data?.[0]?.embedding?.length ?? this.config.dimensions;
      console.error(`[nella] Voyage AI connected — ${model}, ${dims}d, endpoint=${endpoint}`);
      this.confirmedVoyage = true;
    }

    return {
      embeddings: data.data.map((d) => d.embedding),
      tokens: data.usage.total_tokens,
    };
  }

  /**
   * Call Nella's server-side embedding proxy
   */
  private async callNellaAPI(texts: string[], model: string): Promise<{ embeddings: number[][]; tokens: number }> {
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new Error("Nella auth token not set — run 'nella auth login' first");
    }

    const apiBase = this.config.apiBase || "https://app.getnella.dev/api";
    const maxChars = 8000 * 3;
    const truncatedTexts = texts.map((t) => t.length > maxChars ? t.slice(0, maxChars) : t);

    const response = await fetch(`${apiBase}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: truncatedTexts }),
    });

    if (!response.ok) {
      const raw = await response.text();
      let detail = raw;
      try {
        const parsed = JSON.parse(raw);
        // Handle nested error structures from upstream providers
        const inner = parsed.detail ? (typeof parsed.detail === 'string' ? JSON.parse(parsed.detail) : parsed.detail) : parsed;
        detail = inner?.error?.message || parsed.error || parsed.message || raw;
      } catch {
        // keep raw text
      }
      throw new Error(`Embedding service error (${response.status}): ${detail}`);
    }

    const data = await response.json() as {
      data: { embedding: number[] }[];
      usage: { total_tokens: number };
      dimensions?: number;
    };

    // Auto-detect dimensions from server response
    const serverDims = data.dimensions || data.data?.[0]?.embedding?.length;
    if (serverDims && serverDims !== this.config.dimensions) {
      this.config.dimensions = serverDims;
    }

    return {
      embeddings: data.data.map((d) => d.embedding),
      tokens: data.usage.total_tokens,
    };
  }

  /** Get the current configured dimensions */
  getDimensions(): number {
    return this.config.dimensions;
  }

  /**
   * Get a single embedding
   */
  /**
   * Embed a single text. Defaults to inputType "query" since this is
   * typically used for search queries (HybridSearcher.search).
   */
  async embedOne(text: string, inputType: "document" | "query" = "query"): Promise<{ embedding: number[]; tokensUsed: number; cost: number }> {
    const response = await this.embed({ texts: [text], inputType });
    return {
      embedding: response.embeddings[0],
      tokensUsed: response.tokensUsed,
      cost: response.cost,
    };
  }

  /**
   * Persist the embedding cache to disk.
   * Call this once after all embedding batches are complete.
   */
  saveCache(): void {
    this.jsonCache?.save();
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
