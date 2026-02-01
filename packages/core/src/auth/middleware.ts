/**
 * Auth Middleware
 *
 * Security middleware for nella MCP server:
 * - IP Whitelisting with CIDR support
 * - Request Signing verification (HMAC)
 */

import * as crypto from "crypto";
import type {
  IPWhitelistConfig,
  RequestSigningConfig,
  SignedRequestHeaders,
  ExtendedAuthEvent,
} from "./types";
import { DEFAULT_IP_WHITELIST, DEFAULT_REQUEST_SIGNING } from "./types";

// =============================================================================
// Types
// =============================================================================

export type MiddlewareEventHandler = (event: ExtendedAuthEvent) => void;

export interface IPValidationResult {
  allowed: boolean;
  ip: string;
  matchedRule?: string;
  reason?: string;
}

export interface SignatureValidationResult {
  valid: boolean;
  keyId?: string;
  error?: string;
}

// =============================================================================
// IP Filter
// =============================================================================

export class IPFilter {
  private config: IPWhitelistConfig;
  private eventHandlers: MiddlewareEventHandler[] = [];
  private parsedRanges: Map<string, { start: bigint; end: bigint }> = new Map();

  constructor(config: Partial<IPWhitelistConfig> = {}) {
    this.config = { ...DEFAULT_IP_WHITELIST, ...config };
    this.parseAllRanges();
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  onEvent(handler: MiddlewareEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: ExtendedAuthEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("IPFilter event handler error:", error);
      }
    }
  }

  // =============================================================================
  // IP Validation
  // =============================================================================

  /**
   * Check if an IP address is allowed
   */
  isAllowed(ip: string): IPValidationResult {
    if (!this.config.enabled) {
      return { allowed: true, ip, reason: "IP filtering disabled" };
    }

    // Clean up IP address
    const cleanIp = this.normalizeIP(ip);

    // Allow localhost if configured
    if (this.config.allowLocalhost && this.isLocalhost(cleanIp)) {
      return { allowed: true, ip: cleanIp, reason: "localhost allowed" };
    }

    // Check if IP is in allowlist
    for (const rule of this.config.addresses) {
      if (this.matchesRule(cleanIp, rule)) {
        return { allowed: true, ip: cleanIp, matchedRule: rule };
      }
    }

    // IP not in allowlist
    this.emit({
      type: "ip:blocked",
      ip: cleanIp,
      reason: "IP not in allowlist",
    });

    return {
      allowed: false,
      ip: cleanIp,
      reason: "IP address not in allowlist",
    };
  }

  /**
   * Check multiple IPs (e.g., X-Forwarded-For chain)
   */
  isAllowedChain(ipChain: string[]): IPValidationResult {
    // Check the client IP (first in chain)
    const ipToCheck = [ipChain[0]];

    for (const ip of ipToCheck) {
      const result = this.isAllowed(ip);
      if (!result.allowed) {
        return result;
      }
    }

    return { allowed: true, ip: ipChain[0], reason: "All IPs in chain allowed" };
  }

  // =============================================================================
  // Configuration
  // =============================================================================

  /**
   * Add an IP or CIDR range to the allowlist
   */
  addAllowedIP(ip: string): void {
    if (!this.config.addresses.includes(ip)) {
      this.config.addresses.push(ip);
      this.parseRange(ip);
    }
  }

  /**
   * Remove an IP or CIDR range from the allowlist
   */
  removeAllowedIP(ip: string): void {
    const index = this.config.addresses.indexOf(ip);
    if (index > -1) {
      this.config.addresses.splice(index, 1);
      this.parsedRanges.delete(ip);
    }
  }

  /**
   * Get current allowlist
   */
  getAllowedIPs(): string[] {
    return [...this.config.addresses];
  }

  /**
   * Check if filtering is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable or disable filtering
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Parse all configured ranges
   */
  private parseAllRanges(): void {
    for (const rule of this.config.addresses) {
      this.parseRange(rule);
    }
  }

  /**
   * Check if IP is localhost
   */
  private isLocalhost(ip: string): boolean {
    return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
  }

  /**
   * Parse a single IP or CIDR range
   */
  private parseRange(rule: string): void {
    if (rule.includes("/")) {
      // CIDR notation
      const [ip, prefixStr] = rule.split("/");
      const prefix = parseInt(prefixStr, 10);
      const isIPv6 = ip.includes(":");
      
      const ipNum = this.ipToNumber(ip);
      const bits = isIPv6 ? 128 : 32;
      const mask = (BigInt(1) << BigInt(bits - prefix)) - BigInt(1);
      const start = ipNum & ~mask;
      const end = start | mask;

      this.parsedRanges.set(rule, { start, end });
    }
    // Single IPs don't need pre-parsing
  }

  /**
   * Check if an IP matches a rule
   */
  private matchesRule(ip: string, rule: string): boolean {
    // Handle wildcards
    if (rule === "*") {
      return true;
    }

    // Handle CIDR
    if (rule.includes("/")) {
      const range = this.parsedRanges.get(rule);
      if (!range) return false;

      const ipNum = this.ipToNumber(ip);
      return ipNum >= range.start && ipNum <= range.end;
    }

    // Exact match
    return this.normalizeIP(ip) === this.normalizeIP(rule);
  }

  /**
   * Normalize an IP address
   */
  private normalizeIP(ip: string): string {
    // Remove IPv6 brackets
    let normalized = ip.replace(/^\[|\]$/g, "");

    // Handle IPv4-mapped IPv6 addresses
    if (normalized.startsWith("::ffff:")) {
      normalized = normalized.slice(7);
    }

    // Remove zone ID (%eth0, etc.)
    const zoneIndex = normalized.indexOf("%");
    if (zoneIndex > -1) {
      normalized = normalized.slice(0, zoneIndex);
    }

    return normalized.toLowerCase();
  }

  /**
   * Convert IP address to numeric value
   */
  private ipToNumber(ip: string): bigint {
    const normalized = this.normalizeIP(ip);

    if (normalized.includes(":")) {
      // IPv6
      return this.ipv6ToNumber(normalized);
    } else {
      // IPv4
      return this.ipv4ToNumber(normalized);
    }
  }

  /**
   * Convert IPv4 to number
   */
  private ipv4ToNumber(ip: string): bigint {
    const parts = ip.split(".").map((p) => parseInt(p, 10));
    return BigInt(
      (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]
    );
  }

  /**
   * Convert IPv6 to number
   */
  private ipv6ToNumber(ip: string): bigint {
    // Expand shorthand notation
    const expanded = this.expandIPv6(ip);
    const parts = expanded.split(":").map((p) => parseInt(p, 16));

    let result = BigInt(0);
    for (const part of parts) {
      result = (result << BigInt(16)) | BigInt(part);
    }
    return result;
  }

  /**
   * Expand IPv6 shorthand notation
   */
  private expandIPv6(ip: string): string {
    // Handle :: shorthand
    if (ip.includes("::")) {
      const parts = ip.split("::");
      const left = parts[0] ? parts[0].split(":") : [];
      const right = parts[1] ? parts[1].split(":") : [];
      const missing = 8 - left.length - right.length;
      const middle = Array(missing).fill("0000");
      return [...left, ...middle, ...right]
        .map((p) => p.padStart(4, "0"))
        .join(":");
    }

    return ip
      .split(":")
      .map((p) => p.padStart(4, "0"))
      .join(":");
  }
}

