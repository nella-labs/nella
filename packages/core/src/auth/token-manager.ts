/**
 * JWT Token Manager
 *
 * Session-based authentication using JWT tokens.
 * Provides short-lived tokens for authenticated API sessions.
 */

import * as crypto from "crypto";
import type {
  ApiKey,
  JWTPayload,
  JWTConfig,
  ExtendedAuthEvent,
} from "./types";
import { DEFAULT_JWT_CONFIG } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface TokenManagerOptions {
  secret?: string; // Base64 encoded secret from NELLA_JWT_SECRET
  config?: Partial<Omit<JWTConfig, "secret">>;
}

export interface TokenResult {
  token: string;
  payload: JWTPayload;
  expiresAt: Date;
}

export interface TokenValidationResult {
  valid: boolean;
  payload?: JWTPayload;
  error?: string;
  errorCode?: "INVALID_TOKEN" | "EXPIRED_TOKEN" | "REVOKED_TOKEN" | "INVALID_SIGNATURE";
}

export type TokenEventHandler = (event: ExtendedAuthEvent) => void;

// =============================================================================
// Token Manager Class
// =============================================================================

export class TokenManager {
  private config: JWTConfig;
  private revokedTokens: Set<string> = new Set(); // JTI of revoked tokens
  private eventHandlers: TokenEventHandler[] = [];

