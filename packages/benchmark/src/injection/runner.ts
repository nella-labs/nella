/**
 * Injection Benchmark Runner
 *
 * Orchestrates the full benchmark: loads corpus, runs all layer tests,
 * computes metrics, and generates reports.
 */

import * as crypto from "crypto";
import type {
  InjectionSample,
  InjectionBenchmarkResults,
  SampleTestResult,
} from "./types";
import { loadCorpus } from "./corpus-loader";
import { runScannerTests, runScorerTests, runIsolationTests } from "./layer-tests";
import {
  computeHeadlineMetrics,
  computeCategoryMetrics,
  computeDifficultyMetrics,
  computeLayerMetrics,
} from "./metrics";
import { writeReports } from "./reporter";

// =============================================================================
// Runner Options
// =============================================================================

export interface InjectionBenchmarkOptions {
  /** Path to corpus directory */
  corpusDir: string;
  /** Output directory for reports */
  outputDir: string;
  /** Detection threshold (default: 0.2) */
  threshold?: number;
  /** Output formats */
  formats?: {
    json?: boolean;
    csv?: boolean;
    md?: boolean;
    website?: boolean;
  };
  /** Print per-sample results */
  verbose?: boolean;
}

// =============================================================================
// Runner
// =============================================================================

export async function runInjectionBenchmark(
  options: InjectionBenchmarkOptions,
): Promise<InjectionBenchmarkResults> {
  const threshold = options.threshold ?? 0.2;
  const startTime = Date.now();

  // 1. Load corpus
  console.log(`Loading corpus from ${options.corpusDir}...`);
  const corpus = loadCorpus(options.corpusDir);

  if (corpus.errors.length > 0) {
    console.warn("Corpus loading warnings:");
    for (const err of corpus.errors) {
      console.warn(`  - ${err}`);
    }
  }

  const injectionSamples = corpus.samples.filter(s => s.expectedDetection);
  const benignSamples = corpus.samples.filter(s => !s.expectedDetection);

  console.log(`Loaded ${corpus.samples.length} samples (${injectionSamples.length} injection, ${benignSamples.length} benign)`);

  // 2. Run L2 scanner tests
  console.log("\nRunning L2 Content Scanner tests...");
  const scannerResults = runScannerTests(corpus.samples, threshold);
  const scannerHeadline = computeHeadlineMetrics(scannerResults);
  console.log(`  DR: ${(scannerHeadline.detectionRate * 100).toFixed(1)}% | FPR: ${(scannerHeadline.falsePositiveRate * 100).toFixed(1)}%`);

  // 3. Run L5 scorer tests
  console.log("Running L5 Heuristic Scorer tests...");
  const scorerResults = runScorerTests(corpus.samples, threshold);
  const scorerHeadline = computeHeadlineMetrics(scorerResults);
  console.log(`  DR: ${(scorerHeadline.detectionRate * 100).toFixed(1)}% | FPR: ${(scorerHeadline.falsePositiveRate * 100).toFixed(1)}%`);

  // 4. Run isolation layer tests (L1, L4, L4+)
  console.log("Running L1/L4 Isolation tests...");
  const isolationResults = runIsolationTests();
  const isolationPassed = isolationResults.filter(r => r.passed).length;
  console.log(`  ${isolationPassed}/${isolationResults.length} passed`);

  // 5. Merge scanner + scorer results (use scanner for classification, scorer for factors)
  const mergedResults: SampleTestResult[] = scannerResults.map((sr, i) => ({
    ...sr,
    heuristicScore: scorerResults[i]?.heuristicScore ?? 0,
    factors: scorerResults[i]?.factors ?? {},
  }));

  // 6. Compute metrics
  console.log("\nComputing metrics...");
  const headline = computeHeadlineMetrics(mergedResults);
  const byCategory = computeCategoryMetrics(mergedResults, corpus.samples);
  const byDifficulty = computeDifficultyMetrics(mergedResults, corpus.samples);

  // Build layer results from isolation tests + synthetic scanner/scorer entries
  const layerResults = [
    ...isolationResults,
  ];

  const byLayer = computeLayerMetrics(layerResults);

  // Add synthetic layer entries for scanner and scorer
  const scannerLayerMetrics = {
    layer: 2,
    layerName: "Content Scanner",
    totalTests: corpus.samples.length,
    passed: mergedResults.filter(r => r.classification === "TP" || r.classification === "TN").length,
    passRate: headline.detectionRate, // simplified
  };

  const allLayerMetrics = [scannerLayerMetrics, ...byLayer];

  // Compute isolation sub-metrics
  const boundaryTests = isolationResults.filter(r => r.layerName === "Boundary Isolation");
  const tokenTests = isolationResults.filter(r => r.layerName === "Token Stripping");
  const hmacTests = isolationResults.filter(r => r.layerName === "HMAC Integrity");
  const challengeTests = isolationResults.filter(r => r.layerName === "Challenge-Response");

  const boundaryIntegrity = boundaryTests.length > 0
    ? boundaryTests.filter(t => t.passed).length / boundaryTests.length : 1;
  const tokenLeakRate = tokenTests.length > 0
    ? tokenTests.filter(t => !t.passed).length / tokenTests.length : 0;
  const hmacIntegrity = hmacTests.length > 0
    ? hmacTests.filter(t => t.passed).length / hmacTests.length : 1;
  const challengeResponseRate = challengeTests.length > 0
    ? challengeTests.filter(t => t.passed).length / challengeTests.length : 1;

  // 7. Assemble results
  const results: InjectionBenchmarkResults = {
    runDate: new Date().toISOString(),
    runId: crypto.randomBytes(4).toString("hex"),
    version: "1.0.0",
    corpusVersion: corpus.metadata?.version || "1.0.0",
    threshold,
    corpus: {
      totalSamples: corpus.samples.length,
      injectionSamples: injectionSamples.length,
      benignSamples: benignSamples.length,
      categories: new Set(corpus.samples.map(s => s.category)).size,
    },
    headline: {
      detectionRate: headline.detectionRate,
      falsePositiveRate: headline.falsePositiveRate,
      precision: headline.precision,
      f1Score: headline.f1Score,
      boundaryIntegrity,
      tokenLeakRate,
      hmacIntegrity,
      challengeResponseRate,
      detectionRateCI: headline.detectionRateCI,
      falsePositiveRateCI: headline.falsePositiveRateCI,
      precisionCI: headline.precisionCI,
    },
    byCategory,
    byDifficulty,
    byLayer: allLayerMetrics,
    sampleResults: mergedResults,
    layerResults: isolationResults,
  };

  // 8. Verbose output
  if (options.verbose) {
    console.log("\n--- Per-Sample Results ---");
    for (const r of mergedResults) {
      const icon = r.classification === "TP" || r.classification === "TN" ? "OK" : "!!";
      console.log(`  [${icon}] ${r.sampleId}: ${r.classification} (scanner: ${r.scannerScore.toFixed(3)}, heuristic: ${r.heuristicScore.toFixed(3)})`);
    }
  }

  // 9. Write reports
  const duration = Date.now() - startTime;
  console.log(`\nBenchmark completed in ${duration}ms`);

  const written = writeReports(results, options.outputDir, {
    ...options.formats,
    json: true,
    csv: true,
    md: true,
  });

  for (const file of written) {
    console.log(`  Written: ${file}`);
  }

  // Print headline
  const fmtCI = (ci: { lower: number; upper: number }) =>
    `[${(ci.lower * 100).toFixed(1)}%, ${(ci.upper * 100).toFixed(1)}%]`;

  console.log("\n=== HEADLINE RESULTS ===");
  console.log(`Detection Rate:      ${(headline.detectionRate * 100).toFixed(1)}% ${fmtCI(headline.detectionRateCI)}`);
  console.log(`False Positive Rate: ${(headline.falsePositiveRate * 100).toFixed(1)}% ${fmtCI(headline.falsePositiveRateCI)}`);
  console.log(`Precision:           ${(headline.precision * 100).toFixed(1)}% ${fmtCI(headline.precisionCI)}`);
  console.log(`F1 Score:            ${headline.f1Score.toFixed(3)}`);
  console.log(`Boundary Integrity:  ${(boundaryIntegrity * 100).toFixed(1)}%`);
  console.log(`Token Leak Rate:     ${(tokenLeakRate * 100).toFixed(1)}%`);
  console.log(`HMAC Integrity:      ${(hmacIntegrity * 100).toFixed(1)}%`);
  console.log(`Challenge-Response:  ${(challengeResponseRate * 100).toFixed(1)}%`);

  return results;
}
