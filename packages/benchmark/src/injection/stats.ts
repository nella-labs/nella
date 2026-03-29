/**
 * Statistical Primitives for Benchmark Evaluation
 *
 * Wilson score intervals, bootstrap resampling, McNemar's test,
 * multi-run aggregation, and pass@k computation.
 *
 * These ensure all published benchmark numbers include confidence
 * intervals and statistical significance tests.
 */

// =============================================================================
// Types
// =============================================================================

export interface ConfidenceInterval {
  point: number;
  lower: number;
  upper: number;
}

export interface AggregateStats {
  mean: number;
  std: number;
  ci95: [number, number];
  median: number;
  min: number;
  max: number;
  n: number;
}

export interface McNemarResult {
  chi2: number;
  pValue: number;
  significant: boolean; // at α = 0.05
  /** Counts: b = only-A-correct, c = only-B-correct */
  b: number;
  c: number;
}

// =============================================================================
// Wilson Score Confidence Interval
// =============================================================================

/**
 * Wilson score interval for a binomial proportion.
 *
 * More accurate than the normal approximation for small samples and
 * extreme proportions (near 0 or 1).
 *
 * @param successes  Number of successes (e.g., true positives)
 * @param total      Total number of trials
 * @param z          Z-score for confidence level (default: 1.96 for 95%)
 */
export function wilsonCI(
  successes: number,
  total: number,
  z: number = 1.96,
): ConfidenceInterval {
  if (total === 0) {
    return { point: 0, lower: 0, upper: 0 };
  }

  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);

  return {
    point: p,
    lower: Math.max(0, (center - margin) / denominator),
    upper: Math.min(1, (center + margin) / denominator),
  };
}

// =============================================================================
// Bootstrap Confidence Interval
// =============================================================================

/**
 * Bootstrap CI for an arbitrary metric computed from boolean samples.
 *
 * Resamples with replacement and computes the metric on each resample
 * to build an empirical distribution. Uses the percentile method.
 *
 * @param samples     Array of boolean outcomes (true = success)
 * @param metric      Function that computes a scalar from boolean array
 * @param iterations  Number of bootstrap iterations (default: 2000)
 * @param alpha       Significance level (default: 0.05 for 95% CI)
 */
export function bootstrapCI(
  samples: boolean[],
  metric: (s: boolean[]) => number,
  iterations: number = 2000,
  alpha: number = 0.05,
): ConfidenceInterval {
  if (samples.length === 0) {
    return { point: 0, lower: 0, upper: 0 };
  }

  const observed = metric(samples);
  const bootstrapValues: number[] = [];

  for (let i = 0; i < iterations; i++) {
    // Resample with replacement
    const resample: boolean[] = [];
    for (let j = 0; j < samples.length; j++) {
      resample.push(samples[Math.floor(Math.random() * samples.length)]);
    }
    bootstrapValues.push(metric(resample));
  }

  bootstrapValues.sort((a, b) => a - b);

  const lowerIdx = Math.floor((alpha / 2) * iterations);
  const upperIdx = Math.floor((1 - alpha / 2) * iterations);

  return {
    point: observed,
    lower: bootstrapValues[lowerIdx],
    upper: bootstrapValues[Math.min(upperIdx, iterations - 1)],
  };
}

// =============================================================================
// McNemar's Test
// =============================================================================

/**
 * McNemar's test for paired nominal data.
 *
 * Compares two conditions (e.g., with/without Nella) tested on the
 * SAME scenarios to determine if there's a statistically significant
 * difference in success rates.
 *
 * Uses the continuity-corrected chi-squared statistic.
 *
 * @param paired  Array of paired outcomes for each scenario
 */
export function mcnemarTest(
  paired: Array<{ withNella: boolean; withoutNella: boolean }>,
): McNemarResult {
  // b = succeeded WITHOUT Nella but NOT with Nella
  // c = succeeded WITH Nella but NOT without Nella
  let b = 0; // only withoutNella correct (Nella helped)
  let c = 0; // only withNella correct (Nella hurt)

  for (const p of paired) {
    // For injection benchmark: "success" means attack was DEFENDED
    // So we invert: defended = !attackSucceeded
    const defendedWithNella = !p.withNella;
    const defendedWithoutNella = !p.withoutNella;

    if (defendedWithoutNella && !defendedWithNella) b++;
    if (defendedWithNella && !defendedWithoutNella) c++;
  }

  // Continuity-corrected McNemar's chi2
  const total = b + c;
  if (total === 0) {
    return { chi2: 0, pValue: 1, significant: false, b, c };
  }

  const chi2 = Math.pow(Math.abs(b - c) - 1, 2) / (b + c);

  // Chi-squared CDF approximation (1 degree of freedom)
  const pValue = 1 - chi2CDF(chi2, 1);

  return {
    chi2,
    pValue,
    significant: pValue < 0.05,
    b,
    c,
  };
}