  constructor(options: TokenManagerOptions = {}) {
    const secret = options.secret || process.env.NELLA_JWT_SECRET;
    
    if (!secret) {
      throw new Error(
        "JWT secret is required. Set NELLA_JWT_SECRET environment variable or pass secret option."
      );
    }

    this.config = {
      ...DEFAULT_JWT_CONFIG,
      ...options.config,
      secret,
    };
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  onEvent(handler: TokenEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: ExtendedAuthEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Token event handler error:", error);
      }
    }
  }

  // =============================================================================
  // Token Generation
  // =============================================================================

  /**
   * Issue a new JWT token for an API key
   */
  issueToken(
    key: ApiKey,
    sessionInfo?: {
      ip?: string;
      userAgent?: string;
      origin?: string;
    }
  ): TokenResult {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = this.parseExpiry(this.config.expiresIn);
    const exp = now + expiresIn;
    const jti = crypto.randomUUID();

    const payload: JWTPayload = {
      sub: key.id,
      iss: this.config.issuer,
      aud: this.config.audience,
      iat: now,
      exp,
      nbf: now,
      jti,
      claims: {
        keyPrefix: key.prefix,
        workspaceId: key.workspaceId,
        agentId: key.agentId,
        permissions: key.permissions,
        session: sessionInfo,
      },
    };

    const token = this.encodeToken(payload);
    const expiresAt = new Date(exp * 1000);

    this.emit({
      type: "token:issued",
      jti,
      keyId: key.id,
      expiresAt: expiresAt.toISOString(),
    });

    return { token, payload, expiresAt };
  }

  /**
   * Issue a short-lived token (e.g., for one-time actions)
   */
  issueShortLivedToken(
    key: ApiKey,
    expiresInSeconds: number = 300 // 5 minutes default
  ): TokenResult {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiresInSeconds;
    const jti = crypto.randomUUID();

    const payload: JWTPayload = {
      sub: key.id,
      iss: this.config.issuer,
      aud: this.config.audience,
      iat: now,
      exp,
      nbf: now,
      jti,
      claims: {
        keyPrefix: key.prefix,
        workspaceId: key.workspaceId,
        agentId: key.agentId,
        permissions: key.permissions,
      },
    };

    const token = this.encodeToken(payload);
    const expiresAt = new Date(exp * 1000);

    return { token, payload, expiresAt };
  }

  // =============================================================================
  // Token Validation
  // =============================================================================

  /**
   * Validate and decode a JWT token
   */
  validateToken(token: string): TokenValidationResult {
    try {
      // Decode and verify
      const payload = this.decodeToken(token);
      
      if (!payload) {
        return {
          valid: false,
          error: "Invalid token format",
          errorCode: "INVALID_TOKEN",
        };
      }

      // Check signature
      if (!this.verifySignature(token)) {
        return {
          valid: false,
          error: "Invalid signature",
          errorCode: "INVALID_SIGNATURE",
        };
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        this.emit({ type: "token:expired", jti: payload.jti });
        return {
          valid: false,
          error: "Token has expired",
          errorCode: "EXPIRED_TOKEN",
        };
      }

      // Check not before
      if (payload.nbf && payload.nbf > now) {
        return {
          valid: false,
          error: "Token not yet valid",
          errorCode: "INVALID_TOKEN",
        };
      }

      // Check issuer
      if (payload.iss !== this.config.issuer) {
        return {
          valid: false,
          error: "Invalid issuer",
          errorCode: "INVALID_TOKEN",
        };
      }

      // Check audience
      if (payload.aud !== this.config.audience) {
        return {
          valid: false,
          error: "Invalid audience",
          errorCode: "INVALID_TOKEN",
        };
      }

      // Check if revoked
      if (this.revokedTokens.has(payload.jti)) {
        return {
          valid: false,
          error: "Token has been revoked",
          errorCode: "REVOKED_TOKEN",
        };
      }

      return { valid: true, payload };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "INVALID_TOKEN",
      };
    }
  }

  /**
   * Decode token without validation (for inspection)
   */
  decodeWithoutValidation(token: string): JWTPayload | null {
    return this.decodeToken(token);
  }

  // =============================================================================
  // Token Revocation
  // =============================================================================

  /**
   * Revoke a token by JTI
   */
  revokeToken(jti: string, reason: string = "manual"): void {
    this.revokedTokens.add(jti);
    this.emit({ type: "token:revoked", jti, reason });
  }

  /**
   * Revoke a token from its string value
   */
  revokeTokenString(token: string, reason: string = "manual"): boolean {
    const payload = this.decodeToken(token);
    if (!payload) return false;

    this.revokeToken(payload.jti, reason);
    return true;
  }

  /**
   * Check if a token is revoked
   */
  isRevoked(jti: string): boolean {
    return this.revokedTokens.has(jti);
  }

  /**
   * Get all revoked token JTIs
   */
  getRevokedTokens(): string[] {
    return Array.from(this.revokedTokens);
  }

  /**
   * Clear old revoked tokens (cleanup)
   */
  clearExpiredRevocations(): void {
    // In a real implementation, you'd store expiry time with each revocation
    // For now, we keep all revocations in memory
  }

  // =============================================================================
  // Token Refresh
  // =============================================================================

  /**
   * Refresh a token (issue new with same claims)
   */
  refreshToken(token: string): TokenResult | null {
    const validation = this.validateToken(token);
    
    // Allow refresh even if token is slightly expired (grace period)
    if (!validation.payload) {
      return null;
    }

    const payload = validation.payload;
    const now = Math.floor(Date.now() / 1000);
    
    // Don't refresh if token is too old (more than 1 hour past expiry)
    if (payload.exp < now - 3600) {
      return null;
    }

    // Revoke old token
    this.revokeToken(payload.jti, "refreshed");

    // Issue new token with same claims
    const expiresIn = this.parseExpiry(this.config.expiresIn);
    const exp = now + expiresIn;
    const jti = crypto.randomUUID();

    const newPayload: JWTPayload = {
      ...payload,
      iat: now,
      exp,
      nbf: now,
      jti,
    };

    const newToken = this.encodeToken(newPayload);
    const expiresAt = new Date(exp * 1000);

    this.emit({
      type: "token:issued",
      jti,
      keyId: payload.sub,
      expiresAt: expiresAt.toISOString(),
    });

    return { token: newToken, payload: newPayload, expiresAt };
  }

  // =============================================================================
  // Configuration
  // =============================================================================

  /**
   * Get current configuration (without secret)
   */
  getConfig(): Omit<JWTConfig, "secret"> {
    const { secret: _, ...config } = this.config;
    return config;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<Omit<JWTConfig, "secret">>): void {
    this.config = { ...this.config, ...config };
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Encode payload to JWT token
   * Using HMAC-SHA256 for signing (HS256)
   */
  private encodeToken(payload: JWTPayload): string {
    // Header
    const header = {
      alg: this.config.algorithm,
      typ: "JWT",
    };

    // Encode header and payload
    const headerBase64 = this.base64UrlEncode(JSON.stringify(header));
    const payloadBase64 = this.base64UrlEncode(JSON.stringify(payload));
    
    // Create signature
    const signatureInput = `${headerBase64}.${payloadBase64}`;
    const signature = this.createSignature(signatureInput);

    return `${signatureInput}.${signature}`;
  }

  /**
   * Decode JWT token to payload
   */
  private decodeToken(token: string): JWTPayload | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        return null;
      }

      const payloadBase64 = parts[1];
      const payloadJson = this.base64UrlDecode(payloadBase64);
      return JSON.parse(payloadJson) as JWTPayload;
    } catch {
      return null;
    }
  }

  /**
   * Verify token signature
   */
  private verifySignature(token: string): boolean {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        return false;
      }

      const signatureInput = `${parts[0]}.${parts[1]}`;
      const expectedSignature = this.createSignature(signatureInput);
      
      // Timing-safe comparison
      const provided = Buffer.from(parts[2]);
      const expected = Buffer.from(expectedSignature);
      
      if (provided.length !== expected.length) {
        return false;
      }
      
      return crypto.timingSafeEqual(provided, expected);
    } catch {
      return false;
    }
  }

  /**
   * Create HMAC signature
   */
  private createSignature(input: string): string {
    const algorithm = this.config.algorithm === "HS256" ? "sha256"
      : this.config.algorithm === "HS384" ? "sha384"
      : "sha512";

    const hmac = crypto.createHmac(algorithm, this.config.secret);
    hmac.update(input);
    return this.base64UrlEncode(hmac.digest());
  }

  /**
   * Parse expiry string to seconds
   */
  private parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 24 * 60 * 60; // Default 24 hours
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case "s": return value;
      case "m": return value * 60;
      case "h": return value * 60 * 60;
      case "d": return value * 24 * 60 * 60;
      default: return 24 * 60 * 60;
    }
  }

  /**
   * Base64 URL encode
   */
  private base64UrlEncode(input: string | Buffer): string {
    const buffer = typeof input === "string" ? Buffer.from(input) : input;
    return buffer
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  /**
   * Base64 URL decode
   */
  private base64UrlDecode(input: string): string {
    // Add padding
    let padded = input;
    while (padded.length % 4 !== 0) {
      padded += "=";
    }

    // Convert URL-safe to standard base64
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf-8");
  }
}

// =============================================================================
// Factory
// =============================================================================

let defaultTokenManager: TokenManager | null = null;

export function getTokenManager(options?: TokenManagerOptions): TokenManager {
  if (!defaultTokenManager) {
    defaultTokenManager = new TokenManager(options);
  }
  return defaultTokenManager;
}

export function createTokenManager(options?: TokenManagerOptions): TokenManager {
  return new TokenManager(options);
}

export function resetTokenManager(): void {
  defaultTokenManager = null;
}
