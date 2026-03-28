/**
 * HMAC Signing & Verification
 *
 * Provides cryptographic integrity for search results returned to agents.
 * Each result is signed with HMAC-SHA256 using a key derived from the
 * session token via HKDF, so:
 *
 * 1. Forged results fail verification (content integrity)
 * 2. The raw session token is never used directly as key material
 * 3. Per-request nonces prevent replay of signed results across requests
 *
 * Part of the prompt injection defense system (Layer 4 upgrade).
 */

import * as crypto from "crypto";

// =============================================================================
// Types
// =============================================================================

export interface HmacSignature {
  /** Hex-encoded HMAC-SHA256 digest (first 16 chars for compact display) */
  tag: string;
  /** The nonce bound into this signature */
  nonce: string;
}

export interface SignedResult {
  /** Original content */
  content: string;
  /** HMAC signature for this result */
  signature: HmacSignature;
  /** Whether signature was verified (set by verifyResultHmac) */
  verified?: boolean;
}

// =============================================================================
// Key Derivation
// =============================================================================

/**
 * Derive an HMAC signing key from a session token using HKDF.
 *
 * This avoids using the raw session token as key material.
 * The derived key is deterministic for a given token, so the same
 * session always produces the same signing key.
 */
export function deriveHmacKey(sessionToken: string): Buffer {
  // HKDF: extract-then-expand
  // Salt: fixed value (not secret, just domain separation)
  const salt = Buffer.from("nella-hmac-v1", "utf-8");
  const info = Buffer.from("search-result-signing", "utf-8");
  const ikm = Buffer.from(sessionToken, "utf-8");

  return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, 32));
}

// =============================================================================
// Signing
// =============================================================================

/**
 * Sign a search result's content with HMAC-SHA256.
 *
 * The signature binds the content to a per-request nonce, preventing
 * replay of signed results from a different request.
 *
 * @param content   The search result content to sign
 * @param hmacKey   Key from deriveHmacKey()
 * @param nonce     Per-request nonce (from generateNonce in result-isolation)
 * @returns         Compact HMAC signature
 */
export function signResultHmac(
  content: string,
  hmacKey: Buffer,
  nonce: string,
): HmacSignature {
  const mac = crypto.createHmac("sha256", hmacKey);
  mac.update(nonce);
  mac.update("\0"); // domain separator
  mac.update(content);
  const fullDigest = mac.digest("hex");

  return {
    tag: fullDigest.slice(0, 16), // 64 bits — compact but collision-resistant for display
    nonce,
  };
}

/**
 * Verify an HMAC signature against content.
 *
 * @returns true if the signature matches, false if content was tampered with
 */
export function verifyResultHmac(
  content: string,
  signature: HmacSignature,
  hmacKey: Buffer,
): boolean {
  const expected = signResultHmac(content, hmacKey, signature.nonce);
  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(expected.tag, "hex"),
    Buffer.from(signature.tag, "hex"),
  );
}

// =============================================================================
// Full Response Signing
// =============================================================================

/**
 * Sign an entire search response (all results combined).
 * Used as an outer envelope signature.
 */
export function signResponseHmac(
  fullResponse: string,
  hmacKey: Buffer,
  nonce: string,
): string {
  const mac = crypto.createHmac("sha256", hmacKey);
  mac.update("response\0");
  mac.update(nonce);
  mac.update("\0");
  mac.update(fullResponse);
  return mac.digest("hex").slice(0, 16);
}

/**
 * Verify an outer response signature.
 */
export function verifyResponseHmac(
  fullResponse: string,
  tag: string,
  hmacKey: Buffer,
  nonce: string,
): boolean {
  const expected = signResponseHmac(fullResponse, hmacKey, nonce);
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(tag, "hex"),
  );
}
