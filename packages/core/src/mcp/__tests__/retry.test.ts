import test from "node:test";
import assert from "node:assert/strict";
import { retryWithBackoff } from "../retry";
import { RetryExhaustedError } from "../errors";

// =============================================================================
// Success on first attempt
// =============================================================================

test("retryWithBackoff: succeeds on first attempt", async () => {
  const result = await retryWithBackoff(async () => "hello", {
    maxRetries: 3,
    baseDelay: 10,
  });
  assert.equal(result.result, "hello");
  assert.equal(result.attempts, 1);
  assert.equal(result.totalDelay, 0);
});

// =============================================================================
// Retry then succeed
// =============================================================================

test("retryWithBackoff: retries and succeeds", async () => {
  let callCount = 0;
  const result = await retryWithBackoff(
    async () => {
      callCount++;
      if (callCount < 3) throw new Error("ECONNRESET");
      return "ok";
    },
    { maxRetries: 3, baseDelay: 10 },
  );
  assert.equal(result.result, "ok");
  assert.equal(result.attempts, 3);
  assert.ok(result.totalDelay > 0);
});

// =============================================================================
// Exhausted retries
// =============================================================================

test("retryWithBackoff: throws RetryExhaustedError when all retries fail", async () => {
  await assert.rejects(
    async () =>
      retryWithBackoff(async () => { throw new Error("ECONNRESET"); }, {
        maxRetries: 2,
        baseDelay: 10,
      }),
    (err: unknown) => {
      assert.ok(err instanceof RetryExhaustedError);
      assert.equal((err as RetryExhaustedError).attempts, 3); // initial + 2 retries
      return true;
    },
  );
});

// =============================================================================
// Non-retryable error stops immediately
// =============================================================================

test("retryWithBackoff: stops on non-retryable error", async () => {
  let count = 0;
  await assert.rejects(
    async () =>
      retryWithBackoff(
        async () => {
          count++;
          throw new Error("syntax error");
        },
        {
          maxRetries: 3,
          baseDelay: 10,
          retryable: () => false,
        },
      ),
    (err: unknown) => err instanceof RetryExhaustedError,
  );
  assert.equal(count, 1);
});

// =============================================================================
// Custom retryable predicate
// =============================================================================

test("retryWithBackoff: respects custom retryable predicate", async () => {
  let count = 0;
  await assert.rejects(
    async () =>
      retryWithBackoff(
        async () => {
          count++;
          throw new Error("custom_error");
        },
        {
          maxRetries: 5,
          baseDelay: 10,
          retryable: (err) => err.message.includes("custom_error") && count < 3,
        },
      ),
  );
  // First call + 2 retries (predicate returned false on 3rd retry)
  assert.equal(count, 3);
});

// =============================================================================
// onRetry callback
// =============================================================================

test("retryWithBackoff: calls onRetry callback", async () => {
  const retryLog: { attempt: number; msg: string }[] = [];
  let calls = 0;

  await retryWithBackoff(
    async () => {
      calls++;
      if (calls < 2) throw new Error("timeout");
      return "done";
    },
    {
      maxRetries: 3,
      baseDelay: 10,
      onRetry: (attempt, error) => {
        retryLog.push({ attempt, msg: error.message });
      },
    },
  );

  assert.equal(retryLog.length, 1);
  assert.equal(retryLog[0].attempt, 1);
  assert.equal(retryLog[0].msg, "timeout");
});
