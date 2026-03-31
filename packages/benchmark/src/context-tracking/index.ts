/**
 * Context Tracking Benchmark Module
 *
 * Evaluates nella's assumption invalidation engine against
 * 30 ground-truth scenarios covering file changes, dependency
 * updates, schema modifications, config changes, no-ops, and
 * glob-pattern matching.
 */

export type {
  ScenarioType,
  AssumptionSpec,
  ContextScenario,
  ContextTrialResult,
  ContextBenchmarkResults,
} from "./types";

export { getScenarios } from "./scenarios";
export { runContextTrackingBenchmark } from "./runner";
