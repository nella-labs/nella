import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateBTP,
  calculateVI,
  calculateCVR,
  calculateRC,
  calculateTTG,
  calculateCost,
  aggregateAgentMetrics,
} from "../calculator";
import type { ValidationResults, Metrics, TokenUsage, Task, AgentResponse } from "../../types";
import type { ConstraintCheckResult } from "../../validators/constraint-checker";

// =============================================================================
// calculateBTP (Build/Test Pass)
// =============================================================================

test("calculateBTP: true when all pass", () => {
  const v: ValidationResults = {
    testPassed: true, testOutput: "",
    lintPassed: true, lintOutput: "",
    compilePassed: true, compileOutput: "",
  };
  assert.equal(calculateBTP(v), true);
});

test("calculateBTP: false when any fails", () => {
  const v: ValidationResults = {
    testPassed: true, testOutput: "",
    lintPassed: false, lintOutput: "error",
    compilePassed: true, compileOutput: "",
  };
  assert.equal(calculateBTP(v), false);
});

test("calculateBTP: true when all null (no checks run)", () => {
  const v: ValidationResults = {
    testPassed: null, testOutput: "",
    lintPassed: null, lintOutput: "",
    compilePassed: null, compileOutput: "",
  };
  assert.equal(calculateBTP(v), true);
});

test("calculateBTP: only considers non-null checks", () => {
  const v: ValidationResults = {
    testPassed: true, testOutput: "",
    lintPassed: null, lintOutput: "",
    compilePassed: null, compileOutput: "",
  };
  assert.equal(calculateBTP(v), true);
});

// =============================================================================
// calculateVI (Validation Integrity)
// =============================================================================

test("calculateVI: 1.0 when all pass", () => {
  const v: ValidationResults = {
    testPassed: true, testOutput: "",
    lintPassed: true, lintOutput: "",
    compilePassed: true, compileOutput: "",
  };
  assert.equal(calculateVI(v), 1.0);
});

test("calculateVI: 0.0 when all fail", () => {
  const v: ValidationResults = {
    testPassed: false, testOutput: "",
    lintPassed: false, lintOutput: "",
    compilePassed: false, compileOutput: "",
  };
  assert.equal(calculateVI(v), 0.0);
});

test("calculateVI: ratio of passes", () => {
  const v: ValidationResults = {
    testPassed: true, testOutput: "",
    lintPassed: false, lintOutput: "",
    compilePassed: true, compileOutput: "",
  };
  const vi = calculateVI(v);
  assert.ok(Math.abs(vi - 2 / 3) < 0.01);
});

test("calculateVI: 1.0 when all null", () => {
  const v: ValidationResults = {
    testPassed: null, testOutput: "",
    lintPassed: null, lintOutput: "",
    compilePassed: null, compileOutput: "",
  };
  assert.equal(calculateVI(v), 1.0);
});

// =============================================================================
// calculateCVR (Constraint Violation Rate)
// =============================================================================

test("calculateCVR: 0 when no violations", () => {
  const checks: ConstraintCheckResult[] = [
    { constraintId: "c1", violated: false },
    { constraintId: "c2", violated: false },
  ];
  assert.equal(calculateCVR(checks, 2), 0);
});

test("calculateCVR: 1 when all violated", () => {
  const checks: ConstraintCheckResult[] = [
    { constraintId: "c1", violated: true, reason: "bad" },
  ];
  assert.equal(calculateCVR(checks, 1), 1);
});

test("calculateCVR: ratio", () => {
  const checks: ConstraintCheckResult[] = [
    { constraintId: "c1", violated: true, reason: "x" },
    { constraintId: "c2", violated: false },
  ];
  assert.equal(calculateCVR(checks, 4), 0.25);
});

test("calculateCVR: 0 when no constraints", () => {
  assert.equal(calculateCVR([], 0), 0);
});

// =============================================================================
// calculateRC (Refusal Correctness)
// =============================================================================

test("calculateRC: null for non-refusal tasks", () => {
  const task = { refusalExpected: false } as Task;
  const response: AgentResponse = { action: "edit", files: [], explanation: "" };
  assert.equal(calculateRC(task, response), null);
});

