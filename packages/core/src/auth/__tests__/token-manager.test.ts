import test from "node:test";
import assert from "node:assert/strict";
import { TokenManager, createTokenManager, resetTokenManager } from "../token-manager";
import type { ApiKey, ApiKeyPermissions } from "../types";

// =============================================================================
// Helpers
// =============================================================================

const TEST_SECRET = Buffer.from("nella-test-secret-key-at-least-32-bytes-long!!").toString("base64");

function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "key-001",
    name: "Test Key",
    keyHash: "hash-placeholder",
    prefix: "nla_test",
    workspaceId: "ws-1",
    agentId: "agent-1",
    permissions: {
      search: true,
      validate: true,
      context: true,
      admin: false,
    } as ApiKeyPermissions,
    rateLimit: null,
    metadata: {
      createdAt: new Date().toISOString(),
      createdBy: "test",
      lastUsed: null,
      expiresAt: null,
      usageCount: 0,
    },
    ...overrides,
  };
}

// =============================================================================
// Constructor
// =============================================================================

test("TokenManager: throws without secret", () => {
  // Ensure env var is not set for this test
  const original = process.env.NELLA_JWT_SECRET;
  delete process.env.NELLA_JWT_SECRET;
  try {
    assert.throws(() => new TokenManager({}), /secret is required/i);
  } finally {
    if (original !== undefined) process.env.NELLA_JWT_SECRET = original;
  }
});

test("TokenManager: accepts secret via options", () => {
  const tm = new TokenManager({ secret: TEST_SECRET });
  assert.ok(tm);
});

// =============================================================================
// Token Issuance
// =============================================================================

test("TokenManager: issueToken returns valid token structure", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const key = makeApiKey();
  const result = tm.issueToken(key);

  assert.ok(result.token);
  assert.ok(result.token.split(".").length === 3, "JWT has 3 parts");
  assert.ok(result.payload);
  assert.equal(result.payload.sub, key.id);
  assert.ok(result.expiresAt instanceof Date);
  assert.ok(result.expiresAt.getTime() > Date.now());
});

test("TokenManager: issueToken includes correct claims", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const key = makeApiKey({ workspaceId: "ws-42", agentId: "agent-x" });
  const result = tm.issueToken(key);

  assert.equal(result.payload.claims.workspaceId, "ws-42");
  assert.equal(result.payload.claims.agentId, "agent-x");
  assert.equal(result.payload.claims.keyPrefix, key.prefix);
  assert.deepEqual(result.payload.claims.permissions, key.permissions);
});

test("TokenManager: issueToken includes session info", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const key = makeApiKey();
  const result = tm.issueToken(key, { ip: "127.0.0.1", userAgent: "test/1.0" });

  assert.equal(result.payload.claims.session?.ip, "127.0.0.1");
  assert.equal(result.payload.claims.session?.userAgent, "test/1.0");
});

test("TokenManager: each token has unique JTI", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const key = makeApiKey();
  const r1 = tm.issueToken(key);
  const r2 = tm.issueToken(key);

  assert.notEqual(r1.payload.jti, r2.payload.jti);
  assert.notEqual(r1.token, r2.token);
});

test("TokenManager: issueShortLivedToken has shorter expiry", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const key = makeApiKey();
  const normal = tm.issueToken(key);
  const short = tm.issueShortLivedToken(key, 60); // 60 seconds

  assert.ok(short.expiresAt.getTime() < normal.expiresAt.getTime());
  const diff = short.expiresAt.getTime() - Date.now();
  assert.ok(diff <= 61_000 && diff > 50_000);
});

// =============================================================================
// Token Validation
// =============================================================================

test("TokenManager: validates a freshly issued token", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const key = makeApiKey();
  const { token } = tm.issueToken(key);

  const result = tm.validateToken(token);
  assert.equal(result.valid, true);
  assert.ok(result.payload);
  assert.equal(result.payload?.sub, key.id);
});

test("TokenManager: rejects malformed token", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const result = tm.validateToken("not.a.jwt");

  assert.equal(result.valid, false);
  assert.ok(result.errorCode);
});

test("TokenManager: rejects token with wrong signature", () => {
  const tm1 = createTokenManager({ secret: TEST_SECRET });
  const tm2 = createTokenManager({ secret: Buffer.from("different-secret-key-also-32-bytes!!!").toString("base64") });

  const key = makeApiKey();
  const { token } = tm1.issueToken(key);
  const result = tm2.validateToken(token);

  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "INVALID_SIGNATURE");
});

test("TokenManager: short-lived token has correct exp claim", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const key = makeApiKey();
  const result = tm.issueShortLivedToken(key, 30); // 30 seconds

  // exp should be ~30s from now
  const expMs = result.expiresAt.getTime();
  const delta = expMs - Date.now();
  assert.ok(delta > 20_000 && delta <= 31_000, `exp delta ${delta}ms out of range`);
  assert.equal(result.payload.exp! - result.payload.iat!, 30);
});

