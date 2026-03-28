/**
 * Injection Benchmark Types
 *
 * Types for evaluating prompt injection detection across categories,
 * difficulties, and defense layers.
 */

// =============================================================================
// Enums & Unions
// =============================================================================

export type InjectionCategory =
  | "instruction_override"
  | "role_assumption"
  | "system_prompt_request"
  | "token_extraction"
  | "authority_claim"
  | "action_directive"
  | "context_manipulation"
  | "encoded_payload";

export type SampleDifficulty = "easy" | "medium" | "hard";

export type ContentContext =
  | "code_comment"
  | "readme"
  | "jsdoc"
  | "commit_msg"
  | "inline"
  | "function"
  | "class"
  | "doc"
  | "docstring"
  | "documentation"
  | "config"
  | "script";

// =============================================================================
// Corpus Sample
// =============================================================================

/** A single injection or benign sample loaded from the corpus */
export interface InjectionSample {
  /** Unique sample identifier (e.g., "io-direct-001") */
  id: string;

  /** The text content to scan */
  content: string;

  /** Whether the scanner should detect this as an injection */
  expectedDetection: boolean;

  /** Which injection patterns should be identified */
  expectedPatterns: InjectionCategory[];

  /** Minimum expected confidence score (0.0 - 1.0) */
  expectedMinScore?: number;

  /** Maximum expected confidence score (0.0 - 1.0) */
  expectedMaxScore?: number;

  /** How difficult this sample is to detect */
  difficulty: SampleDifficulty;

  /** The code context where the content appears */
  context: ContentContext;

  /** Primary injection category, or "benign" for clean samples */
  category: InjectionCategory | "benign";

  /** Finer-grained subcategory label */
  subcategory: string;
}

// =============================================================================
// Per-Sample Results
// =============================================================================

/** Result of scanning a single sample */
export interface SampleTestResult {
  sampleId: string;
  detected: boolean;
  detectedPatterns: string[];
  scannerScore: number;
  heuristicScore: number;
  recommendation: "safe" | "flag" | "review";
  classification: "TP" | "FP" | "TN" | "FN";
  patternAccurate: boolean;
  scoreAccurate: boolean;
  factors: Record<string, number>;
  executionTimeMs: number;
}

/** Result of a single defense-layer test */
export interface LayerTestResult {
  layer: number;
  layerName: string;
  testId: string;
  passed: boolean;
  details: string;
  executionTimeMs: number;
}

// =============================================================================
// Aggregated Metrics
// =============================================================================

/** Metrics broken down by injection category */
export interface CategoryMetrics {
  category: string;
  totalSamples: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  detectionRate: number;
  falsePositiveRate: number;
  precision: number;
  recall: number;
  f1Score: number;
  averageScore: number;
}

/** Metrics broken down by sample difficulty */
export interface DifficultyMetrics {
  difficulty: SampleDifficulty;
  totalSamples: number;
  detectionRate: number;
  falsePositiveRate: number;
  averageScore: number;
}

/** Metrics broken down by defense layer */
export interface LayerMetrics {
  layer: number;
  layerName: string;
  totalTests: number;
  passed: number;
  passRate: number;
}

// =============================================================================
// Full Benchmark Results
// =============================================================================

/** Complete results of an injection benchmark run */
export interface InjectionBenchmarkResults {
  runDate: string;
  runId: string;
  version: string;
  corpusVersion: string;
  threshold: number;

  corpus: {
    totalSamples: number;
    injectionSamples: number;
    benignSamples: number;
    categories: number;
  };

  headline: {
    detectionRate: number;
    falsePositiveRate: number;
    precision: number;
    f1Score: number;
    boundaryIntegrity: number;
    tokenLeakRate: number;
    hmacIntegrity: number;
    challengeResponseRate: number;
  };

  byCategory: CategoryMetrics[];
  byDifficulty: DifficultyMetrics[];
  byLayer: LayerMetrics[];
  sampleResults: SampleTestResult[];
  layerResults: LayerTestResult[];
}

// =============================================================================
// Website / Dashboard Stats
// =============================================================================

/** Simplified stats for website display */
export interface WebsiteStats {
  feature: string;
  version: string;
  runDate: string;

  corpus: {
    total: number;
    injection: number;
    benign: number;
  };

  headline: {
    detectionRate: string;
    falsePositiveRate: string;
    precision: string;
    f1Score: string;
    boundaryIntegrity: string;
    tokenLeakRate: string;
    hmacIntegrity: string;
    challengeResponseRate: string;
  };

  categories: Array<{
    name: string;
    detectionRate: string;
    sampleCount: number;
  }>;
}
