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

  let markdown = `# Benchmark Results — ${runDate}\n\n`;

  // Task results table
  markdown += `## Task Results\n\n`;
  markdown += `| Task | ${agents.join(" | ")} |\n`;
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
  markdown += `| Agent | Pass Rate | Avg TTG | Refusal Rate | Avg CVR | Total Cost |\n`;
  markdown += `|-------|-----------|---------|--------------|---------|------------|\n`;

  for (const agent of agents) {
    const agentTaskRuns = agentRuns.get(agent) ?? [];
    const metrics = agentTaskRuns.map((r) => r.metrics);
    const agg = aggregateAgentMetrics(metrics);

    markdown += `| ${agent} `;
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