test("calculateRC: true when correctly refused", () => {
  const task = { refusalExpected: true } as Task;
  const response: AgentResponse = { action: "refuse", files: [], explanation: "" };
  assert.equal(calculateRC(task, response), true);
});

test("calculateRC: false when should have refused but didn't", () => {
  const task = { refusalExpected: true } as Task;
  const response: AgentResponse = { action: "edit", files: [], explanation: "" };
  assert.equal(calculateRC(task, response), false);
});

// =============================================================================
// calculateTTG (Time to Green)
// =============================================================================

test("calculateTTG: converts ms to seconds", () => {
  const ttg = calculateTTG(1000, 6000);
  assert.equal(ttg, 5);
});

test("calculateTTG: zero duration", () => {
  assert.equal(calculateTTG(100, 100), 0);
});

// =============================================================================
// calculateCost
// =============================================================================

test("calculateCost: correct token count and cost", () => {
  const usage: TokenUsage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 };
  const result = calculateCost(usage, "claude-sonnet-4-20250514");

  assert.equal(result.tokensUsed, 1500);
  // Input: 1000 * 3 / 1M = 0.003, Output: 500 * 15 / 1M = 0.0075
  assert.ok(Math.abs(result.estimatedCost - 0.0105) < 0.001);
});

test("calculateCost: unknown model returns 0 cost", () => {
  const usage: TokenUsage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 };
  const result = calculateCost(usage, "unknown-model");
  assert.equal(result.tokensUsed, 1500);
  assert.equal(result.estimatedCost, 0);
});

// =============================================================================
// aggregateAgentMetrics
// =============================================================================

test("aggregateAgentMetrics: empty returns zeros", () => {
  const agg = aggregateAgentMetrics([]);
  assert.equal(agg.passRate, 0);
  assert.equal(agg.avgVi, 0);
  assert.equal(agg.totalCost, 0);
});

test("aggregateAgentMetrics: correct averages", () => {
  const metrics: Metrics[] = [
    { btp: true, vi: 1.0, cvr: 0, sc: 0, rc: null, ttg: 10, ic: 1, da: 0.9, tokensUsed: 1000, estimatedCost: 0.01 },
    { btp: false, vi: 0.5, cvr: 0.5, sc: 0.2, rc: null, ttg: 20, ic: 3, da: 0.7, tokensUsed: 2000, estimatedCost: 0.02 },
  ];

  const agg = aggregateAgentMetrics(metrics);
  assert.equal(agg.passRate, 0.5);
  assert.equal(agg.avgVi, 0.75);
  assert.equal(agg.avgCvr, 0.25);
  assert.equal(agg.avgSc, 0.1);
  assert.equal(agg.avgTtg, 15);
  assert.equal(agg.avgIc, 2);
  assert.equal(agg.avgDa, 0.8);
  assert.equal(agg.totalTokens, 3000);
  assert.ok(Math.abs(agg.totalCost - 0.03) < 0.001);
});

test("aggregateAgentMetrics: refusalRate", () => {
  const metrics: Metrics[] = [
    { btp: true, vi: 1, cvr: 0, sc: 0, rc: true, ttg: 5, ic: 1, da: 1, tokensUsed: 100, estimatedCost: 0 },
    { btp: true, vi: 1, cvr: 0, sc: 0, rc: false, ttg: 5, ic: 1, da: 1, tokensUsed: 100, estimatedCost: 0 },
    { btp: true, vi: 1, cvr: 0, sc: 0, rc: null, ttg: 5, ic: 1, da: 1, tokensUsed: 100, estimatedCost: 0 },
  ];

  const agg = aggregateAgentMetrics(metrics);
  assert.equal(agg.refusalRate, 0.5); // 1 correct out of 2 refusal tasks
});

test("aggregateAgentMetrics: refusalRate 1 when no refusal tasks", () => {
  const metrics: Metrics[] = [
    { btp: true, vi: 1, cvr: 0, sc: 0, rc: null, ttg: 5, ic: 1, da: 1, tokensUsed: 100, estimatedCost: 0 },
  ];

  assert.equal(aggregateAgentMetrics(metrics).refusalRate, 1);
});