// =============================================================================
// Request Signer
// =============================================================================

export class RequestSigner {
  private config: RequestSigningConfig;
  private secrets: Map<string, string> = new Map(); // keyId -> secret
  private eventHandlers: MiddlewareEventHandler[] = [];

  constructor(config: Partial<RequestSigningConfig> = {}) {
    this.config = { ...DEFAULT_REQUEST_SIGNING, ...config };
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  onEvent(handler: MiddlewareEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: ExtendedAuthEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("RequestSigner event handler error:", error);
      }
    }
  }

  // =============================================================================
  // Secret Management
  // =============================================================================

  /**
   * Register a signing secret for a key
   */
  registerSecret(keyId: string, secret: string): void {
    this.secrets.set(keyId, secret);
  }

  /**
   * Remove a signing secret
   */
  removeSecret(keyId: string): void {
    this.secrets.delete(keyId);
  }

  /**
   * Check if a key has a registered secret
   */
  hasSecret(keyId: string): boolean {
    return this.secrets.has(keyId);
  }

  // =============================================================================
  // Request Signing
  // =============================================================================

  /**
   * Sign a request
   */
  signRequest(
    keyId: string,
    method: string,
    path: string,
    body?: string | Buffer | object
  ): SignedRequestHeaders {
    const secret = this.secrets.get(keyId);
    if (!secret) {
      throw new Error(`No signing secret registered for key: ${keyId}`);
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString("hex");
    const bodyHash = this.hashBody(body);

    // Create signature payload
    const signaturePayload = this.createSignaturePayload(
      method,
      path,
      timestamp,
      nonce,
      bodyHash
    );

    // Generate signature
    const signature = this.createSignature(signaturePayload, secret);

    return {
      "x-nella-key-id": keyId,
      "x-nella-timestamp": timestamp,
      "x-nella-nonce": nonce,
      "x-nella-signature": signature,
      ...(body && { "x-nella-body-hash": bodyHash }),
    };
  }

  // =============================================================================
  // Signature Verification
  // =============================================================================

  /**
   * Verify a signed request
   */
  verifyRequest(
    headers: Record<string, string | undefined>,
    method: string,
    path: string,
    body?: string | Buffer | object
  ): SignatureValidationResult {
    if (!this.config.enabled) {
      return { valid: true, keyId: undefined };
    }

    const keyId = headers["x-nella-key-id"] || headers["X-Nella-Key-Id"];
    const timestamp = headers["x-nella-timestamp"] || headers["X-Nella-Timestamp"];
    const nonce = headers["x-nella-nonce"] || headers["X-Nella-Nonce"];
    const signature = headers["x-nella-signature"] || headers["X-Nella-Signature"];
    const bodyHash = headers["x-nella-body-hash"] || headers["X-Nella-Body-Hash"];

    // Check required headers
    if (!keyId || !timestamp || !nonce || !signature) {
      return {
        valid: false,
        error: "Missing required signature headers",
      };
    }

    // Check timestamp freshness
    const ts = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > this.config.timestampTolerance) {
      this.emit({
        type: "signature:invalid",
        keyId,
        reason: "Timestamp too old or in future",
      });
      return {
        valid: false,
        keyId,
        error: "Request timestamp is too old or in future",
      };
    }

    // Get secret
    const secret = this.secrets.get(keyId);
    if (!secret) {
      return {
        valid: false,
        keyId,
        error: "Unknown key ID",
      };
    }

    // Verify body hash if provided
    if (body && bodyHash) {
      const expectedBodyHash = this.hashBody(body);
      if (bodyHash !== expectedBodyHash) {
        this.emit({
          type: "signature:invalid",
          keyId,
          reason: "Body hash mismatch",
        });
        return {
          valid: false,
          keyId,
          error: "Body hash mismatch",
        };
      }
    }

    // Verify signature
    const signaturePayload = this.createSignaturePayload(
      method,
      path,
      timestamp,
      nonce,
      bodyHash || ""
    );
    const expectedSignature = this.createSignature(signaturePayload, secret);

    // Timing-safe comparison
    const providedBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);

    if (
      providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      this.emit({
        type: "signature:invalid",
        keyId,
        reason: "Signature mismatch",
      });
      return {
        valid: false,
        keyId,
        error: "Invalid signature",
      };
    }

    return { valid: true, keyId };
  }

  // =============================================================================
  // Configuration
  // =============================================================================

  /**
   * Get current configuration
   */
  getConfig(): RequestSigningConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RequestSigningConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if signing is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable or disable signing verification
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Create the signature payload
   */
  private createSignaturePayload(
    method: string,
    path: string,
    timestamp: string,
    nonce: string,
    bodyHash: string
  ): string {
    return [
      method.toUpperCase(),
      path,
      timestamp,
      nonce,
      bodyHash,
    ].join("\n");
  }

  /**
   * Create HMAC signature
   */
  private createSignature(payload: string, secret: string): string {
    const algorithm = this.config.algorithm === "hmac-sha256" ? "sha256" : "sha512";
    const hmac = crypto.createHmac(algorithm, secret);
    hmac.update(payload);
    return hmac.digest("hex");
  }

  /**
   * Hash the request body
   */
  private hashBody(body?: string | Buffer | object): string {
    if (!body) return "";

    let content: string | Buffer;
    if (typeof body === "object" && !(body instanceof Buffer)) {
      content = JSON.stringify(body);
    } else {
      content = body;
    }

    return crypto.createHash("sha256").update(content).digest("hex");
  }
}

// =============================================================================
// Convenience Middleware Functions
// =============================================================================

/**
 * Create IP filter middleware function
 */
export function createIPFilterMiddleware(
  config?: Partial<IPWhitelistConfig>
): (ip: string) => IPValidationResult {
  const filter = new IPFilter(config);
  return (ip: string) => filter.isAllowed(ip);
}

/**
 * Create request signing middleware function
 */
export function createSigningMiddleware(
  config?: Partial<RequestSigningConfig>
): RequestSigner {
  return new RequestSigner(config);
}

// =============================================================================
// Factory
// =============================================================================

let defaultIPFilter: IPFilter | null = null;
let defaultRequestSigner: RequestSigner | null = null;

export function getIPFilter(config?: Partial<IPWhitelistConfig>): IPFilter {
  if (!defaultIPFilter) {
    defaultIPFilter = new IPFilter(config);
  }
  return defaultIPFilter;
}

export function getRequestSigner(
  config?: Partial<RequestSigningConfig>
): RequestSigner {
  if (!defaultRequestSigner) {
    defaultRequestSigner = new RequestSigner(config);
  }
  return defaultRequestSigner;
}

export function resetMiddleware(): void {
  defaultIPFilter = null;
  defaultRequestSigner = null;
}
