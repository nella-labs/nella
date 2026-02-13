/**
 * Agent Cost Estimation Tests
 *
 * Tests for estimateAgentCost() and MODEL_PRICING constants.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateAgentCost, MODEL_PRICING } from "../types";
import type { TokenUsage } from "../types";

// =============================================================================
// MODEL_PRICING
// =============================================================================

describe("MODEL_PRICING", () => {
  it("includes Anthropic models", () => {
    assert.ok(MODEL_PRICING["claude-sonnet-4-20250514"]);
    assert.ok(MODEL_PRICING["claude-opus-4-20250514"]);
    assert.ok(MODEL_PRICING["claude-3-5-sonnet-20241022"]);
  });

  it("includes OpenAI models", () => {
    assert.ok(MODEL_PRICING["gpt-4-turbo"]);
    assert.ok(MODEL_PRICING["gpt-4o"]);
    assert.ok(MODEL_PRICING["gpt-4o-mini"]);
  });

  it("all models have positive input and output costs", () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      assert.ok(pricing.inputCostPerMillion > 0, `${model} inputCostPerMillion should be > 0`);
      assert.ok(pricing.outputCostPerMillion > 0, `${model} outputCostPerMillion should be > 0`);
    }
  });

  it("output cost is always >= input cost", () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      assert.ok(
        pricing.outputCostPerMillion >= pricing.inputCostPerMillion,
        `${model}: output cost should be >= input cost`
      );
    }
  });
});

// =============================================================================
// estimateAgentCost
// =============================================================================

describe("estimateAgentCost", () => {
  it("calculates correct cost for claude-sonnet-4", () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    };

    const cost = estimateAgentCost("claude-sonnet-4-20250514", usage);

    // input: 1000/1M * 3 = 0.003
    // output: 500/1M * 15 = 0.0075
    // total: 0.0105
    assert.equal(cost, 0.003 + 0.0075);
  });

  it("calculates correct cost for gpt-4o-mini", () => {
    const usage: TokenUsage = {
      inputTokens: 10_000,
      outputTokens: 2_000,
      totalTokens: 12_000,
    };

    const cost = estimateAgentCost("gpt-4o-mini", usage);

    // input: 10000/1M * 0.15 = 0.0015
    // output: 2000/1M * 0.6 = 0.0012
    const expected = (10_000 / 1_000_000) * 0.15 + (2_000 / 1_000_000) * 0.6;
    assert.ok(Math.abs(cost - expected) < 1e-10, `Expected ${expected}, got ${cost}`);
  });

  it("returns 0 for unknown models", () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    };

    const cost = estimateAgentCost("unknown-model-xyz", usage);
    assert.equal(cost, 0);
  });

  it("returns 0 when tokens are 0", () => {
    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };

    const cost = estimateAgentCost("gpt-4o", usage);
    assert.equal(cost, 0);
  });

  it("handles large token counts correctly", () => {
    const usage: TokenUsage = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      totalTokens: 2_000_000,
    };

    const cost = estimateAgentCost("claude-opus-4-20250514", usage);

    // input: 1M/1M * 15 = 15
    // output: 1M/1M * 75 = 75
    assert.equal(cost, 15 + 75);
  });

  it("handles fractional token counts", () => {
    const usage: TokenUsage = {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    };

    const cost = estimateAgentCost("gpt-4o", usage);

    // input: 1/1M * 2.5 = 0.0000025
    // output: 1/1M * 10 = 0.00001
    const expected = (1 / 1_000_000) * 2.5 + (1 / 1_000_000) * 10;
    assert.ok(Math.abs(cost - expected) < 1e-15);
  });

  it("cost scales linearly with token count", () => {
    const base: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    };
    const doubled: TokenUsage = {
      inputTokens: 2000,
      outputTokens: 1000,
      totalTokens: 3000,
    };

    const model = "gpt-4-turbo";
    const baseCost = estimateAgentCost(model, base);
    const doubledCost = estimateAgentCost(model, doubled);

    assert.ok(
      Math.abs(doubledCost - baseCost * 2) < 1e-10,
      "Doubling tokens should double the cost"
    );
  });
});
