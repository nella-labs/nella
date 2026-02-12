/**
 * Playground Auth Middleware
 *
 * Reuses the hosted-server Supabase API key pattern:
 * - Keys prefixed with `nella_`
 * - SHA-256 hash lookup against Supabase `api_keys` table
 * - 60-second in-memory key cache
 *
 * Provides Express middleware for /api/* routes and a WebSocket
 * auth helper for ?token= query param.
 */

import * as crypto from "crypto";
import type { Logger } from "../logger";

// =============================================================================
// Types
// =============================================================================

export interface AuthConfig {
  /** Supabase URL (SUPABASE_URL) */
  supabaseUrl?: string;
  /** Supabase service-role key (SUPABASE_SERVICE_ROLE_KEY) */
  supabaseServiceKey?: string;
  /** Cache TTL in ms (default: 60_000) */
  cacheTtl?: number;
  /** Allow unauthenticated access to health/metrics */
  publicPaths?: string[];
}

export interface AuthResult {
  valid: boolean;
  userId?: string;
  keyId?: string;
  error?: string;
}

export interface AuthMiddleware {
  /** Express middleware — attaches `req.auth` if valid */
  expressMiddleware: (req: any, res: any, next: () => void) => void;
  /** Validate a token string (for WebSocket auth) */
  validateToken: (token: string) => Promise<AuthResult>;
  /** Destroy cache timers */
  destroy: () => void;
}

// =============================================================================
// Key Cache
// =============================================================================

interface CacheEntry {
  result: AuthResult;
  expiresAt: number;
}

class KeyCache {
  private cache: Map<string, CacheEntry> = new Map();
  private ttl: number;
  private sweepInterval: ReturnType<typeof setInterval>;

  constructor(ttl: number) {
    this.ttl = ttl;
    this.sweepInterval = setInterval(() => this.sweep(), ttl);
  }

  get(hash: string): AuthResult | null {
    const entry = this.cache.get(hash);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(hash);
      return null;
    }
    return entry.result;
  }

  set(hash: string, result: AuthResult): void {
    this.cache.set(hash, { result, expiresAt: Date.now() + this.ttl });
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(key);
    }
  }

  destroy(): void {
    clearInterval(this.sweepInterval);
    this.cache.clear();
  }
}

// =============================================================================
// Hash Helper
// =============================================================================

function hashKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

// =============================================================================
// Default Public Paths
// =============================================================================

const DEFAULT_PUBLIC_PATHS = [
  "/health",
  "/ready",
  "/metrics",
  "/context-health",
  "/",
];

// =============================================================================
// Factory
// =============================================================================

export function createAuthMiddleware(config: AuthConfig, logger?: Logger): AuthMiddleware {
  const cacheTtl = config.cacheTtl ?? 60_000;
  const publicPaths = config.publicPaths ?? DEFAULT_PUBLIC_PATHS;
  const cache = new KeyCache(cacheTtl);

  const log = logger;

  // ─── Token validation ────────────────────────────────────────────

  async function validateToken(token: string): Promise<AuthResult> {
    if (!token) return { valid: false, error: "No token provided" };

    // Must start with nella_ prefix
    if (!token.startsWith("nella_")) {
      return { valid: false, error: "Invalid key format" };
    }

    const hash = hashKey(token);

    // Check cache
    const cached = cache.get(hash);
    if (cached) return cached;

    // If no Supabase config, fall back to trusting the prefix (dev mode)
    if (!config.supabaseUrl || !config.supabaseServiceKey) {
      log?.warn("Auth: No Supabase config — accepting nella_ keys in dev mode");
      const devResult: AuthResult = { valid: true, userId: "dev", keyId: "dev" };
      cache.set(hash, devResult);
      return devResult;
    }

    // Look up key hash in Supabase
    try {
      const url = `${config.supabaseUrl}/rest/v1/api_keys?key_hash=eq.${hash}&select=id,user_id,revoked`;
      const response = await fetch(url, {
        headers: {
          apikey: config.supabaseServiceKey,
          Authorization: `Bearer ${config.supabaseServiceKey}`,
        },
      });

      if (!response.ok) {
        const result: AuthResult = { valid: false, error: `Supabase error: ${response.status}` };
        return result;
      }

      const rows: Array<{ id: string; user_id: string; revoked: boolean }> = await response.json() as any;

      if (rows.length === 0) {
        const result: AuthResult = { valid: false, error: "Unknown API key" };
        cache.set(hash, result);
        return result;
      }

      const row = rows[0];
      if (row.revoked) {
        const result: AuthResult = { valid: false, error: "API key revoked" };
        cache.set(hash, result);
        return result;
      }

      const result: AuthResult = { valid: true, userId: row.user_id, keyId: row.id };
      cache.set(hash, result);
      return result;
    } catch (error) {
      log?.error("Auth: Supabase lookup failed", { error: String(error) });
      return { valid: false, error: "Auth service unavailable" };
    }
  }

  // ─── Express middleware ──────────────────────────────────────────

  function expressMiddleware(req: any, res: any, next: () => void): void {
    // Allow public paths through
    if (publicPaths.some((p) => req.path === p || req.path.startsWith(p + "?"))) {
      return next();
    }

    const authHeader: string | undefined = req.headers?.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : (req.query?.token as string | undefined);

    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    validateToken(token)
      .then((result) => {
        if (!result.valid) {
          return res.status(403).json({ error: result.error || "Invalid API key" });
        }
        req.auth = result;
        next();
      })
      .catch((err) => {
        log?.error("Auth middleware error", { error: String(err) });
        res.status(500).json({ error: "Internal auth error" });
      });
  }

  return {
    expressMiddleware,
    validateToken,
    destroy: () => cache.destroy(),
  };
}
