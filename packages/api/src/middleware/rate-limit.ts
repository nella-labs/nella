/**
 * Rate Limiting Middleware
 *
 * Integrates with Redis (primary) and in-memory (fallback).
 * Returns standard rate limit headers on every response.
 */

import type { Request, Response, NextFunction } from "express";
import { log } from "../utils/logger";
import { sendError } from "../utils/responses";

// In-memory rate limiter (fallback when Redis unavailable)
const memoryLimiter: Map<string, { count: number; resetAt: number }> = new Map();

// Redis client — lazy init
let redisClient: any = null;

function getRedis(): any | null {
  if (redisClient !== null) return redisClient;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    redisClient = false; // never retry
    return null;
  }

  try {
    const Redis = require("ioredis");
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    redisClient.connect().catch(() => {
      redisClient = false;
    });
    return redisClient;
  } catch {
    redisClient = false;
    return null;
  }
}

/**
 * Create rate limiting middleware.
 */
export function createRateLimitMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next();
      return;
    }

    const key = `ratelimit:${req.user.apiKeyId}`;
    const limits = req.user.rateLimits;
    const windowMs = 60_000; // Per-minute window
    const maxRequests = limits.requests_per_minute;
    const now = Date.now();

    try {
      const redis = getRedis();

      if (redis && redis !== false) {
        // Redis sliding window
        const windowKey = `${key}:minute`;
        const windowStart = now - windowMs;

        const pipeline = redis.pipeline();
        pipeline.zremrangebyscore(windowKey, 0, windowStart);
        pipeline.zadd(windowKey, now, `${now}:${Math.random()}`);
        pipeline.zcard(windowKey);
        pipeline.expire(windowKey, 120);
        const results = await pipeline.exec();

        const count = results?.[2]?.[1] || 0;
        const remaining = Math.max(0, maxRequests - count);
        const resetAt = Math.ceil((now + windowMs) / 1000);

        setRateLimitHeaders(res, maxRequests, remaining, resetAt);

        if (count > maxRequests) {
          const retryAfter = Math.ceil(windowMs / 1000);
          res.set("Retry-After", String(retryAfter));
          sendError(res, req, 429, "RATE_LIMIT_EXCEEDED", "Too many requests", {
            limit: maxRequests,
            window: "1 minute",
            retryAfter,
          });
          return;
        }
      } else {
        // In-memory fallback
        const entry = memoryLimiter.get(key);

        if (!entry || now > entry.resetAt) {
          memoryLimiter.set(key, { count: 1, resetAt: now + windowMs });
          setRateLimitHeaders(res, maxRequests, maxRequests - 1, Math.ceil((now + windowMs) / 1000));
        } else {
          entry.count++;
          const remaining = Math.max(0, maxRequests - entry.count);
          setRateLimitHeaders(res, maxRequests, remaining, Math.ceil(entry.resetAt / 1000));

          if (entry.count > maxRequests) {
            const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
            res.set("Retry-After", String(retryAfter));
            sendError(res, req, 429, "RATE_LIMIT_EXCEEDED", "Too many requests", {
              limit: maxRequests,
              window: "1 minute",
              retryAfter,
            });
            return;
          }
        }
      }

      next();
    } catch (err) {
      // Rate limiting failures should not block requests
      log("warn", "Rate limiter error, allowing request", {
        error: (err as Error).message,
      });
      next();
    }
  };
}

function setRateLimitHeaders(res: Response, limit: number, remaining: number, reset: number): void {
  res.set("X-RateLimit-Limit", String(limit));
  res.set("X-RateLimit-Remaining", String(remaining));
  res.set("X-RateLimit-Reset", String(reset));
}
