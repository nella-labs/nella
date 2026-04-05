/**
 * Markdown Generator
 *
 * Generates summary.md report from benchmark results
 */

import * as fs from "fs";
import * as path from "path";
import { TaskRun, Task } from "../types";
import { aggregateAgentMetrics } from "../metrics/calculator";

export interface MarkdownGeneratorOptions {
  outputDir: string;
  runs: TaskRun[];
  tasks: Task[];
}

/**
 * Generate summary.md report
 */
export function generateSummaryMarkdown(options: MarkdownGeneratorOptions): string {
  const { runs, tasks } = options;

  const runDate = new Date().toISOString().split("T")[0];

  // Group runs by agent
  const agentRuns = new Map<string, TaskRun[]>();
  for (const run of runs) {
    const existing = agentRuns.get(run.agent) ?? [];
    existing.push(run);
    agentRuns.set(run.agent, existing);
  }

  const agents = Array.from(agentRuns.keys()).sort();
  const taskIds = tasks.map((t) => t.id);

  // Check if we have both Nella and non-Nella runs
  const nellaRuns = runs.filter((r) => r.nellaEnabled);
  const nonNellaRuns = runs.filter((r) => !r.nellaEnabled);
  const isMixedBenchmark = nellaRuns.length > 0 && nonNellaRuns.length > 0;

  let markdown = `# Benchmark Results — ${runDate}\n\n`;

  // Show Nella comparison info if applicable
  if (isMixedBenchmark) {
    markdown += `> 🛡️ **Nella Comparison Benchmark**: Testing agent performance with and without Nella codebase intelligence.\n`;
    markdown += `> - Runs with Nella: ${nellaRuns.length}\n`;
    markdown += `> - Runs without Nella: ${nonNellaRuns.length}\n\n`;
  } else if (nellaRuns.length > 0) {
    markdown += `> 🛡️ All runs in this benchmark used **Nella codebase intelligence**.\n\n`;
  }

  // Task results table - show Nella status in agent column header
  markdown += `## Task Results\n\n`;
  const agentHeaders = agents.map((agent) => {
    const agentTaskRuns = agentRuns.get(agent) ?? [];
    const nellaEnabled = agentTaskRuns[0]?.nellaEnabled ?? false;
    return nellaEnabled ? `${agent} 🛡️` : agent;
  });
  markdown += `| Task | ${agentHeaders.join(" | ")} |\n`;
  markdown += `|------|${agents.map(() => "------").join("|")}|\n`;

  for (const taskId of taskIds) {
    const row = [taskId];

    for (const agent of agents) {
      const agentTaskRuns = agentRuns.get(agent) ?? [];
      const run = agentTaskRuns.find((r) => r.taskId === taskId);

      if (!run) {
        row.push("—");
      } else if (run.passed) {
        row.push(`✅ ${run.metrics.ttg.toFixed(0)}s`);
      } else if (run.refused && run.metrics.rc === true) {
        row.push("✅ RC");
      } else if (run.refused && run.metrics.rc === false) {
        row.push("❌ Wrong Refusal");
      } else {
        const failReason = getFailReason(run);
        row.push(`❌ ${failReason}`);
      }
    }

    markdown += `| ${row.join(" | ")} |\n`;
  }

  // Metrics summary table
  markdown += `\n## Metrics Summary\n\n`;
  markdown += `| Agent | Nella | Pass Rate | Avg TTG | Refusal Rate | Avg CVR | Total Cost |\n`;
  markdown += `|-------|-------|-----------|---------|--------------|---------|------------|\n`;

  for (const agent of agents) {
    const agentTaskRuns = agentRuns.get(agent) ?? [];
    const metrics = agentTaskRuns.map((r) => r.metrics);
    const agg = aggregateAgentMetrics(metrics);
    const nellaEnabled = agentTaskRuns[0]?.nellaEnabled ?? false;

    markdown += `| ${agent} `;
    markdown += `| ${nellaEnabled ? "🛡️ Yes" : "No"} `;
    markdown += `| ${(agg.passRate * 100).toFixed(0)}% `;
    markdown += `| ${agg.avgTtg.toFixed(0)}s `;
    markdown += `| ${(agg.refusalRate * 100).toFixed(0)}% `;
    markdown += `| ${agg.avgCvr.toFixed(2)} `;
    markdown += `| $${agg.totalCost.toFixed(2)} |\n`;
  }

  // Detailed metrics
  markdown += `\n## Detailed Metrics\n\n`;
  markdown += `| Agent | VI | SC | DA | IC | Tokens | Cost |\n`;
  markdown += `|-------|-----|-----|-----|-----|--------|------|\n`;

  for (const agent of agents) {
    const agentTaskRuns = agentRuns.get(agent) ?? [];
    const metrics = agentTaskRuns.map((r) => r.metrics);
    const agg = aggregateAgentMetrics(metrics);

    markdown += `| ${agent} `;
    markdown += `| ${agg.avgVi.toFixed(2)} `;
    markdown += `| ${agg.avgSc.toFixed(2)} `;
    markdown += `| ${agg.avgDa.toFixed(2)} `;
    markdown += `| ${agg.avgIc.toFixed(1)} `;
    markdown += `| ${agg.totalTokens.toLocaleString()} `;
    markdown += `| $${agg.totalCost.toFixed(2)} |\n`;
  }

  // Nella vs Non-Nella cost comparison (only for mixed benchmarks)
  if (isMixedBenchmark) {
    const nellaMetrics = nellaRuns.map((r) => r.metrics);
    const nonNellaMetrics = nonNellaRuns.map((r) => r.metrics);
    const nellaAgg = aggregateAgentMetrics(nellaMetrics);
    const nonNellaAgg = aggregateAgentMetrics(nonNellaMetrics);

    markdown += `\n## Token & Cost Comparison: Nella vs Non-Nella\n\n`;
    markdown += `| Metric | With Nella | Without Nella | Difference |\n`;
    markdown += `|--------|-----------|--------------|------------|\n`;

    const tokenDiff = nellaAgg.totalTokens - nonNellaAgg.totalTokens;
    const avgNellaTokens = nellaRuns.length > 0 ? nellaAgg.totalTokens / nellaRuns.length : 0;
    const avgNonNellaTokens = nonNellaRuns.length > 0 ? nonNellaAgg.totalTokens / nonNellaRuns.length : 0;
    const avgTokenDiffPctVal = avgNonNellaTokens > 0
      ? ((avgNellaTokens - avgNonNellaTokens) / avgNonNellaTokens) * 100
      : null;
    const avgTokenDiffPct = avgTokenDiffPctVal !== null
      ? `${avgTokenDiffPctVal >= 0 ? "+" : ""}${avgTokenDiffPctVal.toFixed(1)}%`
      : "—";

    const avgNellaCost = nellaRuns.length > 0 ? nellaAgg.totalCost / nellaRuns.length : 0;
    const avgNonNellaCost = nonNellaRuns.length > 0 ? nonNellaAgg.totalCost / nonNellaRuns.length : 0;
    const avgCostDiffPctVal = avgNonNellaCost > 0
      ? ((avgNellaCost - avgNonNellaCost) / avgNonNellaCost) * 100
      : null;
    const avgCostDiffPct = avgCostDiffPctVal !== null
      ? `${avgCostDiffPctVal >= 0 ? "+" : ""}${avgCostDiffPctVal.toFixed(1)}%`
      : "—";

    const totalCostDiff = nellaAgg.totalCost - nonNellaAgg.totalCost;
    const passRateDiff = (nellaAgg.passRate - nonNellaAgg.passRate) * 100;

    markdown += `| Runs | ${nellaRuns.length} | ${nonNellaRuns.length} | — |\n`;
    markdown += `| Total Tokens | ${nellaAgg.totalTokens.toLocaleString()} | ${nonNellaAgg.totalTokens.toLocaleString()} | ${tokenDiff >= 0 ? "+" : ""}${tokenDiff.toLocaleString()} |\n`;
    markdown += `| Avg Tokens/Run | ${Math.round(avgNellaTokens).toLocaleString()} | ${Math.round(avgNonNellaTokens).toLocaleString()} | ${avgTokenDiffPct} |\n`;
    markdown += `| Total Cost | $${nellaAgg.totalCost.toFixed(2)} | $${nonNellaAgg.totalCost.toFixed(2)} | ${totalCostDiff >= 0 ? "+$" : "-$"}${Math.abs(totalCostDiff).toFixed(2)} |\n`;
    markdown += `| Avg Cost/Run | $${avgNellaCost.toFixed(4)} | $${avgNonNellaCost.toFixed(4)} | ${avgCostDiffPct} |\n`;
    markdown += `| Pass Rate | ${(nellaAgg.passRate * 100).toFixed(0)}% | ${(nonNellaAgg.passRate * 100).toFixed(0)}% | ${passRateDiff >= 0 ? "+" : ""}${passRateDiff.toFixed(0)}pp |\n`;
  }

  // Legend
  markdown += `\n## Legend\n\n`;
  markdown += `- **BTP**: Build/Test Pass\n`;
  markdown += `- **VI**: Validation Integrity (0-1)\n`;
  markdown += `- **CVR**: Constraint Violation Rate (0-1, lower = better)\n`;
  markdown += `- **SC**: Scope Creep (0-1, lower = better)\n`;
  markdown += `- **RC**: Refusal Correctness\n`;
  markdown += `- **TTG**: Time to Green (seconds)\n`;
  markdown += `- **IC**: Iteration Count\n`;
  markdown += `- **DA**: Diff Accuracy (0-1)\n`;

  return markdown;
}

/**
 * Write summary.md to disk
 */
export function writeSummaryMarkdown(options: MarkdownGeneratorOptions): void {
  const markdown = generateSummaryMarkdown(options);
  const summaryPath = path.join(options.outputDir, "summary.md");

  // Ensure output directory exists
  if (!fs.existsSync(options.outputDir)) {
    fs.mkdirSync(options.outputDir, { recursive: true });
  }

  fs.writeFileSync(summaryPath, markdown, "utf-8");
}

/**
 * Get a short failure reason for display
 */
function getFailReason(run: TaskRun): string {
  if (run.metrics.cvr > 0) {
    return `CVR:${run.metrics.cvr.toFixed(1)}`;
  }
  if (run.metrics.sc > 0.5) {
    return `SC:${run.metrics.sc.toFixed(1)}`;
  }
  if (!run.validation.testPassed) {
    return "Tests";
  }
  if (!run.validation.lintPassed) {
    return "Lint";
  }
  if (!run.validation.compilePassed) {
    return "Types";
  }
  return "Failed";
}
