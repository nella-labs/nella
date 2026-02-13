/**
 * Auth Middleware Tests (IPFilter + RequestSigner)
 *
 * Tests for IP whitelisting/CIDR matching and HMAC request signing/verification.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { IPFilter, RequestSigner } from "../middleware";

// =============================================================================
// IPFilter
// =============================================================================

describe("IPFilter", () => {
  describe("disabled", () => {
    it("allows all IPs when disabled", () => {
      const filter = new IPFilter({ enabled: false });
      const result = filter.isAllowed("8.8.8.8");
      assert.ok(result.allowed);
    });
  });

  describe("localhost", () => {
    it("allows 127.0.0.1 when allowLocalhost=true", () => {
      const filter = new IPFilter({ enabled: true, allowLocalhost: true, addresses: [] });
      assert.ok(filter.isAllowed("127.0.0.1").allowed);
    });

    it("allows ::1 when allowLocalhost=true", () => {
      const filter = new IPFilter({ enabled: true, allowLocalhost: true, addresses: [] });
      assert.ok(filter.isAllowed("::1").allowed);
    });

    it("blocks localhost when allowLocalhost=false", () => {
      const filter = new IPFilter({ enabled: true, allowLocalhost: false, addresses: [] });
      assert.ok(!filter.isAllowed("127.0.0.1").allowed);
    });
  });

  describe("exact IP match", () => {
    it("allows whitelisted IP", () => {
      const filter = new IPFilter({
        enabled: true,
        allowLocalhost: false,
        addresses: ["10.0.0.5"],
      });
      assert.ok(filter.isAllowed("10.0.0.5").allowed);
    });

    it("blocks non-whitelisted IP", () => {
      const filter = new IPFilter({
        enabled: true,
        allowLocalhost: false,
        addresses: ["10.0.0.5"],
      });
      assert.ok(!filter.isAllowed("10.0.0.6").allowed);
    });
  });

  describe("CIDR range", () => {
    it("allows IP within CIDR range", () => {
      const filter = new IPFilter({
        enabled: true,
        allowLocalhost: false,
        addresses: ["192.168.1.0/24"],
      });
      assert.ok(filter.isAllowed("192.168.1.100").allowed);
      assert.ok(filter.isAllowed("192.168.1.1").allowed);
      assert.ok(filter.isAllowed("192.168.1.254").allowed);
    });

    it("blocks IP outside CIDR range", () => {
      const filter = new IPFilter({
        enabled: true,
        allowLocalhost: false,
        addresses: ["192.168.1.0/24"],
      });
      assert.ok(!filter.isAllowed("192.168.2.1").allowed);
    });
  });

  describe("wildcard", () => {
    it("allows all IPs with wildcard rule", () => {
      const filter = new IPFilter({
        enabled: true,
        allowLocalhost: false,
        addresses: ["*"],
      });
      assert.ok(filter.isAllowed("8.8.8.8").allowed);
      assert.ok(filter.isAllowed("1.2.3.4").allowed);
    });
  });

  describe("IPv6-mapped IPv4", () => {
    it("normalizes ::ffff: prefix", () => {
      const filter = new IPFilter({
        enabled: true,
        allowLocalhost: false,
        addresses: ["10.0.0.1"],
      });
      assert.ok(filter.isAllowed("::ffff:10.0.0.1").allowed);
    });
  });

  describe("addAllowedIP / removeAllowedIP", () => {
    it("dynamically adds and removes IPs", () => {
      const filter = new IPFilter({ enabled: true, allowLocalhost: false, addresses: [] });

      assert.ok(!filter.isAllowed("10.0.0.1").allowed);
      filter.addAllowedIP("10.0.0.1");
      assert.ok(filter.isAllowed("10.0.0.1").allowed);
      filter.removeAllowedIP("10.0.0.1");
      assert.ok(!filter.isAllowed("10.0.0.1").allowed);
    });
  });

  describe("isAllowedChain", () => {
    it("validates first IP in chain", () => {
      const filter = new IPFilter({
        enabled: true,
        allowLocalhost: false,
        addresses: ["10.0.0.1"],
      });
      const result = filter.isAllowedChain(["10.0.0.1", "10.0.0.2"]);
      assert.ok(result.allowed);
    });

    it("rejects if first IP is not allowed", () => {
      const filter = new IPFilter({
        enabled: true,
        allowLocalhost: false,
        addresses: ["10.0.0.2"],
      });
      const result = filter.isAllowedChain(["10.0.0.1", "10.0.0.2"]);
      assert.ok(!result.allowed);
    });
  });

  describe("enable/disable toggle", () => {
    it("can toggle enabled state", () => {
      const filter = new IPFilter({ enabled: true, addresses: [] });
      assert.ok(filter.isEnabled());
      filter.setEnabled(false);
      assert.ok(!filter.isEnabled());
      assert.ok(filter.isAllowed("anything").allowed);
    });
  });

  describe("events", () => {
    it("emits ip:blocked event for blocked IPs", () => {
      const filter = new IPFilter({ enabled: true, allowLocalhost: false, addresses: [] });
      const events: any[] = [];
      filter.onEvent((e) => events.push(e));

      filter.isAllowed("1.2.3.4");
      assert.equal(events.length, 1);
      assert.equal(events[0].type, "ip:blocked");
    });
  });
});

// =============================================================================
// RequestSigner
// =============================================================================

describe("RequestSigner", () => {
  let signer: RequestSigner;

  beforeEach(() => {
    signer = new RequestSigner({ enabled: true, algorithm: "hmac-sha256", timestampTolerance: 300 });
    signer.registerSecret("key-1", "supersecret");
  });

  describe("signRequest + verifyRequest roundtrip", () => {
    it("signs and verifies a GET request", () => {
      const headers = signer.signRequest("key-1", "GET", "/api/v1/health");
      const result = signer.verifyRequest(headers, "GET", "/api/v1/health");

      assert.ok(result.valid);
      assert.equal(result.keyId, "key-1");
    });

    it("signs and verifies a POST request with body", () => {
      const body = { name: "test", value: 42 };
      const headers = signer.signRequest("key-1", "POST", "/api/v1/data", body);
      const result = signer.verifyRequest(headers, "POST", "/api/v1/data", body);

      assert.ok(result.valid);
    });

    it("signs and verifies with string body", () => {
      const body = "raw body content";
      const headers = signer.signRequest("key-1", "PUT", "/api/v1/file", body);
      const result = signer.verifyRequest(headers, "PUT", "/api/v1/file", body);

      assert.ok(result.valid);
    });
  });

  describe("verification failures", () => {
    it("rejects when signature is tampered", () => {
      const headers = signer.signRequest("key-1", "GET", "/api/v1/data");
      headers["x-nella-signature"] = "tampered-signature";

      const result = signer.verifyRequest(headers, "GET", "/api/v1/data");
      assert.ok(!result.valid);
      assert.ok(result.error?.includes("Invalid signature") || result.error?.includes("length"));
    });

    it("rejects mismatched method", () => {
      const headers = signer.signRequest("key-1", "GET", "/api/v1/data");
      const result = signer.verifyRequest(headers, "POST", "/api/v1/data");
      assert.ok(!result.valid);
    });

    it("rejects mismatched path", () => {
      const headers = signer.signRequest("key-1", "GET", "/api/v1/data");
      const result = signer.verifyRequest(headers, "GET", "/api/v1/other");
      assert.ok(!result.valid);
    });

    it("rejects unknown key ID", () => {
      const headers = signer.signRequest("key-1", "GET", "/path");
      headers["x-nella-key-id"] = "unknown-key";

      const result = signer.verifyRequest(headers, "GET", "/path");
      assert.ok(!result.valid);
      assert.ok(result.error?.includes("Unknown key"));
    });

    it("rejects missing headers", () => {
      const result = signer.verifyRequest({}, "GET", "/path");
      assert.ok(!result.valid);
      assert.ok(result.error?.includes("Missing"));
    });

    it("rejects expired timestamp", () => {
      const headers = signer.signRequest("key-1", "GET", "/path");
      // Set timestamp to 10 minutes ago (tolerance is 300s = 5min)
      headers["x-nella-timestamp"] = String(Math.floor(Date.now() / 1000) - 600);

      const result = signer.verifyRequest(headers, "GET", "/path");
      assert.ok(!result.valid);
      assert.ok(result.error?.includes("timestamp"));
    });

    it("rejects body hash mismatch", () => {
      const body = { data: "original" };
      const headers = signer.signRequest("key-1", "POST", "/path", body);

      const tamperedBody = { data: "tampered" };
      const result = signer.verifyRequest(headers, "POST", "/path", tamperedBody);
      assert.ok(!result.valid);
    });
  });

  describe("disabled signer", () => {
    it("allows all requests when disabled", () => {
      signer.setEnabled(false);
      const result = signer.verifyRequest({}, "GET", "/any");
      assert.ok(result.valid);
    });
  });

  describe("secret management", () => {
    it("throws when signing with unregistered key", () => {
      assert.throws(() => signer.signRequest("no-such-key", "GET", "/p"), /No signing secret/);
    });

    it("supports registering and removing secrets", () => {
      signer.registerSecret("key-2", "secret2");
      assert.ok(signer.hasSecret("key-2"));
      signer.removeSecret("key-2");
      assert.ok(!signer.hasSecret("key-2"));
    });
  });

  describe("events", () => {
    it("emits signature:invalid event on failure", () => {
      const events: any[] = [];
      signer.onEvent((e) => events.push(e));

      const headers = signer.signRequest("key-1", "GET", "/path");
      headers["x-nella-signature"] = "bad";
      signer.verifyRequest(headers, "GET", "/path");

      assert.ok(events.some((e) => e.type === "signature:invalid"));
    });
  });
});
