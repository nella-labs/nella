/**
 * Authentication Middleware
 *
 * Validates API keys from Authorization header or X-API-Key header.
 * Uses Supabase api_keys table with SHA-256 hash lookup — same pattern
 * as the MCP hosted-server.ts for consistency.
 */

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { sendError } from "../utils/responses";
import { log } from "../utils/logger";

// Lazy Supabase client
let supabaseClient: any = null;

function getSupabase() {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const { createClient } = require("@supabase/supabase-js");
  supabaseClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return supabaseClient;
}

// ── Plan types (duplicated from nella-website to avoid cross-dependency) ──────

export type PlanSlug = "free" | "starter" | "pro" | "team";
export type SearchTier = "basic" | "advanced" | "premium";

export interface PlanFeatures {
  searchTier: SearchTier;
  ragIndexing: boolean;
  ragIndexingFull: boolean;
  codeVerification: boolean;
  customConstraints: boolean;
  contextTracking: boolean;
  contextTrackingFull: boolean;
  sso: boolean;
  auditLogs: boolean;
  slackAlerts: boolean;
  prioritySupport: boolean;
  dedicatedSupport: boolean;
}

export interface PlanLimits {
  requestsPerMonth: number;
  projects: number;
  members: number;
  storageMb: number;
  logRetentionDays: number;
  workspaces: number;
  organizations: number;
}

/** Plan feature/limit definitions — must stay in sync with nella-website */
const PLAN_FEATURES: Record<PlanSlug, PlanFeatures> = {
  free: {
    searchTier: "basic", ragIndexing: false, ragIndexingFull: false,
    codeVerification: false, customConstraints: false,
    contextTracking: false, contextTrackingFull: false,
    sso: false, auditLogs: false, slackAlerts: false,
    prioritySupport: false, dedicatedSupport: false,
  },
  starter: {
    searchTier: "advanced", ragIndexing: true, ragIndexingFull: false,
    codeVerification: false, customConstraints: true,
    contextTracking: true, contextTrackingFull: false,
    sso: false, auditLogs: false, slackAlerts: false,
    prioritySupport: false, dedicatedSupport: false,
  },
  pro: {
    searchTier: "premium", ragIndexing: true, ragIndexingFull: true,
    codeVerification: true, customConstraints: true,
    contextTracking: true, contextTrackingFull: true,
    sso: false, auditLogs: false, slackAlerts: false,
    prioritySupport: true, dedicatedSupport: false,
  },
  team: {
    searchTier: "premium", ragIndexing: true, ragIndexingFull: true,
    codeVerification: true, customConstraints: true,
    contextTracking: true, contextTrackingFull: true,
    sso: true, auditLogs: true, slackAlerts: true,
    prioritySupport: true, dedicatedSupport: true,
  },
};

const PLAN_LIMITS: Record<PlanSlug, PlanLimits> = {
  free:    { requestsPerMonth: 5_000,   projects: 1,  members: 1,  storageMb: 50,    logRetentionDays: 3,  workspaces: 0,  organizations: 1 },
  starter: { requestsPerMonth: 25_000,  projects: 3,  members: 1,  storageMb: 250,   logRetentionDays: 7,  workspaces: 1,  organizations: 2 },
  pro:     { requestsPerMonth: 100_000, projects: 10, members: 5,  storageMb: 2_048, logRetentionDays: 30, workspaces: 5,  organizations: 5 },
  team:    { requestsPerMonth: 500_000, projects: -1, members: 50, storageMb: 10_240, logRetentionDays: 90, workspaces: -1, organizations: -1 },
};

// ── TTL cache for org plan lookups (avoids per-request DB hit) ───────────────

interface CachedPlan {
  plan: PlanSlug;
  features: PlanFeatures;
  limits: PlanLimits;
  expiresAt: number;
}

const planCache = new Map<string, CachedPlan>();
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function resolveOrgPlan(orgId: string): Promise<CachedPlan> {
  const now = Date.now();
  const cached = planCache.get(orgId);
  if (cached && cached.expiresAt > now) return cached;

  const supabase = getSupabase();
  const { data: org } = await supabase
    .from("organizations")
    .select("plan")
    .eq("id", orgId)
    .maybeSingle();

  const planSlug: PlanSlug = (org?.plan as PlanSlug) || "free";
  const entry: CachedPlan = {
    plan: planSlug,
    features: PLAN_FEATURES[planSlug] || PLAN_FEATURES.free,
    limits: PLAN_LIMITS[planSlug] || PLAN_LIMITS.free,
    expiresAt: now + PLAN_CACHE_TTL_MS,
  };

  planCache.set(orgId, entry);
  return entry;
}

