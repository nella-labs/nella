/**
 * Agent Injection Benchmark Orchestrator
 *
 * Runs ALL scenarios x ALL agents x N runs and computes aggregate results.
 * Supports A/B comparison with and without Nella defenses.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type {
  AttackScenario,
  AttackCategory,
  AgentTrialResult,
  AgentBenchmarkResults,
  CostBreakdown,
} from "./types";
import { getScenarios, getScenarioById } from "./scenarios";
import { runTrial, type TrialConfig } from "./trial-runner";
import { aggregateRuns, passAtK, passHatK, mcnemarTest, percentiles, wilsonCI } from "../stats";
import type { ConfidenceInterval, AggregateStats, McNemarResult } from "../stats";

// =============================================================================
// Options
// =============================================================================

export interface AgentBenchmarkOptions {
  agents: Array<{
    provider: "anthropic" | "openai";
    model: string;
    apiKey: string;
    name: string;
  }>;
  /** Scenario IDs to run (default: all) */
  scenarios?: string[];
  /** Number of runs per scenario x agent combination (default: 1) */
  runsPerScenario?: number;
  /** Run trials with Nella defenses enabled (default: true) */
  withNella?: boolean;
  /** Also run without Nella for A/B comparison (default: false) */
  withoutNella?: boolean;
  /** Maximum agent turns per trial (default: 5) */
  maxTurns?: number;
  /** Directory to write results.json and summary.md */
  outputDir?: string;
  /** Print per-trial details to console */
  verbose?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const ATTACK_CATEGORIES: AttackCategory[] = [
  "instruction_override",
  "data_exfiltration",
  "behavioral_manipulation",
  "tool_manipulation",
  "evasion",
];

// =============================================================================
// Orchestrator
// =============================================================================

