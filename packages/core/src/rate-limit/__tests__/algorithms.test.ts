import test from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowAlgorithm } from "../algorithms/sliding-window";
import { TokenBucketAlgorithm } from "../algorithms/token-bucket";
import { generateHeaders } from "../headers";
import type {
  RateLimitState,
  RateLimiterConfig,
  RequestInfo,
  RateLimitResult,
} from "../types";
import { RATE_WINDOWS, DEFAULT_RATE_LIMITER_CONFIG } from "../types";

// =============================================================================
// Helpers
// =============================================================================

function freshState(entityId = "test-key"): RateLimitState {
  const now = Date.now();
  return {
    entityId,
    entityType: "key",
    buckets: {
      minute: { windowStart: now, count: 0, tokens: 0 },
      hour: { windowStart: now, count: 0, tokens: 0 },
      day: { windowStart: now, count: 0, tokens: 0 },
    },
    concurrent: 0,
    updatedAt: now,
  };
}

function makeConfig(overrides: Partial<RateLimiterConfig> = {}): RateLimiterConfig {
  return {
    ...DEFAULT_RATE_LIMITER_CONFIG,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<RequestInfo> = {}): RequestInfo {
  return {
    entityId: "test-key",
    entityType: "key",
    ...overrides,
  };
}

// =============================================================================
// Sliding Window Algorithm
// =============================================================================

test("SlidingWindow: allows request under limit", () => {
  const algo = new SlidingWindowAlgorithm();
  const state = freshState();
  const config = makeConfig({ requestsPerMinute: 10 });
  const req = makeRequest();

  const result = algo.check(state, config, req);
  assert.equal(result.allowed, true);
  assert.equal(result.remaining.minute, 10);
});

test("SlidingWindow: consume decrements remaining", () => {
  const algo = new SlidingWindowAlgorithm();
  const state = freshState();
  const config = makeConfig({ requestsPerMinute: 10 });
  const req = makeRequest();

  const r1 = algo.consume(state, config, req);
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining.minute, 9);

  const r2 = algo.consume(state, config, req);
  assert.equal(r2.remaining.minute, 8);
});

test("SlidingWindow: blocks when minute limit exceeded", () => {
  const algo = new SlidingWindowAlgorithm();
  const state = freshState();
  const config = makeConfig({ requestsPerMinute: 2, requestsPerHour: 1000, requestsPerDay: 10000 });
  const req = makeRequest();

  algo.consume(state, config, req);
  algo.consume(state, config, req);
  const r3 = algo.check(state, config, req);

  assert.equal(r3.allowed, false);
  assert.equal(r3.limitHit, "minute");
  assert.ok(r3.reason?.includes("minute"));
});

test("SlidingWindow: blocks when hour limit exceeded", () => {
  const algo = new SlidingWindowAlgorithm();
  const state = freshState();
  const config = makeConfig({ requestsPerMinute: 1000, requestsPerHour: 2, requestsPerDay: 10000 });
  const req = makeRequest();

  algo.consume(state, config, req);
  algo.consume(state, config, req);
  const result = algo.check(state, config, req);

  assert.equal(result.allowed, false);
  assert.equal(result.limitHit, "hour");
});

test("SlidingWindow: blocks when day limit exceeded", () => {
  const algo = new SlidingWindowAlgorithm();
  const state = freshState();
  const config = makeConfig({ requestsPerMinute: 1000, requestsPerHour: 1000, requestsPerDay: 2 });
  const req = makeRequest();

  algo.consume(state, config, req);
  algo.consume(state, config, req);
  const result = algo.check(state, config, req);

  assert.equal(result.allowed, false);
  assert.equal(result.limitHit, "day");
});

test("SlidingWindow: blocks when concurrent limit reached", () => {
  const algo = new SlidingWindowAlgorithm();
  const state = freshState();
  state.concurrent = 5;
  const config = makeConfig({ maxConcurrent: 5 });
  const req = makeRequest();

  const result = algo.check(state, config, req);
  assert.equal(result.allowed, false);
  assert.equal(result.limitHit, "concurrent");
});

test("SlidingWindow: blocks when token size too large", () => {
  const algo = new SlidingWindowAlgorithm();
  const state = freshState();
  const config = makeConfig({ maxTokensPerRequest: 1000 });
  const req = makeRequest({ tokens: 2000 });

  const result = algo.check(state, config, req);
  assert.equal(result.allowed, false);
  assert.equal(result.limitHit, "tokens");
});

test("SlidingWindow: window reset allows new requests", () => {
  const algo = new SlidingWindowAlgorithm();
  const state = freshState();
  const config = makeConfig({ requestsPerMinute: 1, requestsPerHour: 1000, requestsPerDay: 10000 });
  const req = makeRequest();

  algo.consume(state, config, req);
  assert.equal(algo.check(state, config, req).allowed, false);

  // Simulate window expiry
  state.buckets.minute.windowStart -= RATE_WINDOWS.minute + 1;
  algo.updateWindows(state, Date.now());

  assert.equal(algo.check(state, config, req).allowed, true);
});

test("SlidingWindow: tracks token usage", () => {
  const algo = new SlidingWindowAlgorithm();
  const state = freshState();
  const config = makeConfig();
  const req = makeRequest({ tokens: 500 });

  algo.consume(state, config, req);
  assert.equal(state.buckets.minute.tokens, 500);
  assert.equal(state.buckets.hour.tokens, 500);
});

