/**
 * Injection Benchmark Reporter
 *
 * Generates output in multiple formats:
 * - stats.json  — website-ready compact stats
 * - summary.md  — human-readable report
 * - results.csv — per-sample detail
 * - results.json — full benchmark results
 */

import * as fs from "fs";
import * as path from "path";
import type {
  CI,
  InjectionBenchmarkResults,
  WebsiteStats,
  SampleTestResult,
} from "./types";

// =============================================================================
// Website Stats (compact JSON for dashboard/marketing)
// =============================================================================

export function generateWebsiteStats(results: InjectionBenchmarkResults): WebsiteStats {
  const fmt = (n: number) => `${(n * 100).toFixed(1)}%`;
  const fmtCI = (ci?: CI) => ci ? `[${(ci.lower * 100).toFixed(1)}%, ${(ci.upper * 100).toFixed(1)}%]` : undefined;

  return {
    feature: "prompt-injection-defense",
    version: results.corpusVersion,
    runDate: results.runDate,
    corpus: {
      total: results.corpus.totalSamples,
      injection: results.corpus.injectionSamples,
      benign: results.corpus.benignSamples,
    },
    headline: {
      detectionRate: fmt(results.headline.detectionRate),
      falsePositiveRate: fmt(results.headline.falsePositiveRate),
      precision: fmt(results.headline.precision),
      f1Score: results.headline.f1Score.toFixed(3),
      boundaryIntegrity: fmt(results.headline.boundaryIntegrity),
      tokenLeakRate: fmt(results.headline.tokenLeakRate),
      hmacIntegrity: fmt(results.headline.hmacIntegrity),
      challengeResponseRate: fmt(results.headline.challengeResponseRate),
      detectionRateCI: fmtCI(results.headline.detectionRateCI),
      falsePositiveRateCI: fmtCI(results.headline.falsePositiveRateCI),
      precisionCI: fmtCI(results.headline.precisionCI),
    },
    categories: results.byCategory
      .filter(c => c.category !== "benign")
      .map(c => ({
        name: c.category,
        detectionRate: fmt(c.detectionRate),
        sampleCount: c.totalSamples,
      })),
  };
}

// =============================================================================
// Markdown Summary
// =============================================================================

