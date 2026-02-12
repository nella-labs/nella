/**
 * MCP Tool Result Cache
 *
 * LRU-based caching for read-only tool results.
 * Reuses the proven LRUCache from the workspace module.
 */

import * as crypto from "crypto";
import { LRUCache } from "../workspace/lru-cache";
import type { McpToolResult } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface ToolResultCacheConfig {
  /** Maximum total cache entries (default: 200) */
  maxSize: number;
  /** Default TTL in ms (default: 5 min) */
  defaultTtl: number;
  /** Per-tool TTL overrides in ms */
  toolTtl?: Record<string, number>;
  /** Tools that are cacheable (default: read-only tools) */
  cacheableTools?: string[];
}

interface CachedResult {
  result: McpToolResult;
  toolName: string;
  cachedAt: number;
}

// =============================================================================
// Default Config
// =============================================================================

const DEFAULT_CACHE_CONFIG: ToolResultCacheConfig = {
  maxSize: 200,
  defaultTtl: 5 * 60 * 1000, // 5 minutes
  toolTtl: {
    nella_search: 3 * 60 * 1000,     // 3 minutes — results may change with index
    nella_verify: 5 * 60 * 1000,     // 5 minutes — code verification is stable
    nella_get_context: 60 * 1000,    // 1 minute — context can change frequently
    nella_status: 10 * 1000,         // 10 seconds — status changes often
    nella_explain: 10 * 60 * 1000,   // 10 minutes — explanations are stable
    nella_docs: 5 * 60 * 1000,       // 5 minutes
    nella_history: 30 * 1000,        // 30 seconds — history grows
  },
  cacheableTools: [
    "nella_search",
    "nella_verify",
    "nella_get_context",
    "nella_status",
    "nella_explain",
    "nella_docs",
    "nella_history",
  ],
};

/** Tools that mutate state and should trigger cache invalidation */
const MUTATING_TOOLS = new Set([
  "nella_index",
  "nella_set_context",
]);

// =============================================================================
// Cache Class
// =============================================================================

export class ToolResultCache {
  private cache: LRUCache<CachedResult>;
  private config: ToolResultCacheConfig;
  private hits = 0;
  private misses = 0;

  constructor(config: Partial<ToolResultCacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.cache = new LRUCache<CachedResult>({
      maxSize: this.config.maxSize,
      ttl: this.config.defaultTtl,
    });
  }

  /**
   * Check if a tool call is cacheable.
   */
  isCacheable(toolName: string): boolean {
    if (this.config.cacheableTools) {
      return this.config.cacheableTools.includes(toolName);
    }
    // By default, only cache non-mutating tools
    return !MUTATING_TOOLS.has(toolName);
  }

  /**
   * Get a cached result for a tool call.
   */
  get(toolName: string, args: Record<string, unknown>): McpToolResult | undefined {
    if (!this.isCacheable(toolName)) {
      return undefined;
    }

    const key = this.buildKey(toolName, args);
    const entry = this.cache.get(key);

    if (entry) {
      // Double-check tool-specific TTL
      const ttl = this.getTtl(toolName);
      if (Date.now() - entry.cachedAt > ttl) {
        this.cache.delete(key);
        this.misses++;
        return undefined;
      }
      this.hits++;
      return entry.result;
    }

    this.misses++;
    return undefined;
  }

  /**
   * Store a tool result in cache.
   */
  set(toolName: string, args: Record<string, unknown>, result: McpToolResult): void {
    if (!this.isCacheable(toolName)) return;

    // Don't cache error results
    if (result.isError) return;

    const key = this.buildKey(toolName, args);
    this.cache.set(key, {
      result,
      toolName,
      cachedAt: Date.now(),
    });
  }

  /**
   * Invalidate cache entries based on a mutating tool call.
   *
   * - nella_index: clears search, verify, explain, docs caches
   * - nella_set_context: clears context caches
   */
  invalidate(toolName: string): void {
    if (!MUTATING_TOOLS.has(toolName)) return;

    const keysToDelete: string[] = [];

    // Determine which tool results to invalidate
    let invalidateTools: string[];
    switch (toolName) {
      case "nella_index":
        invalidateTools = ["nella_search", "nella_verify", "nella_explain", "nella_docs", "nella_status"];
        break;
      case "nella_set_context":
        invalidateTools = ["nella_get_context", "nella_status"];
        break;
      default:
        return;
    }

    // Scan cache for matching tool entries
    for (const key of this.cache.keys()) {
      const entry = this.cache.get(key);
      if (entry && invalidateTools.includes(entry.toolName)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Clear entire cache.
   */
  async clear(): Promise<void> {
    await this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics.
   */
  stats(): {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  private buildKey(toolName: string, args: Record<string, unknown>): string {
    // Deterministic key: sort args, hash
    const sortedArgs = JSON.stringify(args, Object.keys(args).sort());
    const hash = crypto.createHash("sha256").update(`${toolName}:${sortedArgs}`).digest("hex").slice(0, 16);
    return `${toolName}:${hash}`;
  }

  private getTtl(toolName: string): number {
    return this.config.toolTtl?.[toolName] ?? this.config.defaultTtl;
  }
}
