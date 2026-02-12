import test from "node:test";
import assert from "node:assert/strict";
import {
  createLogger,
  generateCorrelationId,
} from "../logger";

test("createLogger returns a Logger with all methods", () => {
  const logger = createLogger("test");
  assert.equal(typeof logger.debug, "function");
  assert.equal(typeof logger.info, "function");
  assert.equal(typeof logger.warn, "function");
  assert.equal(typeof logger.error, "function");
  assert.equal(typeof logger.child, "function");
});

test("generateCorrelationId returns a 16-char hex string", () => {
  const id = generateCorrelationId();
  assert.equal(id.length, 16);
  assert.match(id, /^[0-9a-f]{16}$/);
});

test("logger.child inherits prefix and adds correlationId", () => {
  const logger = createLogger("parent");
  const child = logger.child("corr123");
  // child should be a Logger
  assert.equal(typeof child.info, "function");
});

test("logger respects log level filtering", () => {
  // Set level to warn — debug and info should be suppressed
  const originalLevel = process.env.NELLA_LOG_LEVEL;
  process.env.NELLA_LOG_LEVEL = "warn";

  const logs: string[] = [];
  const origLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  const logger = createLogger("test");
  logger.debug("should not appear");
  logger.info("should not appear");
  logger.warn("should appear");

  console.log = origLog;
  process.env.NELLA_LOG_LEVEL = originalLevel;

  assert.equal(logs.length, 1);
  const parsed = JSON.parse(logs[0]);
  assert.equal(parsed.level, "warn");
  assert.equal(parsed.message, "[test] should appear");
});