export function generateMarkdownReport(results: InjectionBenchmarkResults): string {
  const lines: string[] = [];
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const pctCI = (n: number, ci?: CI) =>
    ci ? `${(n * 100).toFixed(1)}% [${(ci.lower * 100).toFixed(1)}%, ${(ci.upper * 100).toFixed(1)}%]` : pct(n);

  lines.push("# Prompt Injection Benchmark Results");
  lines.push("");
  lines.push(`**Run Date:** ${results.runDate}`);
  lines.push(`**Corpus:** v${results.corpusVersion} (${results.corpus.totalSamples} samples: ${results.corpus.injectionSamples} injection, ${results.corpus.benignSamples} benign)`);
  lines.push(`**Threshold:** ${results.threshold}`);
  lines.push("");

  // Headline
  lines.push("## Headline Metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Detection Rate | ${pctCI(results.headline.detectionRate, results.headline.detectionRateCI)} |`);
  lines.push(`| False Positive Rate | ${pctCI(results.headline.falsePositiveRate, results.headline.falsePositiveRateCI)} |`);
  lines.push(`| Precision | ${pctCI(results.headline.precision, results.headline.precisionCI)} |`);
  lines.push(`| F1 Score | ${results.headline.f1Score.toFixed(3)} |`);
  lines.push(`| Boundary Integrity | ${pct(results.headline.boundaryIntegrity)} |`);
  lines.push(`| Token Leak Rate | ${pct(results.headline.tokenLeakRate)} |`);
  lines.push(`| HMAC Integrity | ${pct(results.headline.hmacIntegrity)} |`);
  lines.push(`| Challenge-Response | ${pct(results.headline.challengeResponseRate)} |`);
  lines.push("");

  // Per-category
  lines.push("## Per-Category Breakdown");
  lines.push("");
  lines.push("| Category | DR | FPR | Precision | Samples | Avg Score |");
  lines.push("|----------|-----|-----|-----------|---------|-----------|");
  for (const c of results.byCategory) {
    lines.push(`| ${c.category} | ${pctCI(c.detectionRate, c.detectionRateCI)} | ${pctCI(c.falsePositiveRate, c.falsePositiveRateCI)} | ${pctCI(c.precision, c.precisionCI)} | ${c.totalSamples} | ${c.averageScore.toFixed(3)} |`);
  }
  lines.push("");

  // Per-difficulty
  lines.push("## Per-Difficulty Breakdown");
  lines.push("");
  lines.push("| Difficulty | DR | FPR | Samples | Avg Score |");
  lines.push("|------------|-----|-----|---------|-----------|");
  for (const d of results.byDifficulty) {
    lines.push(`| ${d.difficulty} | ${pctCI(d.detectionRate, d.detectionRateCI)} | ${pct(d.falsePositiveRate)} | ${d.totalSamples} | ${d.averageScore.toFixed(3)} |`);
  }
  lines.push("");

  // Per-layer
  lines.push("## Per-Layer Results");
  lines.push("");
  lines.push("| Layer | Tests | Pass Rate |");
  lines.push("|-------|-------|-----------|");
  for (const l of results.byLayer) {
    lines.push(`| L${l.layer}: ${l.layerName} | ${l.totalTests} | ${pct(l.passRate)} |`);
  }
  lines.push("");

  // Failed samples
  const failed = results.sampleResults.filter(r => r.classification === "FN" || r.classification === "FP");
  if (failed.length > 0) {
    lines.push("## Misclassified Samples");
    lines.push("");
    lines.push("| ID | Classification | Scanner Score | Detected Patterns |");
    lines.push("|----|---------------|---------------|-------------------|");
    for (const f of failed.slice(0, 50)) {
      lines.push(`| ${f.sampleId} | ${f.classification} | ${f.scannerScore.toFixed(3)} | ${f.detectedPatterns.join(", ") || "-"} |`);
    }
    if (failed.length > 50) {
      lines.push(`| ... | ${failed.length - 50} more | | |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// =============================================================================
// CSV Report
// =============================================================================

export function generateCsvReport(results: SampleTestResult[]): string {
  const headers = [
    "sample_id",
    "detected",
    "scanner_score",
    "heuristic_score",
    "recommendation",
    "classification",
    "pattern_accurate",
    "score_accurate",
    "detected_patterns",
    "execution_ms",
  ];

  const rows = results.map(r => [
    r.sampleId,
    r.detected,
    r.scannerScore.toFixed(4),
    r.heuristicScore.toFixed(4),
    r.recommendation,
    r.classification,
    r.patternAccurate,
    r.scoreAccurate,
    r.detectedPatterns.join(";"),
    r.executionTimeMs.toFixed(2),
  ]);

  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}

// =============================================================================
// Write All Reports
// =============================================================================

export function writeReports(
  results: InjectionBenchmarkResults,
  outputDir: string,
  formats: { json?: boolean; csv?: boolean; md?: boolean; website?: boolean } = {},
): string[] {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const written: string[] = [];

  // Always write full results
  if (formats.json !== false) {
    const jsonPath = path.join(outputDir, "results.json");
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
    written.push(jsonPath);
  }

  if (formats.csv !== false) {
    const csvPath = path.join(outputDir, "results.csv");
    fs.writeFileSync(csvPath, generateCsvReport(results.sampleResults));
    written.push(csvPath);
  }

  if (formats.md !== false) {
    const mdPath = path.join(outputDir, "summary.md");
    fs.writeFileSync(mdPath, generateMarkdownReport(results));
    written.push(mdPath);
  }

  if (formats.website) {
    const statsPath = path.join(outputDir, "stats.json");
    fs.writeFileSync(statsPath, JSON.stringify(generateWebsiteStats(results), null, 2));
    written.push(statsPath);
  }

  return written;
}