test("TokenManager: rejects token with wrong issuer", () => {
  const tm1 = createTokenManager({ secret: TEST_SECRET, config: { issuer: "nella-a" } });
  const tm2 = createTokenManager({ secret: TEST_SECRET, config: { issuer: "nella-b" } });

  const key = makeApiKey();
  const { token } = tm1.issueToken(key);
  const result = tm2.validateToken(token);

  assert.equal(result.valid, false);
  assert.ok(result.error?.includes("issuer"));
});

test("TokenManager: rejects empty string token", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const result = tm.validateToken("");
  assert.equal(result.valid, false);
});

// =============================================================================
// Token Revocation
// =============================================================================

test("TokenManager: revoked token is rejected", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const key = makeApiKey();
  const { token, payload } = tm.issueToken(key);

  // Valid before revocation
  assert.equal(tm.validateToken(token).valid, true);

  // Revoke
  tm.revokeToken(payload.jti, "test");

  // Invalid after revocation
  const result = tm.validateToken(token);
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "REVOKED_TOKEN");
});

test("TokenManager: revokeTokenString revokes by token value", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const key = makeApiKey();
  const { token } = tm.issueToken(key);

  const revoked = tm.revokeTokenString(token, "test");
  assert.equal(revoked, true);
  assert.equal(tm.validateToken(token).valid, false);
});

test("TokenManager: revokeTokenString returns false for invalid token", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  assert.equal(tm.revokeTokenString("garbage", "test"), false);
});

test("TokenManager: isRevoked tracks revoked JTIs", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const key = makeApiKey();
  const { payload } = tm.issueToken(key);

  assert.equal(tm.isRevoked(payload.jti), false);
  tm.revokeToken(payload.jti);
  assert.equal(tm.isRevoked(payload.jti), true);
});

test("TokenManager: getRevokedTokens lists all revoked", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const key = makeApiKey();
  const r1 = tm.issueToken(key);
  const r2 = tm.issueToken(key);

  tm.revokeToken(r1.payload.jti);
  tm.revokeToken(r2.payload.jti);

  const revoked = tm.getRevokedTokens();
  assert.ok(revoked.includes(r1.payload.jti));
  assert.ok(revoked.includes(r2.payload.jti));
});

// =============================================================================
// Token Refresh
// =============================================================================

test("TokenManager: refreshToken issues new token and revokes old", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const key = makeApiKey();
  const original = tm.issueToken(key);

  const refreshed = tm.refreshToken(original.token);
  assert.ok(refreshed, "refresh should succeed");
  assert.notEqual(refreshed!.token, original.token);
  assert.notEqual(refreshed!.payload.jti, original.payload.jti);

  // Old token is revoked
  assert.equal(tm.isRevoked(original.payload.jti), true);
  // New token is valid
  assert.equal(tm.validateToken(refreshed!.token).valid, true);
});

test("TokenManager: refreshToken returns null for garbage token", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  assert.equal(tm.refreshToken("not-a-token"), null);
});

// =============================================================================
// Token Decode Without Validation
// =============================================================================

test("TokenManager: decodeWithoutValidation decodes without checking signature", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const key = makeApiKey();
  const { token } = tm.issueToken(key);

  const payload = tm.decodeWithoutValidation(token);
  assert.ok(payload);
  assert.equal(payload?.sub, key.id);
});

test("TokenManager: decodeWithoutValidation returns null for garbage", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  assert.equal(tm.decodeWithoutValidation("nope"), null);
});

// =============================================================================
// Configuration
// =============================================================================

test("TokenManager: getConfig returns config without secret", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const config = tm.getConfig();
  assert.ok(!("secret" in config));
  assert.ok(config.issuer);
  assert.ok(config.audience);
});

test("TokenManager: updateConfig changes behavior", () => {
  const tm = createTokenManager({ secret: TEST_SECRET, config: { audience: "original" } });
  const key = makeApiKey();
  const t1 = tm.issueToken(key);
  assert.equal(t1.payload.aud, "original");

  tm.updateConfig({ audience: "updated" });
  const t2 = tm.issueToken(key);
  assert.equal(t2.payload.aud, "updated");
});

// =============================================================================
// Event Emission
// =============================================================================

test("TokenManager: emits events on issueToken", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const events: unknown[] = [];
  tm.onEvent((e) => events.push(e));

  const key = makeApiKey();
  tm.issueToken(key);

  assert.equal(events.length, 1);
  assert.equal((events[0] as any).type, "token:issued");
});

test("TokenManager: emits events on revokeToken", () => {
  const tm = createTokenManager({ secret: TEST_SECRET });
  const events: unknown[] = [];
  tm.onEvent((e) => events.push(e));

  tm.revokeToken("some-jti", "test-reason");

  assert.ok(events.some((e: any) => e.type === "token:revoked"));
});

// =============================================================================
// Factory & Singleton
// =============================================================================

test("resetTokenManager: resets the singleton", () => {
  resetTokenManager();
  // Should not throw — just resets internal state
  assert.ok(true);
});
