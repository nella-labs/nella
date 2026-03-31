/**
 * Context Tracking Benchmark Types
 *
 * Tests nella's assumption invalidation engine against ground truth
 * scenarios covering file changes, dependency updates, schema
 * modifications, config changes, no-ops, and glob patterns.
 */

// =============================================================================
// Scenario Definition
// =============================================================================

export type ScenarioType =
  | "file_change"
  | "dependency_update"
  | "schema_modification"
  | "config_change"
  | "no_change"
  | "glob_pattern";

export interface AssumptionSpec {
  description: string;
  type: "schema" | "interface" | "dependency" | "behavior" | "config" | "structure";
  relatedFiles: string[];
  confidence?: number;
}

export interface ContextScenario {
  id: string;
  name: string;
  type: ScenarioType;
  difficulty: "easy" | "medium" | "hard";
  /** Files to create in the temp directory before the test */
  setupFiles: Record<string, string>;
  /** Assumptions to register before applying the action */
  assumptions: AssumptionSpec[];
  /** The mutation to apply */
  action: {
    file: string;
    operation: "modify" | "create" | "delete";
    newContent?: string;
  };
  /** Ground truth */
  expected: {
    invalidated: boolean;
    invalidatedCount?: number;
  };
}

// =============================================================================
// Trial Result
// =============================================================================

export interface ContextTrialResult {
  scenarioId: string;
  type: ScenarioType;
  expectedInvalidated: boolean;
  actualInvalidated: boolean;
  classification: "TP" | "FP" | "TN" | "FN";
  invalidatedCount: number;
  executionTimeMs: number;
}

// =============================================================================
// Benchmark Results
// =============================================================================

export interface ContextBenchmarkResults {
  runDate: string;
  feature: "context-tracking";
  version: string;
  totalScenarios: number;
  headline: {
    assumptionAccuracy: number;
    invalidationDetectionRate: number;
    falsePositiveRate: number;
    driftDetectionRate: number;
    assumptionAccuracyCI: { point: number; lower: number; upper: number };
  };
  byScenarioType: Array<{ type: string; accuracy: number; samples: number }>;
  trials: ContextTrialResult[];
}
