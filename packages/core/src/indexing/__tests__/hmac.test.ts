import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveHmacKey,
  signResultHmac,
  verifyResultHmac,
  signResponseHmac,
  verifyResponseHmac,
} from "../hmac";

describe("HMAC signing module", () => {
  const sessionToken = "nella-verify-a1b2c3d4e5f67890abcdef1234567890";
  const hmacKey = deriveHmacKey(sessionToken);

  describe("deriveHmacKey", () => {
    it("returns a 32-byte buffer", () => {
      assert.equal(hmacKey.length, 32);
      assert.ok(Buffer.isBuffer(hmacKey));
    });

    it("is deterministic for the same token", () => {
      const key2 = deriveHmacKey(sessionToken);
      assert.ok(hmacKey.equals(key2));
    });

    it("produces different keys for different tokens", () => {
      const otherKey = deriveHmacKey("nella-verify-0000000000000000000000000000000");
      assert.ok(!hmacKey.equals(otherKey));
    });
  });

  describe("signResultHmac / verifyResultHmac", () => {
    const content = 'function hello() { return "world"; }';
    const nonce = "a7f3b9c2";

    it("produces a valid signature", () => {
      const sig = signResultHmac(content, hmacKey, nonce);
      assert.equal(sig.tag.length, 16);
      assert.equal(sig.nonce, nonce);
      assert.ok(verifyResultHmac(content, sig, hmacKey));
    });

    it("rejects tampered content", () => {
      const sig = signResultHmac(content, hmacKey, nonce);
      const tampered = content + " // injected";
      assert.ok(!verifyResultHmac(tampered, sig, hmacKey));
    });

    it("rejects wrong nonce", () => {
      const sig = signResultHmac(content, hmacKey, nonce);
      const wrongNonceSig = { ...sig, nonce: "00000000" };
      assert.ok(!verifyResultHmac(content, wrongNonceSig, hmacKey));
    });

    it("rejects wrong key", () => {
      const sig = signResultHmac(content, hmacKey, nonce);
      const otherKey = deriveHmacKey("nella-verify-different-token-value-here");
      assert.ok(!verifyResultHmac(content, sig, otherKey));
    });

    it("is deterministic", () => {
      const sig1 = signResultHmac(content, hmacKey, nonce);
      const sig2 = signResultHmac(content, hmacKey, nonce);
      assert.equal(sig1.tag, sig2.tag);
    });

    it("different content produces different tags", () => {
      const sig1 = signResultHmac("content A", hmacKey, nonce);
      const sig2 = signResultHmac("content B", hmacKey, nonce);
      assert.notEqual(sig1.tag, sig2.tag);
    });

    it("different nonces produce different tags", () => {
      const sig1 = signResultHmac(content, hmacKey, "aaaa1111");
      const sig2 = signResultHmac(content, hmacKey, "bbbb2222");
      assert.notEqual(sig1.tag, sig2.tag);
    });
  });

  describe("signResponseHmac / verifyResponseHmac", () => {
    const fullResponse = "[NELLA SEARCH RESULTS]\nresult 1\nresult 2\n[END]";
    const nonce = "c4d5e6f7";

    it("produces a 16-char hex tag", () => {
      const tag = signResponseHmac(fullResponse, hmacKey, nonce);
      assert.equal(tag.length, 16);
      assert.match(tag, /^[0-9a-f]{16}$/);
    });

    it("verifies correctly", () => {
      const tag = signResponseHmac(fullResponse, hmacKey, nonce);
      assert.ok(verifyResponseHmac(fullResponse, tag, hmacKey, nonce));
    });

    it("rejects tampered response", () => {
      const tag = signResponseHmac(fullResponse, hmacKey, nonce);
      assert.ok(!verifyResponseHmac(fullResponse + "\ninjected", tag, hmacKey, nonce));
    });

    it("rejects wrong nonce", () => {
      const tag = signResponseHmac(fullResponse, hmacKey, nonce);
      assert.ok(!verifyResponseHmac(fullResponse, tag, hmacKey, "00000000"));
    });
  });
});
