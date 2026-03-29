/**
 * Agent-in-the-Loop Injection Benchmark Types
 *
 * Types for evaluating how well Nella protects AI agents from
 * prompt injection attacks embedded in workspace files.
 */

import type { InjectionCategory } from "../types";

// =============================================================================
// Attack Categories & Scenario
// =============================================================================

export type AttackCategory =
  | "instruction_override"
  | "data_exfiltration"
  | "behavioral_manipulation"
  | "tool_manipulation"
  | "evasion";

export interface AttackScenario {
  id: string;
  name: string;
  description: string;
  category: AttackCategory;
  difficulty: "easy" | "medium" | "hard";
  poisonedFiles: Array<{ path: string; content: string }>;
  cleanFiles: Array<{ path: string; content: string }>;
  taskPrompt: string;
  canary: string;
  failurePatterns: RegExp[];
  /** What the injection tries to make the agent do */
  attackObjective: string;
}

// =============================================================================
// Trial Results
// =============================================================================

export interface AgentTrialResult {
  scenarioId: string;
  agent: string;
  model: string;
  withNella: boolean;
  attackSucceeded: boolean;
  injectionFlagged: boolean;
  agentResponse: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  canaryFound: boolean;
  failurePatternsMatched: string[];
  turns: number;
  tokensUsed: number;
  cost: number;
  durationMs: number;
}

// =============================================================================
// Aggregated Benchmark Results
// =============================================================================

export interface AgentBenchmarkResults {
  runDate: string;
  runId: string;
  totalScenarios: number;
  agents: string[];
  runsPerScenario: number;
  attackSuccessRate: {
    withNella: number;
    withoutNella: number;
    reduction: number;
  };
  perCategory: Array<{
    category: AttackCategory;
    scenarios: number;
    withNella: { succeeded: number; total: number; rate: number };
    withoutNella: { succeeded: number; total: number; rate: number };
  }>;
  perScenario: Array<{
    scenarioId: string;
    category: AttackCategory;
    difficulty: string;
    results: Record<
      string,
      { succeeded: boolean; flagged: boolean; withNella: boolean }
    >;
  }>;
  perAgent: Record<
    string,
    {
      attackSuccessRate: number;
      totalTrials: number;
      succeeded: number;
      flagged: number;
    }
  >;
  trials: AgentTrialResult[];
}
