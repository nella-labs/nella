/**
 * LRU Cache
 *
 * Least Recently Used cache with configurable size
 * and automatic eviction of stale entries.
 */

// =============================================================================
// Types
// =============================================================================

export interface LRUCacheOptions<T> {
  /** Maximum number of items in cache */
  maxSize: number;
  /** Optional TTL in milliseconds */
  ttl?: number;
  /** Called when an item is evicted */
  onEvict?: (key: string, value: T) => void | Promise<void>;
}

interface CacheEntry<T> {
  value: T;
  createdAt: number;
  accessedAt: number;
}

// =============================================================================
// LRU Cache Class
// =============================================================================

export class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private options: LRUCacheOptions<T>;

  constructor(options: LRUCacheOptions<T>) {
    this.options = options;
  }

  /**
   * Get item from cache
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (this.isExpired(entry)) {
      this.delete(key);
      return undefined;
    }

    // Update access time and move to end (most recent)
    entry.accessedAt = Date.now();
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (this.isExpired(entry)) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Set item in cache
   */
  set(key: string, value: T): void {
    // Remove if exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict if at capacity
    while (this.cache.size >= this.options.maxSize) {
      this.evictLRU();
    }

    // Add new entry
    this.cache.set(key, {
      value,
      createdAt: Date.now(),
      accessedAt: Date.now(),
    });
  }

  /**
   * Delete item from cache
   */
  async delete(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;

    this.cache.delete(key);

    // Call onEvict callback
    if (this.options.onEvict) {
      await this.options.onEvict(key, entry.value);
    }

    return true;
  }

  /**
   * Clear entire cache
   */
  async clear(): Promise<void> {
    const entries = Array.from(this.cache.entries());
    this.cache.clear();

    // Call onEvict for all entries
    if (this.options.onEvict) {
      for (const [key, entry] of entries) {
        await this.options.onEvict(key, entry.value);
      }
    }
  }

  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get all values
   */
  values(): T[] {
    return Array.from(this.cache.values()).map((e) => e.value);
  }

  /**
   * Get cache statistics
   */
  stats(): {
    size: number;
    maxSize: number;
    oldestKey: string | null;
    newestKey: string | null;
  } {
    const keys = this.keys();
    return {
      size: this.cache.size,
      maxSize: this.options.maxSize,
      oldestKey: keys[0] || null,
      newestKey: keys[keys.length - 1] || null,
    };
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): number {
    if (!this.options.ttl) return 0;

    let cleaned = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.createdAt > this.options.ttl) {
        this.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private isExpired(entry: CacheEntry<T>): boolean {
    if (!this.options.ttl) return false;
    return Date.now() - entry.createdAt > this.options.ttl;
  }

  private async evictLRU(): Promise<void> {
    // First key is the least recently used (Map maintains insertion order)
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      await this.delete(firstKey);
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createLRUCache<T>(options: LRUCacheOptions<T>): LRUCache<T> {
  return new LRUCache<T>(options);
}