// =============================================================================
// Multi-Run Aggregation
// =============================================================================

/**
 * Aggregate a series of numeric values (e.g., rates from multiple runs).
 */
export function aggregateRuns(values: number[]): AggregateStats {
  if (values.length === 0) {
    return { mean: 0, std: 0, ci95: [0, 0], median: 0, min: 0, max: 0, n: 0 };
  }

  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;

  // Standard deviation
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1 || 1);
  const std = Math.sqrt(variance);

  // 95% CI using t-distribution (approximated by z for n >= 30, exact for small n)
  const tValue = n >= 30 ? 1.96 : tCritical(n - 1, 0.025);
  const margin = tValue * std / Math.sqrt(n);

  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];

  return {
    mean,
    std,
    ci95: [Math.max(0, mean - margin), Math.min(1, mean + margin)],
    median,
    min: sorted[0],
    max: sorted[n - 1],
    n,
  };
}

// =============================================================================
// Pass@k (Unbiased Estimator)
// =============================================================================

/**
 * Unbiased pass@k estimator.
 *
 * Given n total runs of which c are correct (defended successfully),
 * estimates the probability that at least one of k samples is correct.
 *
 * pass@k = 1 - C(n-c, k) / C(n, k)
 *
 * where C(a, b) is the binomial coefficient.
 */
export function passAtK(n: number, c: number, k: number): number {
  if (n <= 0 || k <= 0) return 0;
  if (c >= n) return 1;
  if (k > n) return c > 0 ? 1 : 0;

  // Use log-space to avoid overflow with large factorials
  // C(n-c, k) / C(n, k) = product_{i=0}^{k-1} (n-c-i) / (n-i)
  let logRatio = 0;
  for (let i = 0; i < k; i++) {
    if (n - c - i <= 0) return 1; // all k can be correct
    logRatio += Math.log(n - c - i) - Math.log(n - i);
  }

  return 1 - Math.exp(logRatio);
}

/**
 * Pass^k (consistency): probability of ALL k runs succeeding.
 * = (c/n)^k
 */
export function passHatK(n: number, c: number, k: number): number {
  if (n <= 0) return 0;
  return Math.pow(c / n, k);
}

// =============================================================================
// Latency Percentiles
// =============================================================================

/**
 * Compute percentiles from a sorted array of durations.
 */
export function percentiles(
  values: number[],
): { p50: number; p95: number; p99: number } {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0 };

  const sorted = [...values].sort((a, b) => a - b);

  const pct = (p: number) => {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  };

  return { p50: pct(50), p95: pct(95), p99: pct(99) };
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Chi-squared CDF for 1 degree of freedom (used by McNemar's test).
 * Uses the error function approximation.
 */
function chi2CDF(x: number, _df: number): number {
  if (x <= 0) return 0;
  // For df=1: chi2 CDF = 2 * Φ(√x) - 1 = erf(√(x/2))
  return erf(Math.sqrt(x / 2));
}

/**
 * Error function approximation (Abramowitz & Stegun, formula 7.1.26).
 * Maximum error: 1.5 × 10⁻⁷
 */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}

/**
 * Approximate t-distribution critical value for small samples.
 * Uses the Abramowitz & Stegun approximation.
 */
function tCritical(df: number, alpha: number): number {
  // For α=0.025 (two-tailed 95%)
  if (df >= 30) return 1.96;
  // Lookup table for common small sample sizes
  const table: Record<number, number> = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
    20: 2.086, 25: 2.060, 29: 2.045,
  };
  if (table[df]) return table[df];
  // Linear interpolation for gaps
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < keys.length - 1; i++) {
    if (df > keys[i] && df < keys[i + 1]) {
      const frac = (df - keys[i]) / (keys[i + 1] - keys[i]);
      return table[keys[i]] * (1 - frac) + table[keys[i + 1]] * frac;
    }
  }
  return 1.96; // fallback
}
