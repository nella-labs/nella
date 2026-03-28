/**
 * L2 Content Scanner Layer Tests
 *
 * Runs scanContent() against every corpus sample and classifies results.
 */

import { scanContent } from "@usenella/core";
import type { InjectionSample, SampleTestResult } from "../types";

/**
 * Run the content scanner against all samples and produce test results.
 */
export function runScannerTests(
  samples: InjectionSample[],
  threshold: number = 0.2,
): SampleTestResult[] {
  return samples.map(sample => {
    const start = performance.now();
    const result = scanContent(sample.content);
    const elapsed = performance.now() - start;

    const detected = result.injectionScore >= threshold;
    const detectedPatterns = [...new Set(result.patterns.map(p => p.type))];

    // Classify
    const isInjection = sample.expectedDetection;
    let classification: "TP" | "FP" | "TN" | "FN";
    if (isInjection && detected) classification = "TP";
    else if (isInjection && !detected) classification = "FN";
    else if (!isInjection && detected) classification = "FP";
    else classification = "TN";

    // Pattern accuracy: all expected patterns were found
    const patternAccurate = sample.expectedPatterns.length === 0
      || sample.expectedPatterns.every(p => detectedPatterns.includes(p));

    // Score accuracy: within expected range
    let scoreAccurate = true;
    if (sample.expectedMinScore !== undefined && result.injectionScore < sample.expectedMinScore) {
      scoreAccurate = false;
    }
    if (sample.expectedMaxScore !== undefined && result.injectionScore > sample.expectedMaxScore) {
      scoreAccurate = false;
    }

    return {
      sampleId: sample.id,
      detected,
      detectedPatterns,
      scannerScore: result.injectionScore,
      heuristicScore: 0, // filled by scorer tests
      recommendation: result.injectionScore >= 0.5 ? "review"
        : result.injectionScore >= 0.2 ? "flag" : "safe",
      classification,
      patternAccurate,
      scoreAccurate,
      factors: {},
      executionTimeMs: elapsed,
    };
  });
}