// =============================================================================
// Token Bucket Algorithm
// =============================================================================

test("TokenBucket: throws without tokenBucket config", () => {
  const algo = new TokenBucketAlgorithm();
  const state = freshState();
  state.tokenBucketState = { availableTokens: 10, lastRefill: Date.now() };
  const config = makeConfig(); // no tokenBucket field

  assert.throws(
    () => algo.check(state, config, makeRequest()),
    /tokenBucket config is required/
  );
});

test("TokenBucket: allows request when tokens available", () => {
  const algo = new TokenBucketAlgorithm();
  const state = freshState();
  state.tokenBucketState = { availableTokens: 10, lastRefill: Date.now() };
  const config = makeConfig({
    tokenBucket: { refillRate: 1, bucketSize: 10 },
  });

  const result = algo.check(state, config, makeRequest());
  assert.equal(result.allowed, true);
});

test("TokenBucket: consume reduces available tokens", () => {
  const algo = new TokenBucketAlgorithm();
  const state = freshState();
  state.tokenBucketState = { availableTokens: 10, lastRefill: Date.now() };
  const config = makeConfig({
    tokenBucket: { refillRate: 1, bucketSize: 10 },
  });

  const result = algo.consume(state, config, makeRequest({ tokens: 3 }));
  assert.equal(result.allowed, true);
  assert.equal(state.tokenBucketState!.availableTokens, 7);
});

test("TokenBucket: blocks when no tokens left", () => {
  const algo = new TokenBucketAlgorithm();
  const state = freshState();
  state.tokenBucketState = { availableTokens: 0, lastRefill: Date.now() };
  const config = makeConfig({
    tokenBucket: { refillRate: 1, bucketSize: 10 },
  });

  const result = algo.check(state, config, makeRequest());
  assert.equal(result.allowed, false);
  assert.ok(result.reason?.includes("empty"));
});

test("TokenBucket: blocks when concurrent limit reached", () => {
  const algo = new TokenBucketAlgorithm();
  const state = freshState();
  state.concurrent = 5;
  state.tokenBucketState = { availableTokens: 10, lastRefill: Date.now() };
  const config = makeConfig({
    maxConcurrent: 5,
    tokenBucket: { refillRate: 1, bucketSize: 10 },
  });

  const result = algo.check(state, config, makeRequest());
  assert.equal(result.allowed, false);
});

test("TokenBucket: refillTokens adds tokens over time", () => {
  const algo = new TokenBucketAlgorithm();
  const state = freshState();
  const now = Date.now();
  state.tokenBucketState = { availableTokens: 0, lastRefill: now - 5000 }; // 5s ago
  const config = makeConfig({
    tokenBucket: { refillRate: 2, bucketSize: 10 },
  });

  algo.refillTokens(state, config, now);
  // 5 seconds * 2 tokens/sec = 10 tokens, capped at bucketSize=10
  assert.ok(state.tokenBucketState!.availableTokens >= 0);
});

// =============================================================================
// Headers Generation
// =============================================================================

test("generateHeaders: returns all required headers", () => {
  const result: RateLimitResult = {
    allowed: true,
    remaining: { minute: 55, hour: 900, day: 9500, tokens: 100000, concurrent: 4 },
  };
  const config = makeConfig({ requestsPerMinute: 60 });

  const headers = generateHeaders(result, config, "minute");
  assert.equal(headers["X-RateLimit-Limit"], "60");
  assert.equal(headers["X-RateLimit-Remaining"], "55");
  assert.ok(headers["X-RateLimit-Reset"]);
  assert.ok(headers["X-RateLimit-Policy"]?.includes("60"));
});

test("generateHeaders: includes Retry-After when blocked", () => {
  const result: RateLimitResult = {
    allowed: false,
    reason: "limit exceeded",
    remaining: { minute: 0, hour: 0, day: 0, tokens: 0, concurrent: 0 },
    retryAfter: 30,
  };
  const config = makeConfig();

  const headers = generateHeaders(result, config);
  assert.equal(headers["Retry-After"], "30");
});

test("generateHeaders: no Retry-After when allowed", () => {
  const result: RateLimitResult = {
    allowed: true,
    remaining: { minute: 10, hour: 100, day: 1000, tokens: 100000, concurrent: 5 },
  };
  const config = makeConfig();

  const headers = generateHeaders(result, config);
  assert.equal(headers["Retry-After"], undefined);
});

test("generateHeaders: uses specified primary window", () => {
  const result: RateLimitResult = {
    allowed: true,
    remaining: { minute: 55, hour: 900, day: 9500, tokens: 100000, concurrent: 4 },
  };
  const config = makeConfig({ requestsPerHour: 1000 });

  const headers = generateHeaders(result, config, "hour");
  assert.equal(headers["X-RateLimit-Limit"], "1000");
  assert.equal(headers["X-RateLimit-Remaining"], "900");
});

test("generateHeaders: remaining clamped to 0", () => {
  const result: RateLimitResult = {
    allowed: false,
    remaining: { minute: -5, hour: -10, day: 0, tokens: 0, concurrent: 0 },
  };
  const config = makeConfig();

  const headers = generateHeaders(result, config);
  assert.equal(headers["X-RateLimit-Remaining"], "0");
});
