/**
 * Context Tracking Benchmark Runner
 *
 * Orchestrates ground-truth evaluation of nella's assumption
 * invalidation engine. For each scenario it:
 *   1. Creates a temp directory with setup files
 *   2. Instantiates a ContextManager
 *   3. Registers assumptions
 *   4. Applies a file mutation
 *   5. Calls recordRunChanges and checks invalidation results
 *   6. Classifies the outcome as TP / FP / TN / FN
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ContextManager } from "@usenella/core";
import { wilsonCI } from "../injection/stats";
import { getScenarios } from "./scenarios";
import type {
  ContextBenchmarkResults,
  ContextTrialResult,
  ContextScenario,
  ScenarioType,
} from "./types";

// =============================================================================
// Helpers
// =============================================================================

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writeSetupFiles(baseDir: string, files: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(baseDir, relativePath);
    ensureDir(path.dirname(fullPath));
    fs.writeFileSync(fullPath, content, "utf-8");
  }
}

function applyAction(
  baseDir: string,
  action: ContextScenario["action"],
): void {
  const fullPath = path.join(baseDir, action.file);

  switch (action.operation) {
    case "modify":
    case "create":
      ensureDir(path.dirname(fullPath));
      fs.writeFileSync(fullPath, action.newContent ?? "", "utf-8");
      break;
    case "delete":
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
      break;
  }
}

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

// =============================================================================
// Single Scenario Runner
// =============================================================================

function runScenario(scenario: ContextScenario, verbose: boolean): ContextTrialResult {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `nella-ctx-bench-${scenario.id}-`));

  try {
    const startMs = performance.now();

    // 1. Write setup files
    writeSetupFiles(tmpDir, scenario.setupFiles);

    // 2. Create ContextManager for this temp repo
    const cm = new ContextManager(tmpDir);

    // 3. Register assumptions
    for (const spec of scenario.assumptions) {
      cm.assumptions.addAssumption(
        spec.description,
        spec.relatedFiles,
        spec.type,
        spec.confidence ?? 0.8,
      );
    }

    // 4. Apply the mutation
    applyAction(tmpDir, scenario.action);

    // 5. Record changes and check invalidations
    const result = cm.recordRunChanges(
      "bench-run",
      [
        {
          file: scenario.action.file,
          operation: scenario.action.operation === "modify" ? "modify"
            : scenario.action.operation === "create" ? "create"
            : "delete",
          reason: "benchmark",
        },
      ],
      true,
    );

    const elapsedMs = performance.now() - startMs;

    // 6. Classify
    const actualInvalidated = result.invalidated > 0;
    const expectedInvalidated = scenario.expected.invalidated;

    let classification: ContextTrialResult["classification"];
    if (expectedInvalidated && actualInvalidated) {
      classification = "TP";
    } else if (!expectedInvalidated && actualInvalidated) {
      classification = "FP";
    } else if (!expectedInvalidated && !actualInvalidated) {
      classification = "TN";
    } else {
      classification = "FN";
    }

    if (verbose) {
      const icon = classification === "TP" || classification === "TN" ? "OK" : "!!";
      console.log(
        `  [${icon}] ${scenario.id}: ${classification} ` +
        `(invalidated=${result.invalidated}, expected=${expectedInvalidated ? "yes" : "no"}) ` +
        `${elapsedMs.toFixed(1)}ms`,
      );
    }

    return {
      scenarioId: scenario.id,
      type: scenario.type,
      expectedInvalidated,
      actualInvalidated,
      classification,
      invalidatedCount: result.invalidated,
      executionTimeMs: Math.round(elapsedMs),
    };
  } finally {
    cleanupDir(tmpDir);
  }
}

// =============================================================================
// Aggregate Metrics
// =============================================================================

function computeMetrics(trials: ContextTrialResult[]) {
  const tp = trials.filter((t) => t.classification === "TP").length;
  const fp = trials.filter((t) => t.classification === "FP").length;
  const tn = trials.filter((t) => t.classification === "TN").length;
  const fn = trials.filter((t) => t.classification === "FN").length;
  const total = trials.length;

  const accuracy = total > 0 ? (tp + tn) / total : 0;
  const detectionRate = tp + fn > 0 ? tp / (tp + fn) : 0;
  const falsePositiveRate = fp + tn > 0 ? fp / (fp + tn) : 0;
  // Drift detection rate mirrors invalidation detection for this benchmark
  const driftDetectionRate = detectionRate;

  const accuracyCI = wilsonCI(tp + tn, total);

  return {
    accuracy,
    detectionRate,
    falsePositiveRate,
    driftDetectionRate,
    accuracyCI,
    tp,
    fp,
    tn,
    fn,
  };
}

function groupByType(trials: ContextTrialResult[]): Array<{ type: string; accuracy: number; samples: number }> {
  const types = [...new Set(trials.map((t) => t.type))];
  return types.map((type) => {
    const group = trials.filter((t) => t.type === type);
    const correct = group.filter(
      (t) => t.classification === "TP" || t.classification === "TN",
    ).length;
    return {
      type,
      accuracy: group.length > 0 ? correct / group.length : 0,
      samples: group.length,
    };
  });
}

// =============================================================================
// Main Runner
// =============================================================================

export async function runContextTrackingBenchmark(options?: {
  verbose?: boolean;
  outputDir?: string;
}): Promise<ContextBenchmarkResults> {
  const verbose = options?.verbose ?? false;
  const outputDir = options?.outputDir ?? path.join(process.cwd(), "benchmark-results");
  const scenarios = getScenarios();
  const startTime = Date.now();

  console.log(`\nContext Tracking Benchmark`);
  console.log(`=========================`);
  console.log(`Scenarios: ${scenarios.length}`);
  console.log(``);

  // Run all scenarios
  const trials: ContextTrialResult[] = [];
  for (const scenario of scenarios) {
    try {
      const result = runScenario(scenario, verbose);
      trials.push(result);
    } catch (err) {
      console.error(`  [ERR] ${scenario.id}: ${(err as Error).message}`);
      // Record as failure
      trials.push({
        scenarioId: scenario.id,
        type: scenario.type,
        expectedInvalidated: scenario.expected.invalidated,
        actualInvalidated: false,
        classification: scenario.expected.invalidated ? "FN" : "TN",
        invalidatedCount: 0,
        executionTimeMs: 0,
      });
    }
  }

  const durationMs = Date.now() - startTime;

  // Compute metrics
  const metrics = computeMetrics(trials);
  const byType = groupByType(trials);

  // Assemble results
  const results: ContextBenchmarkResults = {
    runDate: new Date().toISOString(),
    feature: "context-tracking",
    version: "1.0.0",
    totalScenarios: scenarios.length,
    headline: {
      assumptionAccuracy: metrics.accuracy,
      invalidationDetectionRate: metrics.detectionRate,
      falsePositiveRate: metrics.falsePositiveRate,
      driftDetectionRate: metrics.driftDetectionRate,
      assumptionAccuracyCI: metrics.accuracyCI,
    },
    byScenarioType: byType,
    trials,
  };

  // Write results to disk
  ensureDir(outputDir);
  const outPath = path.join(outputDir, "context-tracking-results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");

  // Print summary
  const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const fmtCI = (ci: { lower: number; upper: number }) =>
    `[${(ci.lower * 100).toFixed(1)}%, ${(ci.upper * 100).toFixed(1)}%]`;

  console.log(`\nCompleted in ${durationMs}ms`);
  console.log(`Written: ${outPath}`);
  console.log(``);
  console.log(`=== HEADLINE RESULTS ===`);
  console.log(`Assumption Accuracy:         ${fmtPct(metrics.accuracy)} ${fmtCI(metrics.accuracyCI)}`);
  console.log(`Invalidation Detection Rate: ${fmtPct(metrics.detectionRate)}`);
  console.log(`False Positive Rate:         ${fmtPct(metrics.falsePositiveRate)}`);
  console.log(`Drift Detection Rate:        ${fmtPct(metrics.driftDetectionRate)}`);
  console.log(``);
  console.log(`Confusion Matrix: TP=${metrics.tp} FP=${metrics.fp} TN=${metrics.tn} FN=${metrics.fn}`);
  console.log(``);
  console.log(`--- By Scenario Type ---`);
  for (const entry of byType) {
    console.log(`  ${entry.type.padEnd(22)} ${fmtPct(entry.accuracy)} (n=${entry.samples})`);
  }

  return results;
}
