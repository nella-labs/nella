/**
 * Search Quality Benchmark Module
 *
 * Evaluates nella_search against ground truth queries on a
 * synthetic fixture project, computing precision, recall, and MRR.
 */

export type {
  SearchGroundTruth,
  SearchTrialResult,
  SearchBenchmarkResults,
} from "./types";

export { getFixtureFiles } from "./fixture";
export { getQueries } from "./queries";

export {
  computePrecisionAtK,
  computeRecallAtK,
  computeMRR,
} from "./metrics";

export { runSearchQualityBenchmark } from "./runner";
export type { SearchQualityBenchmarkOptions } from "./runner";
