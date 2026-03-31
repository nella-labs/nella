/**
 * Search Quality Benchmark Types
 *
 * Types for evaluating nella_search against ground truth queries.
 */

export interface SearchGroundTruth {
  id: string;
  query: string;
  relevantFiles: string[];  // file paths that should appear in results
  type: "function_lookup" | "bug_description" | "concept_search" | "cross_file";
  difficulty: "easy" | "medium" | "hard";
}

export interface SearchTrialResult {
  queryId: string;
  query: string;
  type: string;
  precisionAt5: number;
  recallAt5: number;
  mrr: number;  // mean reciprocal rank
  latencyMs: number;
  topResults: string[];  // file paths returned
  relevant: string[];    // ground truth
  hit: boolean;          // any relevant file in top 5
}

export interface SearchBenchmarkResults {
  runDate: string;
  feature: "search-quality";
  version: string;
  totalQueries: number;
  headline: {
    precisionAt5: number;
    recallAt5: number;
    mrr: number;
    avgLatencyMs: number;
    precisionAt5CI: { point: number; lower: number; upper: number };
    recallAt5CI: { point: number; lower: number; upper: number };
  };
  byQueryType: Array<{
    type: string;
    precisionAt5: number;
    recallAt5: number;
    mrr: number;
    samples: number;
  }>;
  trials: SearchTrialResult[];
}
