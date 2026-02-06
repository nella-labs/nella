/**
 * Rate Limit Backends
 *
 * Factory and exports for rate limit storage backends.
 */

export type { RateLimitBackend } from "./interface";
export { MemoryBackend } from "./memory";
export { RedisBackend } from "./redis";
export { SQLiteBackend } from "./sqlite";

import type { BackendType, RedisOptions, RateLimitEvent } from "../types";
import type { RateLimitBackend } from "./interface";
import { MemoryBackend } from "./memory";
import { RedisBackend } from "./redis";
import { SQLiteBackend } from "./sqlite";

export interface BackendFactoryOptions {
  type: BackendType;
  redisOptions?: RedisOptions;
  sqlitePath?: string;
  persistPath?: string;
  onEvent?: (event: RateLimitEvent) => void;
}

/**
 * Create a rate limit backend with auto-detection and fallback.
 */
export function createBackend(options: BackendFactoryOptions): RateLimitBackend {
  const emit = options.onEvent || (() => {});

  switch (options.type) {
    case "redis": {
      const backend = new RedisBackend(options.redisOptions);
      if (backend.isAvailable()) {
        emit({ type: "rate:backend:connected", backend: "redis" });
        return backend;
      }
      emit({
        type: "rate:backend:fallback",
        from: "redis",
        to: "memory",
        reason: "ioredis not available or connection failed",
      });
      return createMemoryBackend(options, emit);
    }

    case "sqlite": {
      const backend = new SQLiteBackend(options.sqlitePath || "rate-limit.db");
      if (backend.isAvailable()) {
        emit({ type: "rate:backend:connected", backend: "sqlite" });
        return backend;
      }
      emit({
        type: "rate:backend:fallback",
        from: "sqlite",
        to: "memory",
        reason: "better-sqlite3 not available",
      });
      return createMemoryBackend(options, emit);
    }

    case "auto": {
      // Try Redis -> SQLite -> Memory
      const redis = new RedisBackend(options.redisOptions);
      if (redis.isAvailable()) {
        emit({ type: "rate:backend:connected", backend: "redis" });
        return redis;
      }

      const sqlite = new SQLiteBackend(options.sqlitePath || "rate-limit.db");
      if (sqlite.isAvailable()) {
        emit({
          type: "rate:backend:fallback",
          from: "redis",
          to: "sqlite",
          reason: "Redis not available, using SQLite",
        });
        return sqlite;
      }

      emit({
        type: "rate:backend:fallback",
        from: "sqlite",
        to: "memory",
        reason: "Neither Redis nor SQLite available",
      });
      return createMemoryBackend(options, emit);
    }

    case "memory":
    default: {
      emit({ type: "rate:backend:connected", backend: "memory" });
      return createMemoryBackend(options, emit);
    }
  }
}

function createMemoryBackend(
  options: BackendFactoryOptions,
  _emit: (event: RateLimitEvent) => void,
): MemoryBackend {
  const backend = new MemoryBackend();
  if (options.persistPath) {
    backend.initPersistence(options.persistPath);
  }
  return backend;
}
