/**
 * Search Quality Benchmark Runner
 *
 * Indexes a fixture project with Nella's IndexManager, runs ground
 * truth queries, and computes precision/recall/MRR metrics.
 *
 * Uses lexical-only search (no embedding API required) so the
 * benchmark can run in CI without external dependencies.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { IndexManager, DEFAULT_INDEX_CONFIG } from "@usenella/core";
import { wilsonCI } from "../injection/stats";
import { getFixtureFiles } from "./fixture";
import { getQueries } from "./queries";
import { computePrecisionAtK, computeRecallAtK, computeMRR } from "./metrics";
import type { SearchBenchmarkResults, SearchTrialResult } from "./types";

// =============================================================================
// Options
// =============================================================================

export interface SearchQualityBenchmarkOptions {
  /** Print per-query results */
  verbose?: boolean;
  /** Output directory for results.json */
  outputDir?: string;
}

// =============================================================================
// Runner
// =============================================================================

export async function runSearchQualityBenchmark(
  options?: SearchQualityBenchmarkOptions,
): Promise<SearchBenchmarkResults> {
  const verbose = options?.verbose ?? false;
  const outputDir = options?.outputDir ?? path.join(process.cwd(), "benchmark-results");

  // 1. Create temp workspace and write fixture files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nella-search-bench-"));
  const workspacePath = path.join(tmpDir, "workspace");
  const storagePath = path.join(tmpDir, "storage");

  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(storagePath, { recursive: true });

  const fixtureFiles = getFixtureFiles();

  console.log(`Writing ${Object.keys(fixtureFiles).length} fixture files to ${workspacePath}`);

  for (const [relativePath, content] of Object.entries(fixtureFiles)) {
    const fullPath = path.join(workspacePath, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  // 2. Create IndexManager with lexical-heavy config (no embedding API)
  console.log("Creating index...");

  const indexManager = new IndexManager({
    workspaceId: "search-quality-benchmark",
    workspacePath,
    storagePath,
    ...DEFAULT_INDEX_CONFIG,
    // Override to pure lexical — no embedding API needed
    search: {
      ...DEFAULT_INDEX_CONFIG.search,
      vectorWeight: 0,
      lexicalWeight: 1,
      rerankEnabled: false,
    },
  });

  // 3. Index the workspace (embedding errors are non-fatal — lexical still works)
  try {
    await indexManager.index({ force: true });
  } catch (error) {
    // Embedding API may fail — that's expected. Lexical index is still usable.
    console.warn("Index completed with warnings (embedding errors are expected):", (error as Error).message);
  }

  const status = indexManager.getStatus();
  console.log(`Index ready: ${status.ready} | Chunks: ${status.stats?.chunksCount ?? 0}`);

  if (!status.ready) {
    throw new Error("Index is not ready after indexing — cannot run benchmark");
  }

  // 4. Run queries against the index
  const queries = getQueries();
  const trials: SearchTrialResult[] = [];
  const K = 5;

  console.log(`\nRunning ${queries.length} queries (k=${K})...\n`);

  for (const gt of queries) {
    const startMs = Date.now();

    let topResults: string[] = [];
    try {
      const response = await indexManager.search({
        query: gt.query,
        limit: K * 2, // fetch extra to account for dedup
        mode: "lexical",
      });

      // Extract unique file paths from results (relative to workspace)
      const seen = new Set<string>();
      for (const r of response.results) {
        const rel = path.relative(workspacePath, r.chunk.filePath);
        if (!seen.has(rel)) {
          seen.add(rel);
          topResults.push(rel);
        }
        if (topResults.length >= K) break;
      }
    } catch (error) {
      console.warn(`  Query "${gt.id}" failed: ${(error as Error).message}`);
    }

    const latencyMs = Date.now() - startMs;

    const precisionAt5 = computePrecisionAtK(topResults, gt.relevantFiles, K);
    const recallAt5 = computeRecallAtK(topResults, gt.relevantFiles, K);
    const mrr = computeMRR(topResults, gt.relevantFiles);
    const hit = topResults.slice(0, K).some((f) => gt.relevantFiles.includes(f));

    const trial: SearchTrialResult = {
      queryId: gt.id,
      query: gt.query,
      type: gt.type,
      precisionAt5,
      recallAt5,
      mrr,
      latencyMs,
      topResults: topResults.slice(0, K),
      relevant: gt.relevantFiles,
      hit,
    };

    trials.push(trial);

    if (verbose) {
      const icon = hit ? "HIT" : "MISS";
      console.log(`  [${icon}] ${gt.id}: P@5=${precisionAt5.toFixed(2)} R@5=${recallAt5.toFixed(2)} MRR=${mrr.toFixed(2)} (${latencyMs}ms)`);
      console.log(`         top: [${topResults.slice(0, K).join(", ")}]`);
      console.log(`         want: [${gt.relevantFiles.join(", ")}]`);
    }
  }

  // 5. Aggregate metrics
  const avgPrecision = mean(trials.map((t) => t.precisionAt5));
  const avgRecall = mean(trials.map((t) => t.recallAt5));
  const avgMRR = mean(trials.map((t) => t.mrr));
  const avgLatency = mean(trials.map((t) => t.latencyMs));

  // Wilson CIs on hit rate (binary success)
  const hitCount = trials.filter((t) => t.hit).length;
  const precisionSuccesses = Math.round(avgPrecision * trials.length);
  const recallSuccesses = Math.round(avgRecall * trials.length);
  const precisionCI = wilsonCI(precisionSuccesses, trials.length);
  const recallCI = wilsonCI(recallSuccesses, trials.length);

  // By query type
  const queryTypes = [...new Set(trials.map((t) => t.type))];
  const byQueryType = queryTypes.map((type) => {
    const subset = trials.filter((t) => t.type === type);
    return {
      type,
      precisionAt5: mean(subset.map((t) => t.precisionAt5)),
      recallAt5: mean(subset.map((t) => t.recallAt5)),
      mrr: mean(subset.map((t) => t.mrr)),
      samples: subset.length,
    };
  });

  const results: SearchBenchmarkResults = {
    runDate: new Date().toISOString(),
    feature: "search-quality",
    version: "1.0.0",
    totalQueries: trials.length,
    headline: {
      precisionAt5: avgPrecision,
      recallAt5: avgRecall,
      mrr: avgMRR,
      avgLatencyMs: avgLatency,
      precisionAt5CI: precisionCI,
      recallAt5CI: recallCI,
    },
    byQueryType,
    trials,
  };

  // 6. Print summary
  console.log("\n=== SEARCH QUALITY RESULTS ===");
  console.log(`Queries:       ${trials.length}`);
  console.log(`Hit Rate:      ${((hitCount / trials.length) * 100).toFixed(1)}% (${hitCount}/${trials.length})`);
  console.log(`Precision@5:   ${(avgPrecision * 100).toFixed(1)}% [${(precisionCI.lower * 100).toFixed(1)}%, ${(precisionCI.upper * 100).toFixed(1)}%]`);
  console.log(`Recall@5:      ${(avgRecall * 100).toFixed(1)}% [${(recallCI.lower * 100).toFixed(1)}%, ${(recallCI.upper * 100).toFixed(1)}%]`);
  console.log(`MRR:           ${avgMRR.toFixed(3)}`);
  console.log(`Avg Latency:   ${avgLatency.toFixed(0)}ms`);
  console.log("");

  for (const qt of byQueryType) {
    console.log(`  ${qt.type} (n=${qt.samples}): P@5=${(qt.precisionAt5 * 100).toFixed(1)}% R@5=${(qt.recallAt5 * 100).toFixed(1)}% MRR=${qt.mrr.toFixed(3)}`);
  }

  // 7. Write results.json
  fs.mkdirSync(outputDir, { recursive: true });
  const resultsPath = path.join(outputDir, "search-quality-results.json");
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\nResults written to ${resultsPath}`);

  // 8. Cleanup temp workspace
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }

  return results;
}

// =============================================================================
// Helpers
// =============================================================================

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
