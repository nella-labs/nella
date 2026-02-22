/**
 * Shared Redis client utility for health checks and other services.
 *
 * Lazily initializes a single Redis connection that is reused across
 * the /ready endpoint and any other code that needs Redis access.
 */

let redisClient: any = null;
let redisInitAttempted = false;

export async function getRedisClient(): Promise<any | null> {
  if (redisInitAttempted) return redisClient;
  redisInitAttempted = true;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  try {
    const Redis = require("ioredis");
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    await redisClient.connect();
    return redisClient;
  } catch {
    redisClient = null;
    return null;
  }
}

export async function pingRedis(): Promise<"ok" | "unreachable" | "not_configured"> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return "not_configured";

  try {
    const client = await getRedisClient();
    if (!client) return "unreachable";
    const pong = await client.ping();
    return pong === "PONG" ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}
