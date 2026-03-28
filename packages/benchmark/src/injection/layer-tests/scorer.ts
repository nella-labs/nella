/**
 * L5 Injection Heuristic Scorer Layer Tests
 *
 * Runs scoreInjectionRisk() against corpus samples using CodeChunk wrappers.
 */

import { scoreInjectionRisk } from "@usenella/core";
import type { CodeChunk } from "@usenella/core";
import type { InjectionSample, SampleTestResult } from "../types";

/**
 * Convert an InjectionSample to a minimal CodeChunk for the scorer.
 */
function sampleToChunk(sample: InjectionSample): CodeChunk {
  // Map sample context to chunk type
  const typeMap: Record<string, CodeChunk["type"]> = {
    function: "function",
    class: "class",
    doc: "doc",
    jsdoc: "doc",
    docstring: "doc",
    documentation: "doc",
    readme: "doc",
    code_comment: "comment",
    commit_msg: "other",
    inline: "other",
    config: "other",
    script: "other",
  };

  return {
    id: sample.id,
    filePath: `test/${sample.id}.ts`,
    content: sample.content,
    lines: [1, sample.content.split("\n").length],
    type: typeMap[sample.context] || "other",
    language: "typescript",
    symbols: [],
    hash: "",
    tokens: Math.ceil(sample.content.length / 4),
    source: {
      origin: "workspace",
      trustLevel: "trusted",
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Run the heuristic scorer against all samples.
 */
export function runScorerTests(
  samples: InjectionSample[],
  threshold: number = 0.2,
): SampleTestResult[] {
  return samples.map(sample => {
    const chunk = sampleToChunk(sample);
    const start = performance.now();
    const assessment = scoreInjectionRisk(chunk);
    const elapsed = performance.now() - start;

    const detected = assessment.score >= threshold;

    const isInjection = sample.expectedDetection;
    let classification: "TP" | "FP" | "TN" | "FN";
    if (isInjection && detected) classification = "TP";
    else if (isInjection && !detected) classification = "FN";
    else if (!isInjection && detected) classification = "FP";
    else classification = "TN";

    // Extract factor scores
    const factors: Record<string, number> = {};
    for (const f of assessment.factors) {
      factors[f.name] = f.score;
    }

    // Score accuracy
    let scoreAccurate = true;
    if (sample.expectedMinScore !== undefined && assessment.score < sample.expectedMinScore) {
      scoreAccurate = false;
    }
    if (sample.expectedMaxScore !== undefined && assessment.score > sample.expectedMaxScore) {
      scoreAccurate = false;
    }

    return {
      sampleId: sample.id,
      detected,
      detectedPatterns: [], // scanner provides this, not scorer
      scannerScore: 0, // filled by scanner tests
      heuristicScore: assessment.score,
      recommendation: assessment.recommendation,
      classification,
      patternAccurate: true, // scorer doesn't identify pattern types
      scoreAccurate,
      factors,
      executionTimeMs: elapsed,
    };
  });
}
