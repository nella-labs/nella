/**
 * Health Routes
 *
 * GET /health  — Liveness probe
 * GET /ready   — Readiness probe (dependency checks)
 * GET /ready?deep=true — Extended diagnostics (auth, job queues)
 * GET /metrics — Prometheus-compatible metrics (placeholder)
 */

import { Router, type Request, type Response } from "express";
import { pingRedis, getRedisClient } from "../utils/redis";

const startedAt = Date.now();
let version = "0.0.0";
try { version = require("../../package.json").version; } catch {}

export function healthRouter(): Router {
  const router = Router();

  // Liveness
  router.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "nella-api",
      version,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness
  router.get("/ready", async (req: Request, res: Response) => {
    const deep = req.query.deep === "true";
    const checks: Record<string, string> = {};

    // Supabase check — actual connectivity
    try {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        checks.supabase = "missing_config";
      } else {
        const { createClient } = require("@supabase/supabase-js");
        const client = createClient(url, key, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error } = await client.from("organizations").select("id").limit(1);
        checks.supabase = error ? "error" : "ok";
      }
    } catch {
      checks.supabase = "error";
    }

    // Redis check — actual PING
    try {
      checks.redis = await pingRedis();
    } catch {
      checks.redis = "error";
    }

    // Deep mode: extended diagnostics
    if (deep) {
      // Auth service probe
      try {
        const url = process.env.SUPABASE_URL;
        if (url) {
          const resp = await fetch(`${url}/auth/v1/health`, {
            signal: AbortSignal.timeout(5000),
          });
          checks.auth_service = resp.ok ? "ok" : "degraded";
        } else {
          checks.auth_service = "not_configured";
        }
      } catch {
        checks.auth_service = "unreachable";
      }

      // Job queue probe
      try {
        const client = await getRedisClient();
        if (client) {
          await client.keys("bull:nella:*");
          checks.job_queues = "ok";
        } else {
          checks.job_queues = "redis_unavailable";
        }
      } catch {
        checks.job_queues = "error";
      }
    }

    const allOk = Object.values(checks).every((v) => v === "ok");
    res.status(allOk ? 200 : 503).json({
      status: allOk ? "ready" : "degraded",
      checks,
      version,
      timestamp: new Date().toISOString(),
      ...(deep ? { mode: "deep" } : {}),
    });
  });

  // Metrics placeholder (Phase 11.10)
  router.get("/metrics", (_req: Request, res: Response) => {
    res.set("Content-Type", "text/plain");
    res.send(
      [
        `# HELP nella_api_uptime_seconds Server uptime in seconds`,
        `# TYPE nella_api_uptime_seconds gauge`,
        `nella_api_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
        `# HELP nella_api_info Server version info`,
        `# TYPE nella_api_info gauge`,
        `nella_api_info{version="${version}"} 1`,
      ].join("\n") + "\n"
    );
  });

  return router;
}
