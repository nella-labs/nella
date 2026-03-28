import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveHmacKey, verifyResultHmac, verifyResponseHmac } from "@usenella/core";
import {
  generateNonce,
  stripToken,
  wrapSearchResult,
  wrapSearchResponse,
  SEARCH_PREAMBLE,
  SEARCH_EPILOGUE,
} from "../result-isolation";

describe("Result Isolation", () => {
  const sessionToken = "nella-verify-a1b2c3d4e5f67890abcdef1234567890";
  const hmacKey = deriveHmacKey(sessionToken);

  describe("generateNonce", () => {
    it("returns an 8-char hex string", () => {
      const nonce = generateNonce();
      assert.equal(nonce.length, 8);
      assert.match(nonce, /^[0-9a-f]{8}$/);
    });

    it("produces unique nonces", () => {
      const nonces = new Set(Array.from({ length: 100 }, () => generateNonce()));
      assert.equal(nonces.size, 100);
    });
  });

  describe("stripToken", () => {
    it("removes token from content", () => {
      const content = `Some text ${sessionToken} more text`;
      const result = stripToken(content, sessionToken);
      assert.ok(!result.includes(sessionToken));
      assert.ok(result.includes("[REDACTED]"));
    });

    it("removes multiple occurrences", () => {
      const content = `${sessionToken} and ${sessionToken}`;
      const result = stripToken(content, sessionToken);
      assert.equal(result, "[REDACTED] and [REDACTED]");
    });

    it("returns content unchanged if no token", () => {
      const content = "clean content";
      assert.equal(stripToken(content, ""), content);
    });
  });

  describe("wrapSearchResult (without HMAC)", () => {
    it("wraps content with boundary markers", () => {
      const result = wrapSearchResult(
        "function foo() {}",
        {
          filePath: "src/index.ts",
          lines: [1, 10],
          trustLevel: "trusted",
          resultIndex: 0,
          totalResults: 3,
        },
        "aabbccdd",
      );
      assert.ok(result.content.includes("RESULT 1/3"));
      assert.ok(result.content.includes("src/index.ts:1-10"));
      assert.ok(result.content.includes("trust: trusted"));
      assert.ok(result.content.includes("[nonce:aabbccdd]"));
      assert.ok(result.content.includes("END RESULT"));
      assert.equal(result.hmac, undefined);
    });

    it("includes injection warning when present", () => {
      const result = wrapSearchResult(
        "some content",
        {
          filePath: "x.ts",
          lines: [1, 5],
          resultIndex: 0,
          totalResults: 1,
          injectionWarning: "[NELLA WARNING: HIGH-risk patterns]",
        },
        "11223344",
      );
      assert.ok(result.content.includes("[NELLA WARNING: HIGH-risk patterns]"));
      assert.ok(result.hasWarnings);
    });
  });

  describe("wrapSearchResult (with HMAC)", () => {
    it("includes HMAC in boundary marker", () => {
      const nonce = "aabbccdd";
      const content = "function foo() {}";
      const result = wrapSearchResult(
        content,
        {
          filePath: "src/index.ts",
          lines: [1, 10],
          trustLevel: "trusted",
          resultIndex: 0,
          totalResults: 1,
        },
        nonce,
        hmacKey,
      );
      assert.ok(result.hmac);
      assert.equal(result.hmac!.tag.length, 16);
      assert.ok(result.content.includes(`|hmac:${result.hmac!.tag}`));
    });

    it("HMAC verifies against original content", () => {
      const nonce = "aabbccdd";
      const content = "const x = 42;";
      const result = wrapSearchResult(
        content,
        {
          filePath: "x.ts",
          lines: [1, 1],
          resultIndex: 0,
          totalResults: 1,
        },
        nonce,
        hmacKey,
      );
      assert.ok(verifyResultHmac(content, result.hmac!, hmacKey));
    });

    it("HMAC rejects tampered content", () => {
      const nonce = "aabbccdd";
      const content = "const x = 42;";
      const result = wrapSearchResult(
        content,
        {
          filePath: "x.ts",
          lines: [1, 1],
          resultIndex: 0,
          totalResults: 1,
        },
        nonce,
        hmacKey,
      );
      assert.ok(!verifyResultHmac("const x = 9999;", result.hmac!, hmacKey));
    });
  });

  describe("wrapSearchResponse", () => {
    it("includes preamble and epilogue", () => {
      const output = wrapSearchResponse("Found 1 result:", ["result content"]);
      assert.ok(output.includes(SEARCH_PREAMBLE));
      assert.ok(output.includes(SEARCH_EPILOGUE));
      assert.ok(output.includes("Found 1 result:"));
      assert.ok(output.includes("result content"));
    });

    it("strips session token", () => {
      const output = wrapSearchResponse(
        "header",
        [`some code with ${sessionToken} inside`],
        { sessionToken },
      );
      assert.ok(!output.includes(sessionToken));
      assert.ok(output.includes("[REDACTED]"));
    });

    it("appends outer HMAC when key provided", () => {
      const output = wrapSearchResponse(
        "header",
        ["result 1", "result 2"],
        { hmacKey },
      );
      assert.ok(output.includes("[NELLA INTEGRITY:"));
      // Format: [NELLA INTEGRITY: nonce:tag]
      const match = output.match(/\[NELLA INTEGRITY: ([0-9a-f]{8}):([0-9a-f]{16})\]/);
      assert.ok(match, "outer HMAC tag should be present");
    });

    it("outer HMAC covers token-stripped content", () => {
      const output = wrapSearchResponse(
        "header",
        [`code with ${sessionToken}`],
        { sessionToken, hmacKey },
      );
      // Token should be stripped AND outer HMAC should be present
      assert.ok(!output.includes(sessionToken));
      assert.ok(output.includes("[NELLA INTEGRITY:"));
    });
  });
});