async function resolveUserPlan(userId: string): Promise<CachedPlan> {
  const cacheKey = `user:${userId}`;
  const now = Date.now();
  const cached = planCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached;

  const supabase = getSupabase();
  const { data: user } = await supabase
    .from("users")
    .select("plan")
    .eq("id", userId)
    .maybeSingle();

  const planSlug: PlanSlug = (user?.plan as PlanSlug) || "free";
  const entry: CachedPlan = {
    plan: planSlug,
    features: PLAN_FEATURES[planSlug] || PLAN_FEATURES.free,
    limits: PLAN_LIMITS[planSlug] || PLAN_LIMITS.free,
    expiresAt: now + PLAN_CACHE_TTL_MS,
  };

  planCache.set(cacheKey, entry);
  return entry;
}

// ── User type ────────────────────────────────────────────────────────────────

export interface AuthenticatedUser {
  apiKeyId: string;
  userId: string;
  orgId: string | null;
  scopes: string[];
  rateLimits: {
    requests_per_minute: number;
    requests_per_hour: number;
    requests_per_day: number;
  };
  /** Plan features — undefined when no org (self-hosted / unlinked key) */
  planFeatures?: PlanFeatures;
  /** Plan limits — undefined when no org */
  planLimits?: PlanLimits;
  /** Plan slug — undefined when no org */
  planSlug?: PlanSlug;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      requestId?: string;
    }
  }
}

/**
 * Extract API key from request headers.
 * Supports: Authorization: Bearer nla_xxx  |  X-API-Key: nla_xxx
 */
function extractApiKey(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token.startsWith("nella_") || token.startsWith("nla_")) {
      return token;
    }
  }

  const xApiKey = req.headers["x-api-key"] as string | undefined;
  if (xApiKey) return xApiKey;

  return null;
}

/**
 * API key authentication middleware.
 */
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const apiKey = extractApiKey(req);

  if (!apiKey) {
    sendError(res, req, 401, "AUTHENTICATION_REQUIRED", "Missing API key. Provide via Authorization: Bearer <key> or X-API-Key header.");
    return;
  }

  try {
    const supabase = getSupabase();

    // Hash the key for lookup (SHA-256, same as hosted-server.ts and website)
    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

    const { data: keyRecord, error } = await supabase
      .from("api_keys")
      .select("id, user_id, name, key_prefix, rate_limits, expires_at, revoked_at, scopes, org_id")
      .eq("key_hash", keyHash)
      .single();

    if (error || !keyRecord) {
      log("warn", "API key authentication failed", {
        requestId: req.requestId,
        reason: "key_not_found",
      });
      sendError(res, req, 401, "INVALID_API_KEY", "Invalid API key");
      return;
    }

    // Check revocation
    if (keyRecord.revoked_at) {
      sendError(res, req, 401, "API_KEY_REVOKED", "This API key has been revoked");
      return;
    }

    // Check expiration
    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      sendError(res, req, 401, "API_KEY_EXPIRED", "This API key has expired");
      return;
    }

    // Attach user info to request
    const defaultLimits = {
      requests_per_minute: 60,
      requests_per_hour: 1000,
      requests_per_day: 10000,
    };

    req.user = {
      apiKeyId: keyRecord.id,
      userId: keyRecord.user_id,
      orgId: keyRecord.org_id || null,
      scopes: keyRecord.scopes || ["workspaces:read", "search:read", "validate:run", "context:read"],
      rateLimits: keyRecord.rate_limits || defaultLimits,
    };

    // Resolve plan features/limits from org or user
    try {
      if (keyRecord.org_id) {
        const orgPlan = await resolveOrgPlan(keyRecord.org_id);
        req.user.planSlug = orgPlan.plan;
        req.user.planFeatures = orgPlan.features;
        req.user.planLimits = orgPlan.limits;
      } else {
        // No org — resolve from user's plan directly (prevents plan bypass)
        const userPlan = await resolveUserPlan(keyRecord.user_id);
        req.user.planSlug = userPlan.plan;
        req.user.planFeatures = userPlan.features;
        req.user.planLimits = userPlan.limits;
      }
    } catch (planErr) {
      // Non-fatal — log and continue without plan enforcement
      log("warn", "Failed to resolve plan", {
        requestId: req.requestId,
        orgId: keyRecord.org_id,
        userId: keyRecord.user_id,
        error: (planErr as Error).message,
      });
    }

    next();
  } catch (err) {
    log("error", "Authentication error", {
      requestId: req.requestId,
      error: (err as Error).message,
    });
    sendError(res, req, 500, "AUTH_ERROR", "Authentication service error");
  }
}

/**
 * Scope enforcement middleware factory.
 * Usage: router.get("/workspaces", requireScope("workspaces:read"), handler)
 */
export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, req, 401, "AUTHENTICATION_REQUIRED", "Not authenticated");
      return;
    }

    const scopes = req.user.scopes;
    if (scopes.includes("admin") || scopes.includes(scope)) {
      next();
      return;
    }

    log("warn", "Scope check failed", {
      requestId: req.requestId,
      userId: req.user.userId,
      required: scope,
      available: scopes,
    });

    sendError(res, req, 403, "INSUFFICIENT_SCOPE", `Required scope: ${scope}`);
  };
}
