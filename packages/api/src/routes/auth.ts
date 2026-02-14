/**
 * Auth API
 *
 * API key CRUD, agent registration, usage stats.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { sendSuccess, sendCreated, sendNoContent, sendError } from "../utils/responses";
import { validateBody } from "../middleware/validation";
import { requireScope } from "../middleware/auth";
import { log } from "../utils/logger";

// =============================================================================
// Schemas
// =============================================================================

const createKeySchema = z.object({
  name: z.string().min(1).max(255),
  scopes: z.array(z.string()).optional(),
  rateLimits: z.object({
    requestsPerMinute: z.number().int().min(1).max(10000).optional(),
    requestsPerHour: z.number().int().min(1).max(100000).optional(),
    requestsPerDay: z.number().int().min(1).max(1000000).optional(),
  }).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

const registerAgentSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(["claude", "gpt", "gemini", "custom"]),
  config: z.record(z.unknown()).optional(),
});

// =============================================================================
// Supabase helpers for usage stats
// =============================================================================

let supabaseClient: any = null;

function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require("@supabase/supabase-js");
  supabaseClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return supabaseClient;
}

// =============================================================================
// Router
// =============================================================================

export function authRouter(): Router {
  const router = Router();

  // POST /api/v1/auth/keys — Create API key
  router.post("/keys", requireScope("admin"), validateBody(createKeySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        sendError(res, req, 503, "SERVICE_UNAVAILABLE", "Auth service not configured");
        return;
      }

      const crypto = require("crypto");
      const rawKey = `nella_${crypto.randomBytes(24).toString("hex")}`;
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.slice(0, 12);

      const expiresAt = req.body.expiresInDays
        ? new Date(Date.now() + req.body.expiresInDays * 86400000).toISOString()
        : null;

      const { data, error } = await supabase
        .from("api_keys")
        .insert({
          user_id: req.user!.userId,
          name: req.body.name,
          key_hash: keyHash,
          key_prefix: keyPrefix,
          scopes: req.body.scopes || null,
          rate_limits: req.body.rateLimits ? {
            requests_per_minute: req.body.rateLimits.requestsPerMinute || 20,
            requests_per_hour: req.body.rateLimits.requestsPerHour || 100,
            requests_per_day: req.body.rateLimits.requestsPerDay || 500,
          } : null,
          expires_at: expiresAt,
        })
        .select("id, name, key_prefix, scopes, rate_limits, expires_at, created_at")
        .single();

      if (error) {
        log("error", "Failed to create API key", { error: error.message });
        sendError(res, req, 500, "KEY_CREATION_FAILED", "Failed to create API key");
        return;
      }

      log("info", "API key created", {
        keyId: data.id,
        userId: req.user!.userId,
        name: req.body.name,
      });

      sendCreated(res, {
        id: data.id,
        key: rawKey, // Only returned at creation time
        name: data.name,
        prefix: data.key_prefix,
        scopes: data.scopes,
        rateLimits: data.rate_limits,
        expiresAt: data.expires_at,
        createdAt: data.created_at,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/auth/keys — List API keys
  router.get("/keys", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        sendError(res, req, 503, "SERVICE_UNAVAILABLE", "Auth service not configured");
        return;
      }

      const { data, error } = await supabase
        .from("api_keys")
        .select("id, name, key_prefix, scopes, rate_limits, expires_at, created_at, revoked_at, last_used_at")
        .eq("user_id", req.user!.userId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });

      if (error) {
        sendError(res, req, 500, "QUERY_FAILED", "Failed to list API keys");
        return;
      }

      sendSuccess(res, data || []);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/v1/auth/keys/:id — Revoke API key
  router.delete("/keys/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        sendError(res, req, 503, "SERVICE_UNAVAILABLE", "Auth service not configured");
        return;
      }

      const { error } = await supabase
        .from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", req.params.id)
        .eq("user_id", req.user!.userId);

      if (error) {
        sendError(res, req, 500, "REVOKE_FAILED", "Failed to revoke API key");
        return;
      }

      log("info", "API key revoked", {
        keyId: req.params.id,
        userId: req.user!.userId,
      });

      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/auth/agents — Register agent
  router.post("/agents", requireScope("admin"), validateBody(registerAgentSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Placeholder — will integrate with AgentManager from core
      sendCreated(res, {
        id: require("crypto").randomUUID(),
        name: req.body.name,
        type: req.body.type,
        status: "registered",
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/auth/agents — List agents
  router.get("/agents", async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Placeholder — will integrate with AgentManager
      sendSuccess(res, []);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/auth/usage — Usage statistics
  router.get("/usage", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        sendSuccess(res, { today: 0, month: 0, total: 0, daily: [] });
        return;
      }

      const userId = req.user!.userId;
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      // Count today
      const { count: todayCount } = await supabase
        .from("usage_events")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", todayStart);

      // Count this month
      const { count: monthCount } = await supabase
        .from("usage_events")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", monthStart);

      // Count total
      const { count: totalCount } = await supabase
        .from("usage_events")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      sendSuccess(res, {
        today: todayCount || 0,
        month: monthCount || 0,
        total: totalCount || 0,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
