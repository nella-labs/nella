/**
 * Redis Rate Limit Backend
 *
 * Distributed rate limiting using Redis.
 * Uses atomic Lua scripts for consistent counting across instances.
 * Requires optional dependency: ioredis
 */

import type { RateLimitState, RateLimitBucket, RedisOptions } from "../types";
import { RATE_WINDOWS } from "../types";
import type { RateLimitBackend } from "./interface";

/**
 * Parse a Redis URL (redis:// or rediss://) into connection options.
 * Supports formats:
 *   redis://[:password@]host[:port][/db]
 *   rediss://[:password@]host[:port][/db]  (TLS)
 *   redis://username:password@host[:port][/db]
 */
function parseRedisUrl(url: string): RedisOptions & { tls?: boolean } {
  try {
    const parsed = new URL(url);
    const options: RedisOptions & { tls?: boolean } = {};

    options.host = parsed.hostname || "localhost";
    options.port = parsed.port ? parseInt(parsed.port, 10) : 6379;

    // Password from URL (redis://default:PASSWORD@host or redis://:PASSWORD@host)
    if (parsed.password) {
      options.password = decodeURIComponent(parsed.password);
    }

    // Database number from path (e.g., /0, /1)
    const dbPath = parsed.pathname?.replace(/^\//, "");
    if (dbPath && /^\d+$/.test(dbPath)) {
      options.db = parseInt(dbPath, 10);
    }

    // TLS for rediss:// scheme (used by Redis Cloud, Upstash, etc.)
    if (parsed.protocol === "rediss:") {
      options.tls = true;
    }

    return options;
  } catch {
    return {};
  }
}

/** Lua script for atomic bucket increment with window expiry */
const INCREMENT_SCRIPT = `
local key = KEYS[1]
local window = ARGV[1]
local amount = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local windowDuration = tonumber(ARGV[4])

local startKey = key .. ':' .. window .. ':start'
local countKey = key .. ':' .. window .. ':count'

local windowStart = tonumber(redis.call('GET', startKey) or '0')

if windowStart == 0 or (now - windowStart) >= windowDuration then
  redis.call('SET', startKey, tostring(now))
  redis.call('SET', countKey, tostring(amount))
  local ttl = math.ceil(windowDuration / 1000) + 60
  redis.call('EXPIRE', startKey, ttl)
  redis.call('EXPIRE', countKey, ttl)
  return {amount, now}
else
  local newCount = redis.call('INCRBY', countKey, amount)
  return {tonumber(newCount), windowStart}
end
`;

export class RedisBackend implements RateLimitBackend {
  private client: any = null;
  private keyPrefix: string;
  private available: boolean = false;

  constructor(options: RedisOptions = {}) {
    this.keyPrefix = options.keyPrefix || "nella:ratelimit:";

    // Resolve connection options:
    // 1. Explicit url in options
    // 2. REDIS_URL environment variable
    // 3. Explicit host/port/password in options
    // 4. Defaults (localhost:6379)
    const envUrl = process.env.REDIS_URL;
    const url = options.url || envUrl;

    if (url) {
      const parsed = parseRedisUrl(url);
      // Merge: explicit options override URL-parsed values
      this.init({
        host: options.host || parsed.host,
        port: options.port || parsed.port,
        password: options.password || parsed.password,
        db: options.db ?? parsed.db,
        keyPrefix: options.keyPrefix,
        cluster: options.cluster,
        sentinels: options.sentinels,
        tls: options.tls ?? parsed.tls,
      });
    } else {
      this.init(options);
    }
  }

  private init(options: RedisOptions & { tls?: boolean }): void {
    try {
      const Redis = require("ioredis");

      if (options.cluster && options.sentinels) {
        this.client = new Redis.Cluster(options.sentinels, {
          redisOptions: {
            password: options.password,
            db: options.db || 0,
            ...(options.tls ? { tls: {} } : {}),
          },
        });
      } else {
        this.client = new Redis({
          host: options.host || "localhost",
          port: options.port || 6379,
          password: options.password,
          db: options.db || 0,
          lazyConnect: true,
          ...(options.tls ? { tls: {} } : {}),
        });
      }

      this.client.defineCommand("rateLimitIncrement", {
        numberOfKeys: 1,
        lua: INCREMENT_SCRIPT,
      });

      this.client.connect().then(() => {
        this.available = true;
      }).catch(() => {
        this.available = false;
      });

      this.client.on("error", () => {
        this.available = false;
      });

      this.client.on("connect", () => {
        this.available = true;
      });
    } catch {
      this.available = false;
    }
  }

  private key(entityId: string): string {
    return `${this.keyPrefix}${entityId}`;
  }

  async getState(entityId: string): Promise<RateLimitState | null> {
    if (!this.available || !this.client) return null;

    try {
      const stateKey = this.key(entityId) + ":state";
      const data = await this.client.get(stateKey);
      if (!data) return null;
      return JSON.parse(data) as RateLimitState;
    } catch {
      return null;
    }
  }

  async setState(entityId: string, state: RateLimitState): Promise<void> {
    if (!this.available || !this.client) return;

    try {
      const stateKey = this.key(entityId) + ":state";
      const ttl = Math.ceil(RATE_WINDOWS.day / 1000) + 3600; // day + 1 hour buffer
      await this.client.setex(stateKey, ttl, JSON.stringify(state));
    } catch {
      // Silently fail - rate limiting should not crash the app
    }
  }

  async deleteState(entityId: string): Promise<void> {
    if (!this.available || !this.client) return;

    try {
      const prefix = this.key(entityId);
      const keys = await this.client.keys(`${prefix}*`);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch {
      // Silently fail
    }
  }

  async incrementBucket(
    entityId: string,
    window: string,
    amount: number,
  ): Promise<{ newCount: number; windowStart: number }> {
    if (!this.available || !this.client) {
      return { newCount: amount, windowStart: Date.now() };
    }

    try {
      const duration = RATE_WINDOWS[window as keyof typeof RATE_WINDOWS];
      if (!duration) {
        return { newCount: amount, windowStart: Date.now() };
      }

      const result = await (this.client as any).rateLimitIncrement(
        this.key(entityId),
        window,
        amount,
        Date.now(),
        duration,
      );

      return {
        newCount: Number(result[0]),
        windowStart: Number(result[1]),
      };
    } catch {
      return { newCount: amount, windowStart: Date.now() };
    }
  }

  async adjustConcurrent(entityId: string, delta: number): Promise<number> {
    if (!this.available || !this.client) return 0;

    try {
      const concurrentKey = this.key(entityId) + ":concurrent";
      if (delta > 0) {
        const result = await this.client.incrby(concurrentKey, delta);
        await this.client.expire(concurrentKey, 3600);
        return Number(result);
      } else {
        const result = await this.client.incrby(concurrentKey, delta);
        const value = Math.max(0, Number(result));
        if (value === 0) {
          await this.client.del(concurrentKey);
        }
        return value;
      }
    } catch {
      return 0;
    }
  }

  async getAllEntityIds(): Promise<string[]> {
    if (!this.available || !this.client) return [];

    try {
      const keys: string[] = await this.client.keys(`${this.keyPrefix}*:state`);
      return keys.map((k: string) =>
        k.replace(this.keyPrefix, "").replace(":state", ""),
      );
    } catch {
      return [];
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  async cleanup(maxAge: number): Promise<number> {
    // Redis handles expiry natively via TTL, but we can clean up stale state entries
    if (!this.available || !this.client) return 0;

    try {
      const entityIds = await this.getAllEntityIds();
      let removed = 0;

      for (const entityId of entityIds) {
        const state = await this.getState(entityId);
        if (state && Date.now() - state.updatedAt > maxAge && state.concurrent === 0) {
          await this.deleteState(entityId);
          removed++;
        }
      }

      return removed;
    } catch {
      return 0;
    }
  }

  async exportState(): Promise<Map<string, RateLimitState>> {
    const result = new Map<string, RateLimitState>();
    if (!this.available || !this.client) return result;

    try {
      const entityIds = await this.getAllEntityIds();
      for (const entityId of entityIds) {
        const state = await this.getState(entityId);
        if (state) {
          result.set(entityId, state);
        }
      }
    } catch {
      // Return what we have
    }

    return result;
  }

  async importState(states: Map<string, RateLimitState>): Promise<void> {
    if (!this.available || !this.client) return;

    for (const [entityId, state] of states) {
      await this.setState(entityId, state);
    }
  }

  async destroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        // Force disconnect
        try {
          this.client.disconnect();
        } catch {
          // Already disconnected
        }
      }
      this.client = null;
      this.available = false;
    }
  }
}
