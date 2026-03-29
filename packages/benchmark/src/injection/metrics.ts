/**
 * Injection Benchmark Metrics Calculator
 *
 * Computes detection rate, false positive rate, precision, F1, and
 * per-category/per-difficulty breakdowns from sample test results.
 */

import type {
  CI,
  SampleTestResult,
  LayerTestResult,
  CategoryMetrics,
  DifficultyMetrics,
  LayerMetrics,
  InjectionSample,
  SampleDifficulty,
} from "./types";
import { wilsonCI } from "./stats";

// =============================================================================
// Core Metrics
// =============================================================================

export interface HeadlineMetrics {
  detectionRate: number;
  falsePositiveRate: number;
  precision: number;
  f1Score: number;
  detectionRateCI: CI;
  falsePositiveRateCI: CI;
  precisionCI: CI;
}

/**
 * Compute headline confusion-matrix metrics from sample results.
 */
export function computeHeadlineMetrics(results: SampleTestResult[]): HeadlineMetrics {
  let tp = 0, fp = 0, tn = 0, fn = 0;

  for (const r of results) {
    switch (r.classification) {
      case "TP": tp++; break;
      case "FP": fp++; break;
      case "TN": tn++; break;
      case "FN": fn++; break;
    }
  }

  const detectionRate = tp + fn > 0 ? tp / (tp + fn) : 1;
  const falsePositiveRate = fp + tn > 0 ? fp / (fp + tn) : 0;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = detectionRate;
  const f1Score = precision + recall > 0
    ? 2 * (precision * recall) / (precision + recall)
    : 0;

  const detectionRateCI = wilsonCI(tp, tp + fn);
  const falsePositiveRateCI = wilsonCI(fp, fp + tn);
  const precisionCI = wilsonCI(tp, tp + fp);

  return { detectionRate, falsePositiveRate, precision, f1Score, detectionRateCI, falsePositiveRateCI, precisionCI };
}

// =============================================================================
// Per-Category Breakdown
// =============================================================================

/**
 * Compute metrics grouped by injection category.
 */
export function computeCategoryMetrics(
  results: SampleTestResult[],
  samples: InjectionSample[],
): CategoryMetrics[] {
  // Build sample lookup
  const sampleMap = new Map(samples.map(s => [s.id, s]));

  // Group results by category
  const groups = new Map<string, SampleTestResult[]>();
  for (const r of results) {
    const sample = sampleMap.get(r.sampleId);
    const category = sample?.category || "unknown";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)!.push(r);
  }

  const metrics: CategoryMetrics[] = [];

  for (const [category, categoryResults] of groups) {
    let tp = 0, fp = 0, tn = 0, fn = 0;
    let scoreSum = 0;

    for (const r of categoryResults) {
      switch (r.classification) {
        case "TP": tp++; break;
        case "FP": fp++; break;
        case "TN": tn++; break;
        case "FN": fn++; break;
      }
      scoreSum += r.scannerScore;
    }

    const total = categoryResults.length;
    const detectionRate = tp + fn > 0 ? tp / (tp + fn) : 1;
    const falsePositiveRate = fp + tn > 0 ? fp / (fp + tn) : 0;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
    const recall = detectionRate;
    const f1Score = precision + recall > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 0;

    metrics.push({
      category,
      totalSamples: total,
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
      detectionRate,
      falsePositiveRate,
      precision,
      recall,
      f1Score,
      averageScore: total > 0 ? scoreSum / total : 0,
      detectionRateCI: wilsonCI(tp, tp + fn),
      falsePositiveRateCI: wilsonCI(fp, fp + tn),
      precisionCI: wilsonCI(tp, tp + fp),
    });
  }

  // Sort by category name for consistent output
  return metrics.sort((a, b) => a.category.localeCompare(b.category));
}

// =============================================================================
// Per-Difficulty Breakdown
// =============================================================================

/**
 * Compute metrics grouped by difficulty level.
 */
export function computeDifficultyMetrics(
  results: SampleTestResult[],
  samples: InjectionSample[],
): DifficultyMetrics[] {
  const sampleMap = new Map(samples.map(s => [s.id, s]));

  const groups = new Map<SampleDifficulty, SampleTestResult[]>();
  for (const r of results) {
    const sample = sampleMap.get(r.sampleId);
    const difficulty = sample?.difficulty || "easy";
    if (!groups.has(difficulty)) groups.set(difficulty, []);
    groups.get(difficulty)!.push(r);
  }

  const order: SampleDifficulty[] = ["easy", "medium", "hard"];
  const metrics: DifficultyMetrics[] = [];

  for (const difficulty of order) {
    const diffResults = groups.get(difficulty);
    if (!diffResults) continue;

    let tp = 0, fp = 0, tn = 0, fn = 0;
    let scoreSum = 0;

    for (const r of diffResults) {
      switch (r.classification) {
        case "TP": tp++; break;
        case "FP": fp++; break;
        case "TN": tn++; break;
        case "FN": fn++; break;
      }
      scoreSum += r.scannerScore;
    }

    const total = diffResults.length;

    metrics.push({
      difficulty,
      totalSamples: total,
      detectionRate: tp + fn > 0 ? tp / (tp + fn) : 1,
      falsePositiveRate: fp + tn > 0 ? fp / (fp + tn) : 0,
      averageScore: total > 0 ? scoreSum / total : 0,
      detectionRateCI: wilsonCI(tp, tp + fn),
    });
  }

  return metrics;
}

// =============================================================================
// Per-Layer Breakdown
// =============================================================================

/**
 * Compute pass rates per defense layer.
 */
export function computeLayerMetrics(results: LayerTestResult[]): LayerMetrics[] {
  const groups = new Map<number, LayerTestResult[]>();

  for (const r of results) {
    if (!groups.has(r.layer)) groups.set(r.layer, []);
    groups.get(r.layer)!.push(r);
  }

  const metrics: LayerMetrics[] = [];

  for (const [layer, layerResults] of groups) {
    const passed = layerResults.filter(r => r.passed).length;
    metrics.push({
      layer,
      layerName: layerResults[0]?.layerName || `Layer ${layer}`,
      totalTests: layerResults.length,
      passed,
      passRate: layerResults.length > 0 ? passed / layerResults.length : 1,
    });
  }

  return metrics.sort((a, b) => a.layer - b.layer);
}