export async function runAgentBenchmark(
  options: AgentBenchmarkOptions,
): Promise<AgentBenchmarkResults> {
  const {
    agents,
    runsPerScenario = 1,
    withNella = true,
    withoutNella = false,
    maxTurns = 5,
    outputDir,
    verbose = false,
  } = options;

  if (agents.length === 0) {
    throw new Error("At least one agent must be specified");
  }

  if (!withNella && !withoutNella) {
    throw new Error(
      "At least one of withNella or withoutNella must be true",
    );
  }

  // ── Load & filter scenarios ──────────────────────────────────────────────
  const allScenarios = loadScenarios(options.scenarios);

  if (allScenarios.length === 0) {
    throw new Error(
      options.scenarios
        ? `No scenarios matched IDs: ${options.scenarios.join(", ")}`
        : "No scenarios available",
    );
  }

  // ── Compute total trial count for progress tracking ──────────────────────
  const modes = [
    ...(withNella ? [true] : []),
    ...(withoutNella ? [false] : []),
  ];
  const totalTrials =
    allScenarios.length * agents.length * runsPerScenario * modes.length;

  const runId = crypto.randomBytes(6).toString("hex");
  const runDate = new Date().toISOString();

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          Agent Injection Benchmark                      ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  Run ID:     ${runId}`);
  console.log(`  Scenarios:  ${allScenarios.length}`);
  console.log(`  Agents:     ${agents.map((a) => a.name).join(", ")}`);
  console.log(`  Runs/combo: ${runsPerScenario}`);
  console.log(`  Modes:      ${modes.map((m) => (m ? "with-nella" : "without-nella")).join(", ")}`);
  console.log(`  Total trials: ${totalTrials}`);
  console.log("");

  // ── Execute trials ───────────────────────────────────────────────────────
  const trials: AgentTrialResult[] = [];
  let completed = 0;
  const benchmarkStart = Date.now();

  for (const scenario of allScenarios) {
    for (const agent of agents) {
      for (const nellaEnabled of modes) {
        for (let run = 0; run < runsPerScenario; run++) {
          completed++;
          const label = `[${completed}/${totalTrials}]`;
          const modeLabel = nellaEnabled ? "nella" : "bare";

          console.log(
            `${label} ${scenario.id} | ${agent.name} | ${modeLabel}${runsPerScenario > 1 ? ` | run ${run + 1}` : ""}`,
          );

          const trialConfig: TrialConfig = {
            scenario,
            agent: {
              provider: agent.provider,
              model: agent.model,
              apiKey: agent.apiKey,
            },
            withNella: nellaEnabled,
            maxTurns,
          };

          try {
            const result = await runTrial(trialConfig);
            trials.push(result);

            if (verbose) {
              const status = result.attackSucceeded ? "COMPROMISED" : "DEFENDED";
              const flagged = result.injectionFlagged ? " [flagged]" : "";
              console.log(
                `         -> ${status}${flagged} (${result.turns} turns, ${result.durationMs}ms)`,
              );
            }
          } catch (err) {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            console.error(`         -> ERROR: ${errorMessage}`);

            // Record a failed trial so aggregate stats still account for it
            trials.push(createErrorTrial(scenario, agent, nellaEnabled, errorMessage));
          }
        }
      }
    }
  }

  const totalDurationMs = Date.now() - benchmarkStart;
  console.log(`\nAll trials complete in ${formatDuration(totalDurationMs)}`);

  // ── Aggregate results ────────────────────────────────────────────────────
  const results = aggregateResults({
    runId,
    runDate,
    allScenarios,
    agents: agents.map((a) => a.name),
    runsPerScenario,
    trials,
    withNella,
    withoutNella,
  });

  // ── Print summary ────────────────────────────────────────────────────────
  printSummary(results);

  // ── Write output files ───────────────────────────────────────────────────
  if (outputDir) {
    await writeOutputFiles(outputDir, results);
  }

  return results;
}

// =============================================================================
// Scenario Loading
// =============================================================================

function loadScenarios(scenarioIds?: string[]): AttackScenario[] {
  if (!scenarioIds || scenarioIds.length === 0) {
    return getScenarios();
  }

  const scenarios: AttackScenario[] = [];
  const missing: string[] = [];

  for (const id of scenarioIds) {
    const scenario = getScenarioById(id);
    if (scenario) {
      scenarios.push(scenario);
    } else {
      missing.push(id);
    }
  }

  if (missing.length > 0) {
    console.warn(`Warning: unknown scenario IDs ignored: ${missing.join(", ")}`);
  }

  return scenarios;
}

// =============================================================================
// Error Trial
// =============================================================================

function createErrorTrial(
  scenario: AttackScenario,
  agent: { name: string; model: string },
  withNella: boolean,
  errorMessage: string,
): AgentTrialResult {
  return {
    scenarioId: scenario.id,
    agent: agent.name,
    model: agent.model,
    withNella,
    attackSucceeded: false,
    injectionFlagged: false,
    agentResponse: `[ERROR] Trial failed: ${errorMessage}`,
    toolCalls: [],
    canaryFound: false,
    failurePatternsMatched: [],
    turns: 0,
    tokensUsed: 0,
    cost: 0,
    durationMs: 0,
  };
}

// =============================================================================
// Aggregation
// =============================================================================

interface AggregateInput {
  runId: string;
  runDate: string;
  allScenarios: AttackScenario[];
  agents: string[];
  runsPerScenario: number;
  trials: AgentTrialResult[];
  withNella: boolean;
  withoutNella: boolean;
}

function aggregateResults(input: AggregateInput): AgentBenchmarkResults {
  const { runId, runDate, allScenarios, agents, runsPerScenario, trials } = input;

  // ── Overall attack success rates ─────────────────────────────────────────
  const nellaTrials = trials.filter((t) => t.withNella);
  const bareTrials = trials.filter((t) => !t.withNella);

  const nellaRate = safeRate(
    nellaTrials.filter((t) => t.attackSucceeded).length,
    nellaTrials.length,
  );
  const bareRate = safeRate(
    bareTrials.filter((t) => t.attackSucceeded).length,
    bareTrials.length,
  );

  const reduction =
    bareRate > 0 ? (bareRate - nellaRate) / bareRate : 0;

  // ── Per-category breakdown ───────────────────────────────────────────────
  const scenariosByCategory = new Map<AttackCategory, AttackScenario[]>();
  for (const s of allScenarios) {
    const list = scenariosByCategory.get(s.category) ?? [];
    list.push(s);
    scenariosByCategory.set(s.category, list);
  }

  const perCategory = ATTACK_CATEGORIES
    .filter((cat) => scenariosByCategory.has(cat))
    .map((category) => {
      const catScenarioIds = new Set(
        (scenariosByCategory.get(category) ?? []).map((s) => s.id),
      );
      const catNella = nellaTrials.filter((t) =>
        catScenarioIds.has(t.scenarioId),
      );
      const catBare = bareTrials.filter((t) =>
        catScenarioIds.has(t.scenarioId),
      );

      return {
        category,
        scenarios: catScenarioIds.size,
        withNella: {
          succeeded: catNella.filter((t) => t.attackSucceeded).length,
          total: catNella.length,
          rate: safeRate(
            catNella.filter((t) => t.attackSucceeded).length,
            catNella.length,
          ),
        },
        withoutNella: {
          succeeded: catBare.filter((t) => t.attackSucceeded).length,
          total: catBare.length,
          rate: safeRate(
            catBare.filter((t) => t.attackSucceeded).length,
            catBare.length,
          ),
        },
      };
    });

  // ── Per-scenario breakdown ───────────────────────────────────────────────
  const perScenario = allScenarios.map((scenario) => {
    const scenarioTrials = trials.filter(
      (t) => t.scenarioId === scenario.id,
    );
    const results: Record<
      string,
      { succeeded: boolean; flagged: boolean; withNella: boolean }
    > = {};

    for (const trial of scenarioTrials) {
      const key = `${trial.agent}:${trial.withNella ? "nella" : "bare"}`;
      results[key] = {
        succeeded: trial.attackSucceeded,
        flagged: trial.injectionFlagged,
        withNella: trial.withNella,
      };
    }

    return {
      scenarioId: scenario.id,
      category: scenario.category,
      difficulty: scenario.difficulty,
      results,
    };
  });

  // ── Per-agent breakdown ──────────────────────────────────────────────────
  const perAgent: AgentBenchmarkResults["perAgent"] = {};

  for (const agentName of agents) {
    const agentTrials = trials.filter((t) => t.agent === agentName);
    const succeeded = agentTrials.filter((t) => t.attackSucceeded).length;
    const flagged = agentTrials.filter((t) => t.injectionFlagged).length;
    const agentTokens = agentTrials.reduce((s, t) => s + t.tokensUsed, 0);
    const agentCost = agentTrials.reduce((s, t) => s + t.cost, 0);

    perAgent[agentName] = {
      attackSuccessRate: safeRate(succeeded, agentTrials.length),
      totalTrials: agentTrials.length,
      succeeded,
      flagged,
      totalTokens: agentTokens,
      totalCost: agentCost,
      avgTokensPerTrial: agentTrials.length > 0 ? agentTokens / agentTrials.length : 0,
      avgCostPerTrial: agentTrials.length > 0 ? agentCost / agentTrials.length : 0,
    };
  }

  // ── Multi-run metrics (CI, pass@k, consistency) ──────────────────────────
  const defended = nellaTrials.filter((t) => !t.attackSucceeded).length;
  const total = nellaTrials.length;
  const asrCI = wilsonCI(total - defended, total);

  const passAt1 = total > 0 ? passAtK(total, defended, 1) : undefined;
  const passAt5 = total >= 5 ? passAtK(total, defended, 5) : undefined;
  const consistency =
    runsPerScenario > 1 ? passHatK(total, defended, runsPerScenario) : undefined;

  // ── McNemar's test (paired comparison) ──────────────────────────────────
  let mcnemar: { chi2: number; pValue: number; significant: boolean } | undefined;
  if (input.withNella && input.withoutNella && allScenarios.length > 0) {
    const paired = allScenarios.map((s) => ({
      withNella:
        nellaTrials.find((t) => t.scenarioId === s.id)?.attackSucceeded ?? true,
      withoutNella:
        bareTrials.find((t) => t.scenarioId === s.id)?.attackSucceeded ?? true,
    }));
    const result = mcnemarTest(paired);
    mcnemar = { chi2: result.chi2, pValue: result.pValue, significant: result.significant };
  }

  // ── Cost efficiency ─────────────────────────────────────────────────────
  const allTrials = trials;
  const totalCost = allTrials.reduce((s, t) => s + t.cost, 0);
  const totalTokens = allTrials.reduce((s, t) => s + t.tokensUsed, 0);
  const defendedCount = allTrials.filter((t) => !t.attackSucceeded).length;

  const buildCostBreakdown = (subset: AgentTrialResult[]): CostBreakdown => {
    const tokens = subset.reduce((s, t) => s + t.tokensUsed, 0);
    const cost = subset.reduce((s, t) => s + t.cost, 0);
    return {
      totalTrials: subset.length,
      totalTokens: tokens,
      totalCost: cost,
      avgTokensPerTrial: subset.length > 0 ? tokens / subset.length : 0,
      avgCostPerTrial: subset.length > 0 ? cost / subset.length : 0,
    };
  };

  const costEfficiency = {
    totalCost,
    costPerScenario: allScenarios.length > 0 ? totalCost / allScenarios.length : 0,
    costPerDefense: defendedCount > 0 ? totalCost / defendedCount : 0,
    tokensPerScenario: allScenarios.length > 0 ? totalTokens / allScenarios.length : 0,
    totalTokens,
    byMode: (input.withNella || input.withoutNella) ? {
      withNella: buildCostBreakdown(nellaTrials),
      withoutNella: buildCostBreakdown(bareTrials),
    } : undefined,
  };

  // ── Latency percentiles ─────────────────────────────────────────────────
  const durations = allTrials.map((t) => t.durationMs);
  const lat = percentiles(durations);
  const latency = { p50Ms: lat.p50, p95Ms: lat.p95, p99Ms: lat.p99 };

  return {
    runDate,
    runId,
    totalScenarios: allScenarios.length,
    agents,
    runsPerScenario,
    attackSuccessRate: {
      withNella: nellaRate,
      withoutNella: bareRate,
      reduction,
    },
    perCategory,
    perScenario,
    perAgent,
    trials,
    passAt1,
    passAt5,
    consistency,
    attackSuccessRateCI: { point: asrCI.point, lower: asrCI.lower, upper: asrCI.upper },
    mcnemar,
    costEfficiency,
    latency,
  };
}

// =============================================================================
// Console Summary
// =============================================================================

function printSummary(results: AgentBenchmarkResults): void {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                     Results Summary                     ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // Overall
  console.log("\n  Attack Success Rate:");
  if (results.attackSuccessRate.withNella >= 0) {
    const ciStr = results.attackSuccessRateCI
      ? ` [${pct(results.attackSuccessRateCI.lower)}, ${pct(results.attackSuccessRateCI.upper)}]`
      : "";
    console.log(`    With Nella:    ${pct(results.attackSuccessRate.withNella)}${ciStr}`);
  }
  if (results.attackSuccessRate.withoutNella >= 0) {
    console.log(`    Without Nella: ${pct(results.attackSuccessRate.withoutNella)}`);
  }
  if (results.attackSuccessRate.reduction > 0) {
    console.log(`    Reduction:     ${pct(results.attackSuccessRate.reduction)}`);
  }

  // McNemar's test
  if (results.mcnemar) {
    const sigStr = results.mcnemar.significant ? "significant" : "not significant";
    console.log(`    McNemar:       p = ${results.mcnemar.pValue.toFixed(3)} (${sigStr})`);
  }

  // Pass@k and consistency
  if (results.passAt1 !== undefined || results.passAt5 !== undefined || results.consistency !== undefined) {
    const parts: string[] = [];
    if (results.passAt1 !== undefined) parts.push(`Pass@1: ${pct(results.passAt1)}`);
    if (results.passAt5 !== undefined) parts.push(`Pass@5: ${pct(results.passAt5)}`);
    if (results.consistency !== undefined) parts.push(`Consistency: ${pct(results.consistency)}`);
    console.log(`\n  Multi-run: ${parts.join(" | ")}`);
  }

  // Cost efficiency
  if (results.costEfficiency) {
    const ce = results.costEfficiency;
    console.log(
      `\n  Cost: $${ce.totalCost.toFixed(4)} total | $${ce.costPerScenario.toFixed(4)}/scenario | ${Math.round(ce.tokensPerScenario).toLocaleString()} tokens/scenario`,
    );

    if (ce.byMode) {
      const nella = ce.byMode.withNella;
      const bare = ce.byMode.withoutNella;

      if (nella.totalTrials > 0) {
        console.log(
          `    With Nella:    ${nella.totalTokens.toLocaleString()} tokens ($${nella.totalCost.toFixed(4)}) | avg ${Math.round(nella.avgTokensPerTrial).toLocaleString()} tokens/trial ($${nella.avgCostPerTrial.toFixed(4)}/trial)`,
        );
      }
      if (bare.totalTrials > 0) {
        console.log(
          `    Without Nella: ${bare.totalTokens.toLocaleString()} tokens ($${bare.totalCost.toFixed(4)}) | avg ${Math.round(bare.avgTokensPerTrial).toLocaleString()} tokens/trial ($${bare.avgCostPerTrial.toFixed(4)}/trial)`,
        );
      }
      if (nella.totalTrials > 0 && bare.totalTrials > 0 && bare.avgCostPerTrial > 0) {
        const costOverhead = ((nella.avgCostPerTrial - bare.avgCostPerTrial) / bare.avgCostPerTrial) * 100;
        const tokenOverhead = bare.avgTokensPerTrial > 0
          ? ((nella.avgTokensPerTrial - bare.avgTokensPerTrial) / bare.avgTokensPerTrial) * 100
          : 0;
        console.log(
          `    Overhead:      ${costOverhead >= 0 ? "+" : ""}${costOverhead.toFixed(1)}% cost | ${tokenOverhead >= 0 ? "+" : ""}${tokenOverhead.toFixed(1)}% tokens`,
        );
      }
    }
  }

  // Latency
  if (results.latency) {
    console.log(
      `  Latency: p50 ${results.latency.p50Ms}ms | p95 ${results.latency.p95Ms}ms | p99 ${results.latency.p99Ms}ms`,
    );
  }

  // Per category
  if (results.perCategory.length > 0) {
    console.log("\n  By Category:");
    for (const cat of results.perCategory) {
      const nellaStr =
        cat.withNella.total > 0
          ? `nella ${pct(cat.withNella.rate)}`
          : "";
      const bareStr =
        cat.withoutNella.total > 0
          ? `bare ${pct(cat.withoutNella.rate)}`
          : "";
      const parts = [nellaStr, bareStr].filter(Boolean).join(" | ");
      console.log(
        `    ${padRight(cat.category, 28)} ${parts}`,
      );
    }
  }

  // Per agent
  if (Object.keys(results.perAgent).length > 0) {
    console.log("\n  By Agent:");
    for (const [name, stats] of Object.entries(results.perAgent)) {
      console.log(
        `    ${padRight(name, 28)} ${pct(stats.attackSuccessRate)} compromised (${stats.flagged}/${stats.totalTrials} flagged)`,
      );
    }
  }

  console.log("");
}

// =============================================================================
// Output Files
// =============================================================================

async function writeOutputFiles(
  outputDir: string,
  results: AgentBenchmarkResults,
): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });

  // results.json
  const jsonPath = path.join(outputDir, "results.json");
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`  Wrote ${jsonPath}`);

  // summary.md
  const mdPath = path.join(outputDir, "summary.md");
  fs.writeFileSync(mdPath, generateSummaryMarkdown(results));
  console.log(`  Wrote ${mdPath}`);
}

function generateSummaryMarkdown(results: AgentBenchmarkResults): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines: string[] = [];

  lines.push("# Agent Injection Benchmark Results");
  lines.push("");
  lines.push(`- **Run ID:** ${results.runId}`);
  lines.push(`- **Date:** ${results.runDate}`);
  lines.push(`- **Scenarios:** ${results.totalScenarios}`);
  lines.push(`- **Agents:** ${results.agents.join(", ")}`);
  lines.push(`- **Runs per scenario:** ${results.runsPerScenario}`);
  lines.push(`- **Total trials:** ${results.trials.length}`);
  lines.push("");

  // Overall
  lines.push("## Overall Attack Success Rate");
  lines.push("");
  lines.push("| Mode | Rate |");
  lines.push("|------|------|");
  lines.push(`| With Nella | ${pct(results.attackSuccessRate.withNella)} |`);
  lines.push(`| Without Nella | ${pct(results.attackSuccessRate.withoutNella)} |`);
  lines.push(`| **Reduction** | **${pct(results.attackSuccessRate.reduction)}** |`);
  lines.push("");

  // Per category
  if (results.perCategory.length > 0) {
    lines.push("## By Category");
    lines.push("");
    lines.push("| Category | Scenarios | With Nella | Without Nella |");
    lines.push("|----------|-----------|------------|---------------|");
    for (const cat of results.perCategory) {
      const nella =
        cat.withNella.total > 0
          ? `${cat.withNella.succeeded}/${cat.withNella.total} (${pct(cat.withNella.rate)})`
          : "n/a";
      const bare =
        cat.withoutNella.total > 0
          ? `${cat.withoutNella.succeeded}/${cat.withoutNella.total} (${pct(cat.withoutNella.rate)})`
          : "n/a";
      lines.push(`| ${cat.category} | ${cat.scenarios} | ${nella} | ${bare} |`);
    }
    lines.push("");
  }

  // Per agent
  if (Object.keys(results.perAgent).length > 0) {
    lines.push("## By Agent");
    lines.push("");
    lines.push("| Agent | Trials | Compromised | Flagged | Attack Rate | Total Tokens | Avg Tokens/Trial | Total Cost | Avg Cost/Trial |");
    lines.push("|-------|--------|-------------|---------|-------------|-------------|-----------------|-----------|---------------|");
    for (const [name, stats] of Object.entries(results.perAgent)) {
      lines.push(
        `| ${name} | ${stats.totalTrials} | ${stats.succeeded} | ${stats.flagged} | ${pct(stats.attackSuccessRate)} | ${stats.totalTokens.toLocaleString()} | ${Math.round(stats.avgTokensPerTrial).toLocaleString()} | $${stats.totalCost.toFixed(4)} | $${stats.avgCostPerTrial.toFixed(4)} |`,
      );
    }
    lines.push("");
  }

  // Per scenario
  if (results.perScenario.length > 0) {
    lines.push("## By Scenario");
    lines.push("");
    lines.push("| Scenario | Category | Difficulty | Results |");
    lines.push("|----------|----------|------------|---------|");
    for (const s of results.perScenario) {
      const resultEntries = Object.entries(s.results)
        .map(([key, r]) => {
          const icon = r.succeeded ? "X" : "OK";
          const flag = r.flagged ? " flagged" : "";
          return `${key}: ${icon}${flag}`;
        })
        .join(", ");
      lines.push(`| ${s.scenarioId} | ${s.category} | ${s.difficulty} | ${resultEntries} |`);
    }
    lines.push("");
  }

  // Token & Cost Analysis
  if (results.costEfficiency) {
    const ce = results.costEfficiency;
    lines.push("## Token & Cost Analysis");
    lines.push("");

    // Per-mode comparison table
    if (ce.byMode && (ce.byMode.withNella.totalTrials > 0 || ce.byMode.withoutNella.totalTrials > 0)) {
      const nella = ce.byMode.withNella;
      const bare = ce.byMode.withoutNella;

      lines.push("### With Nella vs Without Nella");
      lines.push("");
      lines.push("| Metric | With Nella | Without Nella | Difference |");
      lines.push("|--------|-----------|--------------|------------|");

      if (nella.totalTrials > 0 && bare.totalTrials > 0) {
        const tokenDiff = nella.avgTokensPerTrial - bare.avgTokensPerTrial;
        const tokenDiffPctVal = bare.avgTokensPerTrial > 0
          ? (tokenDiff / bare.avgTokensPerTrial) * 100
          : null;
        const tokenDiffPct = tokenDiffPctVal !== null
          ? `${tokenDiffPctVal >= 0 ? "+" : ""}${tokenDiffPctVal.toFixed(1)}%`
          : "n/a";
        const costDiff = nella.avgCostPerTrial - bare.avgCostPerTrial;
        const costDiffPctVal = bare.avgCostPerTrial > 0
          ? (costDiff / bare.avgCostPerTrial) * 100
          : null;
        const costDiffPct = costDiffPctVal !== null
          ? `${costDiffPctVal >= 0 ? "+" : ""}${costDiffPctVal.toFixed(1)}%`
          : "n/a";
        const totalTokenDiff = nella.totalTokens - bare.totalTokens;
        const totalCostDiff = nella.totalCost - bare.totalCost;

        lines.push(`| Total Trials | ${nella.totalTrials} | ${bare.totalTrials} | — |`);
        lines.push(`| Total Tokens | ${nella.totalTokens.toLocaleString()} | ${bare.totalTokens.toLocaleString()} | ${totalTokenDiff >= 0 ? "+" : ""}${totalTokenDiff.toLocaleString()} |`);
        lines.push(`| Avg Tokens/Trial | ${Math.round(nella.avgTokensPerTrial).toLocaleString()} | ${Math.round(bare.avgTokensPerTrial).toLocaleString()} | ${tokenDiffPct} |`);
        lines.push(`| Total Cost | $${nella.totalCost.toFixed(4)} | $${bare.totalCost.toFixed(4)} | ${totalCostDiff >= 0 ? "+$" : "-$"}${Math.abs(totalCostDiff).toFixed(4)} |`);
        lines.push(`| Avg Cost/Trial | $${nella.avgCostPerTrial.toFixed(4)} | $${bare.avgCostPerTrial.toFixed(4)} | ${costDiffPct} |`);
      } else {
        // Only one mode has data
        lines.push(`| Total Trials | ${nella.totalTrials > 0 ? nella.totalTrials : "—"} | ${bare.totalTrials > 0 ? bare.totalTrials : "—"} | — |`);
        lines.push(`| Total Tokens | ${nella.totalTrials > 0 ? nella.totalTokens.toLocaleString() : "—"} | ${bare.totalTrials > 0 ? bare.totalTokens.toLocaleString() : "—"} | — |`);
        lines.push(`| Avg Tokens/Trial | ${nella.totalTrials > 0 ? Math.round(nella.avgTokensPerTrial).toLocaleString() : "—"} | ${bare.totalTrials > 0 ? Math.round(bare.avgTokensPerTrial).toLocaleString() : "—"} | — |`);
        lines.push(`| Total Cost | ${nella.totalTrials > 0 ? "$" + nella.totalCost.toFixed(4) : "—"} | ${bare.totalTrials > 0 ? "$" + bare.totalCost.toFixed(4) : "—"} | — |`);
        lines.push(`| Avg Cost/Trial | ${nella.totalTrials > 0 ? "$" + nella.avgCostPerTrial.toFixed(4) : "—"} | ${bare.totalTrials > 0 ? "$" + bare.avgCostPerTrial.toFixed(4) : "—"} | — |`);
      }
      lines.push("");
    }

    // Overall cost summary
    lines.push("### Cost Summary");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Total Cost | $${ce.totalCost.toFixed(4)} |`);
    lines.push(`| Total Tokens | ${ce.totalTokens.toLocaleString()} |`);
    lines.push(`| Cost per Scenario | $${ce.costPerScenario.toFixed(4)} |`);
    lines.push(`| Tokens per Scenario | ${Math.round(ce.tokensPerScenario).toLocaleString()} |`);
    lines.push(`| Cost per Defense | $${ce.costPerDefense.toFixed(4)} |`);
    lines.push("");
  }

  return lines.join("\n");
}

// =============================================================================
// Utilities
// =============================================================================

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
