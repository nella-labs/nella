/**
 * Embedder Module
 *
 * Handles embedding generation via Voyage Code 2 (primary) or OpenAI (fallback).
 * Includes caching to avoid redundant API calls.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { EmbedderConfig, EmbeddingRequest, EmbeddingResponse } from "./types";

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: EmbedderConfig = {
  provider: "voyage",
  model: "voyage-code-2",
  dimensions: 1536,
  batchSize: 128,
  maxRetries: 3,
};

// Pricing per 1M tokens (as of 2026)
const PRICING: Record<string, number> = {
  "voyage-code-2": 0.12,
  "text-embedding-3-small": 0.02,
  "text-embedding-3-large": 0.13,
};

// =============================================================================
// Embedding Cache
// =============================================================================

interface CacheEntry {
  embedding: number[];
  model: string;
  timestamp: string;
}

interface EmbeddingCache {
  entries: Record<string, CacheEntry>;
  version: string;
}

export class EmbeddingCacheManager {
  private cache: EmbeddingCache;
  private cachePath: string;
  private dirty: boolean = false;

  constructor(cachePath: string) {
    this.cachePath = cachePath;
    this.cache = this.loadCache();
  }

  private loadCache(): EmbeddingCache {
    try {
      if (fs.existsSync(this.cachePath)) {
        const data = fs.readFileSync(this.cachePath, "utf-8");
        return JSON.parse(data);
      }
    } catch {
      // Ignore cache errors, start fresh
    }
    return { entries: {}, version: "1.0.0" };
  }

  private computeKey(text: string, model: string): string {
    const hash = crypto.createHash("sha256").update(`${model}:${text}`).digest("hex");
    return hash.slice(0, 32);
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
      fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
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
  private cache: EmbeddingCacheManager | null = null;

  constructor(config: Partial<EmbedderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize cache for embedding storage
   */
  initCache(cachePath: string): void {
    this.cache = new EmbeddingCacheManager(cachePath);
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
      const cached = this.cache?.get(texts[i], model);
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
        this.cache?.set(uncachedTexts[i + j], model, embeddings[j]);
      }
    }

    // Save cache
    this.cache?.save();

    // Calculate cost
    const pricePerMillion = PRICING[model] || 0.10;
    const cost = (totalTokens / 1_000_000) * pricePerMillion;

    return {
      embeddings: results as number[][],
      model,
      tokensUsed: totalTokens,
      cost,
    };
  }

  /**
   * Call the embedding API
   */
  private async callAPI(texts: string[], model: string): Promise<{ embeddings: number[][]; tokens: number }> {
    const provider = this.config.provider;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        if (provider === "voyage") {
          return await this.callVoyageAPI(texts, model);
        } else if (provider === "openai") {
          return await this.callOpenAIAPI(texts, model);
        } else {
          return await this.callLocalEmbedder(texts);
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
   * Local embedding fallback (placeholder for local models)
   */
  private async callLocalEmbedder(texts: string[]): Promise<{ embeddings: number[][]; tokens: number }> {
    // Placeholder: Generate random embeddings for testing
    // In production, this would call a local model like nomic-embed-text
    console.warn("Using placeholder local embeddings - not for production use");

    const embeddings = texts.map(() => {
      const embedding = new Array(this.config.dimensions).fill(0).map(() => Math.random() * 2 - 1);
      // Normalize
      const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
      return embedding.map((v) => v / norm);
    });

    // Rough token estimate
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
// Factory
// =============================================================================

export function createEmbedder(config?: Partial<EmbedderConfig>): Embedder {
  return new Embedder(config);
}
