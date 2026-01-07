#!/usr/bin/env node
/**
 * Benchmark CLI
 *
 * Simple CLI to run the benchmark suite
 *
 * Usage:
 *   npx ts-node src/cli.ts --tasks-dir ../tasks --output ./results
 *   npm run benchmark -- --help
 */

import * as path from "path";
import * as dotenv from "dotenv";

// Load .env file from the benchmark package directory
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { BenchmarkRunner } from "./runner/benchmark-runner";
import { loadAllTasks } from "./scenarios";
import { BenchmarkConfig, AgentConfig } from "./types";
import { writeDashboard } from "./reports";

interface CliArgs {
  tasksDir: string;
  fixturesDir: string;
  outputDir: string;
  runId: string;
  agents: string[];
  maxIterations: number;
  skipCompleted: boolean;
  tasks?: string[];
  dashboard: boolean;
  runs: number;
}

/**
 * Generate a run ID with date and short unique suffix
 * Format: YYYY-MM-DD_HHMMSS_XXXX (e.g., 2026-01-06_143052_a1b2)
 */
function generateRunId(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const time = now.toTimeString().slice(0, 8).replace(/:/g, ""); // HHMMSS
  const suffix = Math.random().toString(36).substring(2, 6); // 4 char random
  return `${date}_${time}_${suffix}`;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    tasksDir: path.resolve(__dirname, "../../../tasks"),
    fixturesDir: path.resolve(__dirname, "../../../fixtures"),
    outputDir: path.resolve(process.cwd(), "benchmark-results"),
    runId: "",
    agents: [],
    maxIterations: 3,
    skipCompleted: false,
    dashboard: false,
    runs: 1,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;

      case "--tasks-dir":
        result.tasksDir = path.resolve(args[++i]);
        break;

      case "--fixtures-dir":
        result.fixturesDir = path.resolve(args[++i]);
        break;

      case "--output":
      case "-o":
        result.outputDir = path.resolve(args[++i]);
        break;

      case "--agent":
      case "-a":
        result.agents.push(args[++i]);
        break;

      case "--max-iterations":
        result.maxIterations = parseInt(args[++i], 10);
        break;

      case "--skip-completed":
        result.skipCompleted = true;
        break;

      case "--tasks":
      case "-t":
        result.tasks = args[++i].split(",");
        break;

      case "--run-id":
        result.runId = args[++i];
        break;

      case "--dashboard":
        result.dashboard = true;
        break;

      case "--runs":
      case "-n":
        result.runs = parseInt(args[++i], 10);
        break;
    }
  }

  // Default agents from environment
  if (result.agents.length === 0) {
    if (process.env.ANTHROPIC_API_KEY) {
      result.agents.push("claude-sonnet");
    }
    if (process.env.OPENAI_API_KEY) {
      result.agents.push("gpt-4o");
    }
  }

  return result;
}

function printHelp() {
  console.log(`
Nella Benchmark CLI

Usage:
  npx ts-node src/cli.ts [options]

Options:
  --tasks-dir <path>     Directory containing task folders (default: ../tasks)
  --fixtures-dir <path>  Directory containing fixture codebases (default: ../fixtures)
  --output, -o <path>    Output directory for results (default: ./benchmark-results)
  --agent, -a <name>     Agent to use (can be specified multiple times)
                         Supported: claude-sonnet, claude-opus, gpt-4o, gpt-4o-mini
  --max-iterations <n>   Max retry iterations per task (default: 3)
  --skip-completed       Skip tasks already in results.jsonl
  --tasks, -t <ids>      Comma-separated task IDs to run
  --run-id <id>          Custom run ID (default: auto-generated YYYY-MM-DD_HHMMSS_XXXX)
  --runs, -n <count>     Number of benchmark runs to execute (default: 1)
  --dashboard            Generate dashboard from existing results (no benchmark run)
  --help, -h             Show this help message

Environment Variables:
  ANTHROPIC_API_KEY      API key for Claude models
  OPENAI_API_KEY         API key for OpenAI models

Examples:
  # Run with Claude Sonnet
  ANTHROPIC_API_KEY=sk-... npx ts-node src/cli.ts -a claude-sonnet

  # Run specific tasks
  npx ts-node src/cli.ts -t get-user-by-id,fix-duplicate-email

  # Resume a previous run with specific run ID
  npx ts-node src/cli.ts --run-id 2026-01-06_143052_a1b2 --skip-completed

  # Run 20 benchmark iterations
  npx ts-node src/cli.ts -a gpt-4o --runs 20
`);
}

