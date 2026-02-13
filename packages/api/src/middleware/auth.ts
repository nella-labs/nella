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

export interface AuthenticatedUser {
  apiKeyId: string;
  userId: string;
  scopes: string[];
  rateLimits: {
    requests_per_minute: number;
    requests_per_hour: number;
    requests_per_day: number;
  };
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
      .select("id, user_id, name, key_prefix, rate_limits, expires_at, revoked_at, scopes")
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
      scopes: keyRecord.scopes || ["workspaces:read", "search:read", "validate:run", "context:read"],
      rateLimits: keyRecord.rate_limits || defaultLimits,
    };

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
