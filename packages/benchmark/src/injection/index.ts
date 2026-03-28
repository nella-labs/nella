/**
 * Injection Benchmark Module
 *
 * Types, corpus loader, layer tests, metrics, runner, and reporting
 * for evaluating prompt injection detection and defense layers.
 */

export type {
  InjectionCategory,
  SampleDifficulty,
  ContentContext,
  InjectionSample,
  SampleTestResult,
  LayerTestResult,
  CategoryMetrics,
  DifficultyMetrics,
  LayerMetrics,
  InjectionBenchmarkResults,
  WebsiteStats,
} from "./types";

export {
  loadCorpus,
} from "./corpus-loader";

export type {
  CorpusMetadata,
  CorpusLoadResult,
} from "./corpus-loader";

export { runScannerTests, runScorerTests, runIsolationTests } from "./layer-tests";
export { computeHeadlineMetrics, computeCategoryMetrics, computeDifficultyMetrics, computeLayerMetrics } from "./metrics";
export { runInjectionBenchmark } from "./runner";
export type { InjectionBenchmarkOptions } from "./runner";
export { generateWebsiteStats, generateMarkdownReport, generateCsvReport, writeReports } from "./reporter";
export { uploadResults } from "./uploader";
