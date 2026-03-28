# Rate Limiting

> **Internal Module** — This documentation covers internal nella infrastructure. These modules are not exported from the public `@usenella/core` package and are intended for nella platform developers only.

The Rate Limiting module provides per-key request rate limiting for the hosted MCP server. It supports multiple algorithms, backends, priority handling, and dynamic limit adjustment.

## Key Exports

- `createRateLimiter` / `RateLimiter` — main rate limiter
- `PriorityHandler` — priority-based queue management
- `DynamicLimitAdjuster` — adjust limits based on server load

## Quick Start

```ts
import { createRateLimiter } from '@usenella/core/rate-limit';

const limiter = createRateLimiter({
  backend: 'memory',
  algorithm: 'token-bucket',
  limits: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
    requestsPerDay: 10000,
  },
});

// Check if a request is allowed
const result = limiter.check('nella_abc123');
if (result.allowed) {
  // Process the request
} else {
  console.log(`Rate limited. Retry after ${result.retryAfterMs}ms`);
}

// Consume a token (after processing)
limiter.consume('nella_abc123');
```

## Backends

| Backend | Persistence | Distribution | Best For |
|---------|-------------|--------------|----------|
| `memory` | No | Single process | Development, testing |
| `redis` | Yes | Multi-process | Production, clustered |
| `sqlite` | Yes | Single process | Single-server production |

### Redis Backend

```ts
const limiter = createRateLimiter({
  backend: 'redis',
  redisUrl: process.env.REDIS_URL!,
  algorithm: 'token-bucket',
  limits: { requestsPerMinute: 100 },
});
```

### SQLite Backend

```ts
const limiter = createRateLimiter({
  backend: 'sqlite',
  dbPath: '/path/to/.nella/rate-limits.db',
  algorithm: 'sliding-window',
  limits: { requestsPerMinute: 60 },
});
```

## Algorithms

| Algorithm | Description | Pros |
|-----------|-------------|------|
| `token-bucket` | Tokens replenish at a fixed rate | Smooth, allows short bursts |
| `sliding-window` | Counts requests in a sliding time window | Precise, no burst allowance |

```ts
// Token bucket — allows bursts up to the bucket size
const tokenBucket = createRateLimiter({
  algorithm: 'token-bucket',
  limits: { requestsPerMinute: 60 },
  bucketSize: 10,  // Allow bursts of up to 10 requests
});

// Sliding window — strict per-window counting
const slidingWindow = createRateLimiter({
  algorithm: 'sliding-window',
  limits: { requestsPerMinute: 60 },
});
```

## Priority Handling

Assign priority levels to API keys for differentiated rate limiting:

```ts
import { PriorityHandler } from '@usenella/core/rate-limit';

const priority = new PriorityHandler(limiter, {
  levels: {
    critical: { multiplier: 3.0 },    // 3x the base limit
    high: { multiplier: 2.0 },
    normal: { multiplier: 1.0 },
    low: { multiplier: 0.5 },
  },
});

// Check with priority
const result = priority.check('nella_abc123', 'high');
```

## Dynamic Limit Adjustment

Automatically adjust rate limits based on server load:

```ts
import { DynamicLimitAdjuster } from '@usenella/core/rate-limit';

const adjuster = new DynamicLimitAdjuster(limiter, {
  cpuThreshold: 0.8,          // Reduce limits when CPU > 80%
  memoryThreshold: 0.9,       // Reduce limits when memory > 90%
  reductionFactor: 0.5,       // Reduce to 50% of normal limits
  checkIntervalMs: 5000,      // Check every 5 seconds
  recoveryFactor: 0.1,        // Recover 10% per interval when load drops
});

adjuster.start();

// Limits automatically adjust based on server health
// When load is high: 60 req/min → 30 req/min
// When load recovers: 30 → 33 → 36 → ... → 60
```

## Rate Limit Result

```ts
interface RateLimitResult {
  allowed: boolean;
  remaining: number;          // Requests remaining in current window
  limit: number;              // Current limit
  resetAt: Date;              // When the window resets
  retryAfterMs?: number;      // Milliseconds until next allowed request
}
```

## Configuration

```ts
interface RateLimitConfig {
  backend: 'memory' | 'redis' | 'sqlite';
  algorithm: 'token-bucket' | 'sliding-window';
  limits: {
    requestsPerMinute?: number;
    requestsPerHour?: number;
    requestsPerDay?: number;
  };
  redisUrl?: string;          // Required for redis backend
  dbPath?: string;            // Required for sqlite backend
  bucketSize?: number;        // For token-bucket algorithm
}
```

## Graceful Degradation

When the rate limit backend is unavailable (Redis down, etc.), the limiter can fall back gracefully:

```ts
const limiter = createRateLimiter({
  backend: 'redis',
  redisUrl: process.env.REDIS_URL!,
  gracefulDegradation: {
    enabled: true,
    fallbackBackend: 'memory',   // Fall back to in-memory
    logWarnings: true,
  },
});
```

## Related Docs

- [Core Modules Guide](modules.md) — All modules overview
- [Authentication](auth.md) — API key management
- [MCP Integration](../mcp/integration.md) — Server rate limits