function buildAgentConfigs(agentNames: string[]): Record<string, AgentConfig> {
  const configs: Record<string, AgentConfig> = {};

  for (const name of agentNames) {
    switch (name) {
      case "claude-sonnet":
        if (!process.env.ANTHROPIC_API_KEY) {
          console.error("ANTHROPIC_API_KEY is required for claude-sonnet");
          process.exit(1);
        }
        configs["claude-sonnet"] = {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          apiKey: process.env.ANTHROPIC_API_KEY,
        };
        break;

      case "claude-opus":
        if (!process.env.ANTHROPIC_API_KEY) {
          console.error("ANTHROPIC_API_KEY is required for claude-opus");
          process.exit(1);
        }
        configs["claude-opus"] = {
          provider: "anthropic",
          model: "claude-opus-4-20250514",
          apiKey: process.env.ANTHROPIC_API_KEY,
        };
        break;

      case "gpt-4o":
        if (!process.env.OPENAI_API_KEY) {
          console.error("OPENAI_API_KEY is required for gpt-4o");
          process.exit(1);
        }
        configs["gpt-4o"] = {
          provider: "openai",
          model: "gpt-4o",
          apiKey: process.env.OPENAI_API_KEY,
        };
        break;

      case "gpt-4o-mini":
        if (!process.env.OPENAI_API_KEY) {
          console.error("OPENAI_API_KEY is required for gpt-4o-mini");
          process.exit(1);
        }
        configs["gpt-4o-mini"] = {
          provider: "openai",
          model: "gpt-4o-mini",
          apiKey: process.env.OPENAI_API_KEY,
        };
        break;

      default:
        console.error(`Unknown agent: ${name}`);
        process.exit(1);
    }
  }

  return configs;
}

async function main() {
  const args = parseArgs();

  // Dashboard-only mode
  if (args.dashboard) {
    console.log("Generating dashboard from existing results...");
    const dashboardPath = writeDashboard(args.outputDir);
    console.log(`\n✅ Dashboard generated: ${dashboardPath}`);
    return;
  }

  if (args.agents.length === 0) {
    console.error("No agents configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or use --agent flag.");
    process.exit(1);
  }

  // Load tasks
  console.log(`Loading tasks from ${args.tasksDir}...`);
  const result = loadAllTasks(args.tasksDir);
  if (result.errors.length > 0) {
    console.warn(`Warnings while loading tasks:`);
    for (const err of result.errors) {
      console.warn(`  - ${err.file}: ${err.error}`);
    }
  }
  console.log(`Found ${result.tasks.length} tasks\n`);

  // Run benchmark(s)
  for (let runNum = 1; runNum <= args.runs; runNum++) {
    if (args.runs > 1) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`📍 Run ${runNum} of ${args.runs}`);
      console.log(`${"=".repeat(60)}\n`);
    }

    // Generate a new run ID for each run (unless custom ID provided for single run)
    const runId = (args.runs === 1 && args.runId) ? args.runId : generateRunId();
    const runOutputDir = path.join(args.outputDir, runId);

    console.log(`Run ID: ${runId}`);
    console.log(`Output: ${runOutputDir}\n`);

    // Build config
    const config: BenchmarkConfig = {
      tasksDir: args.tasksDir,
      fixturesDir: args.fixturesDir,
      outputDir: runOutputDir,
      agents: buildAgentConfigs(args.agents),
      maxIterations: args.maxIterations,
    };

    // Create and run benchmark
    const runner = new BenchmarkRunner({ config, tasks: result.tasks });

    try {
      await runner.runAll({
        tasks: args.tasks,
        skipCompleted: args.skipCompleted,
      });
    } catch (error) {
      console.error(`Run ${runNum} failed:`, error);
      // Continue with next run instead of exiting
    }
  }

  // Auto-generate dashboard after all runs
  console.log("\n📊 Updating dashboard...");
  const dashboardPath = writeDashboard(args.outputDir);
  console.log(`   Dashboard: ${dashboardPath}`);
}

main().catch(console.error);
