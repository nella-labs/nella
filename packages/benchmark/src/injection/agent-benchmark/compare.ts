/**
 * Multi-Model Comparison
 *
 * Compares benchmark results across different models/runs.
 * Produces delta tables for attack success rate, cost, latency,
 * and per-category performance.
 */

import * as fs from "fs";
import * as path from "path";
import type { AgentBenchmarkResults } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface ModelStats {
  name: string;
  attackSuccessRate: number;
  flaggedRate: number;
  totalTrials: number;
  avgTokensPerTrial: number;
  avgCostPerTrial: number;
  totalCost: number;
}

export interface CategoryDelta {
  category: string;
  models: Array<{
    name: string;
    rate: number;
    trials: number;
  }>;
}

export interface ComparisonReport {
  runIds: string[];
  runDates: string[];
  models: ModelStats[];
  categoryDeltas: CategoryDelta[];
  latencyComparison: Array<{
    name: string;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  }>;
  costComparison: Array<{
    name: string;
    totalCost: number;
    costPerScenario: number;
    tokensPerScenario: number;
  }>;
}

// =============================================================================
// Compare
// =============================================================================

export function compareResults(
  results: Array<{ label: string; data: AgentBenchmarkResults }>,
): ComparisonReport {
  const models: ModelStats[] = [];
  const latencyComparison: ComparisonReport["latencyComparison"] = [];
  const costComparison: ComparisonReport["costComparison"] = [];

  for (const { label, data } of results) {
    // Per-agent stats (if multiple agents in one run, break them out)
    if (Object.keys(data.perAgent).length > 0) {
      for (const [agentName, stats] of Object.entries(data.perAgent)) {
        const name = results.length > 1 ? `${label}:${agentName}` : agentName;
        models.push({
          name,
          attackSuccessRate: stats.attackSuccessRate,
          flaggedRate: stats.totalTrials > 0 ? stats.flagged / stats.totalTrials : 0,
          totalTrials: stats.totalTrials,
          avgTokensPerTrial: stats.avgTokensPerTrial,
          avgCostPerTrial: stats.avgCostPerTrial,
          totalCost: stats.totalCost,
        });
      }
    }

    if (data.latency) {
      latencyComparison.push({
        name: label,
        p50Ms: data.latency.p50Ms,
        p95Ms: data.latency.p95Ms,
        p99Ms: data.latency.p99Ms,
      });
    }

    if (data.costEfficiency) {
      costComparison.push({
        name: label,
        totalCost: data.costEfficiency.totalCost,
        costPerScenario: data.costEfficiency.costPerScenario,
        tokensPerScenario: data.costEfficiency.tokensPerScenario,
      });
    }
  }

  // Build category deltas across all results
  const allCategories = new Set<string>();
  for (const { data } of results) {
    for (const cat of data.perCategory) {
      allCategories.add(cat.category);
    }
  }

  const categoryDeltas: CategoryDelta[] = Array.from(allCategories).map((category) => ({
    category,
    models: results.map(({ label, data }) => {
      const cat = data.perCategory.find((c) => c.category === category);
      return {
        name: label,
        rate: cat?.withNella.rate ?? 0,
        trials: cat?.withNella.total ?? 0,
      };
    }),
  }));

  return {
    runIds: results.map((r) => r.data.runId),
    runDates: results.map((r) => r.data.runDate),
    models,
    categoryDeltas,
    latencyComparison,
    costComparison,
  };
}

// =============================================================================
// Console Output
// =============================================================================

export function printComparison(report: ComparisonReport): void {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║              Model Comparison Report                    ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // Per-model summary
  if (report.models.length > 0) {
    console.log("\n  Attack Success Rate by Model:");
    const maxNameLen = Math.max(...report.models.map((m) => m.name.length), 10);
    for (const m of report.models) {
      console.log(
        `    ${m.name.padEnd(maxNameLen)}  ${pct(m.attackSuccessRate).padStart(7)} compromised  ${pct(m.flaggedRate).padStart(7)} flagged  ${m.totalTrials} trials  $${m.avgCostPerTrial.toFixed(4)}/trial`,
      );
    }
  }

  // Category deltas
  if (report.categoryDeltas.length > 0) {
    console.log("\n  By Category:");
    for (const cat of report.categoryDeltas) {
      const parts = cat.models.map((m) => `${m.name}: ${pct(m.rate)}`).join(" | ");
      console.log(`    ${cat.category.padEnd(28)} ${parts}`);
    }
  }

  // Latency comparison
  if (report.latencyComparison.length > 0) {
    console.log("\n  Latency:");
    for (const l of report.latencyComparison) {
      console.log(`    ${l.name.padEnd(28)} p50: ${l.p50Ms}ms  p95: ${l.p95Ms}ms  p99: ${l.p99Ms}ms`);
    }
  }

  // Cost comparison
  if (report.costComparison.length > 0) {
    console.log("\n  Cost:");
    for (const c of report.costComparison) {
      console.log(
        `    ${c.name.padEnd(28)} $${c.totalCost.toFixed(4)} total  $${c.costPerScenario.toFixed(4)}/scenario  ${Math.round(c.tokensPerScenario).toLocaleString()} tokens/scenario`,
      );
    }
  }

  console.log("");
}

