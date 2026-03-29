import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  wilsonCI,
  bootstrapCI,
  mcnemarTest,
  aggregateRuns,
  passAtK,
  passHatK,
  percentiles,
} from "../stats";

describe("Statistical Primitives", () => {
  describe("wilsonCI", () => {
    it("returns [0,0] for empty data", () => {
      const ci = wilsonCI(0, 0);
      assert.equal(ci.point, 0);
      assert.equal(ci.lower, 0);
      assert.equal(ci.upper, 0);
    });

    it("computes correct interval for 50%", () => {
      const ci = wilsonCI(50, 100);
      assert.ok(Math.abs(ci.point - 0.5) < 0.001);
      assert.ok(ci.lower > 0.39);
      assert.ok(ci.upper < 0.61);
    });

    it("handles extreme proportions", () => {
      const ci = wilsonCI(99, 100);
      assert.ok(ci.lower > 0.93);
      assert.ok(ci.upper <= 1.0);
    });

    it("handles 0 successes", () => {
      const ci = wilsonCI(0, 100);
      assert.equal(ci.point, 0);
      assert.equal(ci.lower, 0);
      assert.ok(ci.upper > 0);
      assert.ok(ci.upper < 0.05);
    });

    it("lower is always <= point <= upper", () => {
      for (const [s, n] of [[10, 100], [0, 50], [50, 50], [1, 3]]) {
        const ci = wilsonCI(s, n);
        assert.ok(ci.lower <= ci.point, `lower ${ci.lower} > point ${ci.point}`);
        assert.ok(ci.point <= ci.upper, `point ${ci.point} > upper ${ci.upper}`);
      }
    });

    it("wider CI for smaller samples", () => {
      const small = wilsonCI(5, 10);
      const large = wilsonCI(50, 100);
      const smallWidth = small.upper - small.lower;
      const largeWidth = large.upper - large.lower;
      assert.ok(smallWidth > largeWidth);
    });
  });

  describe("bootstrapCI", () => {
    it("returns [0,0] for empty data", () => {
      const ci = bootstrapCI([], (s) => s.filter(Boolean).length / (s.length || 1));
      assert.equal(ci.point, 0);
    });

    it("produces reasonable CI for known distribution", () => {
      // 80% success rate, 100 samples
      const samples = Array.from({ length: 100 }, (_, i) => i < 80);
      const ci = bootstrapCI(samples, (s) => s.filter(Boolean).length / s.length, 1000);
      assert.ok(Math.abs(ci.point - 0.8) < 0.001);
      assert.ok(ci.lower > 0.7);
      assert.ok(ci.upper < 0.9);
    });

    it("CI contains the point estimate", () => {
      const samples = Array.from({ length: 50 }, (_, i) => i < 30);
      const ci = bootstrapCI(samples, (s) => s.filter(Boolean).length / s.length);
      assert.ok(ci.lower <= ci.point);
      assert.ok(ci.point <= ci.upper);
    });
  });

  describe("mcnemarTest", () => {
    it("returns non-significant for identical outcomes", () => {
      const paired = Array.from({ length: 20 }, () => ({
        withNella: true,
        withoutNella: true,
      }));
      const result = mcnemarTest(paired);
      assert.ok(!result.significant);
      assert.ok(result.pValue > 0.05);
    });

    it("returns significant for clearly different outcomes", () => {
      // Nella defends all, no Nella defends none
      const paired = Array.from({ length: 20 }, () => ({
        withNella: false,    // attack failed (defended)
        withoutNella: true,  // attack succeeded (compromised)
      }));
      const result = mcnemarTest(paired);
      assert.ok(result.significant);
      assert.ok(result.pValue < 0.05);
    });

    it("handles empty data", () => {
      const result = mcnemarTest([]);
      assert.equal(result.chi2, 0);
      assert.equal(result.pValue, 1);
      assert.ok(!result.significant);
    });
  });

  describe("aggregateRuns", () => {
    it("handles empty array", () => {
      const stats = aggregateRuns([]);
      assert.equal(stats.n, 0);
      assert.equal(stats.mean, 0);
    });

    it("computes correct stats for known values", () => {
      const stats = aggregateRuns([0.7, 0.8, 0.9]);
      assert.ok(Math.abs(stats.mean - 0.8) < 0.001);
      assert.equal(stats.n, 3);
      assert.equal(stats.min, 0.7);
      assert.equal(stats.max, 0.9);
      assert.ok(stats.std > 0);
    });

    it("CI contains the mean", () => {
      const stats = aggregateRuns([0.6, 0.7, 0.8, 0.9, 1.0]);
      assert.ok(stats.ci95[0] <= stats.mean);
      assert.ok(stats.ci95[1] >= stats.mean);
    });

    it("single value has zero std", () => {
      const stats = aggregateRuns([0.5]);
      assert.equal(stats.mean, 0.5);
      assert.equal(stats.std, 0);
    });
  });

  describe("passAtK", () => {
    it("returns 0 for no runs", () => {
      assert.equal(passAtK(0, 0, 1), 0);
    });

    it("returns 1 when all correct", () => {
      assert.equal(passAtK(10, 10, 1), 1);
    });

    it("pass@1 equals success rate for simple case", () => {
      const result = passAtK(10, 8, 1);
      assert.ok(Math.abs(result - 0.8) < 0.001);
    });

    it("pass@k increases with k", () => {
      const p1 = passAtK(10, 5, 1);
      const p3 = passAtK(10, 5, 3);
      const p5 = passAtK(10, 5, 5);
      assert.ok(p1 < p3);
      assert.ok(p3 < p5);
    });

    it("pass@n is 1 if c > 0", () => {
      assert.equal(passAtK(10, 1, 10), 1);
    });
  });

  describe("passHatK", () => {
    it("returns 1 when all correct", () => {
      assert.equal(passHatK(10, 10, 5), 1);
    });

    it("decreases with k", () => {
      const p1 = passHatK(10, 8, 1);
      const p3 = passHatK(10, 8, 3);
      const p5 = passHatK(10, 8, 5);
      assert.ok(p1 > p3);
      assert.ok(p3 > p5);
    });

    it("returns 0 when none correct", () => {
      assert.equal(passHatK(10, 0, 1), 0);
    });
  });

  describe("percentiles", () => {
    it("handles empty array", () => {
      const p = percentiles([]);
      assert.equal(p.p50, 0);
    });

    it("computes correct percentiles", () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      const p = percentiles(values);
      assert.equal(p.p50, 50);
      assert.equal(p.p95, 95);
      assert.equal(p.p99, 99);
    });

    it("handles single value", () => {
      const p = percentiles([42]);
      assert.equal(p.p50, 42);
      assert.equal(p.p95, 42);
      assert.equal(p.p99, 42);
    });
  });
});