// =============================================================================
// File Output
// =============================================================================

export function writeComparisonFiles(
  outputDir: string,
  report: ComparisonReport,
): void {
  fs.mkdirSync(outputDir, { recursive: true });

  // comparison.json
  const jsonPath = path.join(outputDir, "comparison.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`  Wrote ${jsonPath}`);

  // comparison.md
  const mdPath = path.join(outputDir, "comparison.md");
  fs.writeFileSync(mdPath, generateComparisonMarkdown(report));
  console.log(`  Wrote ${mdPath}`);
}

function generateComparisonMarkdown(report: ComparisonReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines: string[] = [];

  lines.push("# Model Comparison Report");
  lines.push("");
  lines.push(`- **Runs:** ${report.runIds.join(", ")}`);
  lines.push(`- **Dates:** ${report.runDates.join(", ")}`);
  lines.push("");

  if (report.models.length > 0) {
    lines.push("## Per-Model Summary");
    lines.push("");
    lines.push("| Model | Attack Rate | Flagged | Trials | Avg Tokens | Avg Cost |");
    lines.push("|-------|------------|---------|--------|-----------|----------|");
    for (const m of report.models) {
      lines.push(
        `| ${m.name} | ${pct(m.attackSuccessRate)} | ${pct(m.flaggedRate)} | ${m.totalTrials} | ${Math.round(m.avgTokensPerTrial).toLocaleString()} | $${m.avgCostPerTrial.toFixed(4)} |`,
      );
    }
    lines.push("");
  }

  if (report.categoryDeltas.length > 0) {
    lines.push("## By Category");
    lines.push("");
    const modelNames = report.categoryDeltas[0]?.models.map((m) => m.name) ?? [];
    lines.push(`| Category | ${modelNames.join(" | ")} |`);
    lines.push(`|----------|${modelNames.map(() => "------").join("|")}|`);
    for (const cat of report.categoryDeltas) {
      const rates = cat.models.map((m) => pct(m.rate));
      lines.push(`| ${cat.category} | ${rates.join(" | ")} |`);
    }
    lines.push("");
  }

  if (report.latencyComparison.length > 0) {
    lines.push("## Latency");
    lines.push("");
    lines.push("| Run | p50 | p95 | p99 |");
    lines.push("|-----|-----|-----|-----|");
    for (const l of report.latencyComparison) {
      lines.push(`| ${l.name} | ${l.p50Ms}ms | ${l.p95Ms}ms | ${l.p99Ms}ms |`);
    }
    lines.push("");
  }

  if (report.costComparison.length > 0) {
    lines.push("## Cost");
    lines.push("");
    lines.push("| Run | Total | Per Scenario | Tokens/Scenario |");
    lines.push("|-----|-------|-------------|-----------------|");
    for (const c of report.costComparison) {
      lines.push(
        `| ${c.name} | $${c.totalCost.toFixed(4)} | $${c.costPerScenario.toFixed(4)} | ${Math.round(c.tokensPerScenario).toLocaleString()} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// =============================================================================
// Load Results from Files
// =============================================================================

export function loadResultsFromFiles(
  paths: string[],
): Array<{ label: string; data: AgentBenchmarkResults }> {
  return paths.map((p) => {
    const resolved = path.resolve(p);
    const raw = fs.readFileSync(resolved, "utf-8");
    const data = JSON.parse(raw) as AgentBenchmarkResults;
    // Use directory name as label, or filename
    const label = path.basename(path.dirname(resolved)) !== "."
      ? path.basename(path.dirname(resolved))
      : path.basename(resolved, ".json");
    return { label, data };
  });
}
