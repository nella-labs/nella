#!/usr/bin/env node

/**
 * Nella CLI
 *
 * Commands:
 *   nella check      - Pre-flight check: can the task proceed?
 *   nella validate   - Validate changes against task constraints
 *   nella run        - Full run: check + validate + metrics
 *   nella mcp        - Start MCP server for AI agent integration
 *   nella playground - Start the playground server with real-time dashboard
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import chalk from "chalk";
import Table from "cli-table3";
import figures from "figures";
import {
  runTask,
  check,
  Task,
  RawTaskYaml,
  Changes,
  FileChange,
} from "@usenella/core";
import { startMcpServer } from "./mcp/server";
import { startPlaygroundServer } from "./playground";

// =============================================================================
// Theme & Styling
// =============================================================================

const theme = {
  // Brand colors
  primary: chalk.hex("#7C3AED"),      // Purple
  secondary: chalk.hex("#06B6D4"),    // Cyan
  accent: chalk.hex("#F59E0B"),       // Amber
  
  // Status colors
  success: chalk.hex("#10B981"),      // Green
  error: chalk.hex("#EF4444"),        // Red
  warning: chalk.hex("#F59E0B"),      // Amber
  info: chalk.hex("#3B82F6"),         // Blue
  
  // Text colors
  muted: chalk.hex("#6B7280"),        // Gray
  dim: chalk.dim,
  bold: chalk.bold,
  
  // Icons
  icons: {
    success: chalk.hex("#10B981")(figures.tick),
    error: chalk.hex("#EF4444")(figures.cross),
    warning: chalk.hex("#F59E0B")(figures.warning),
    info: chalk.hex("#3B82F6")(figures.info),
    arrow: chalk.hex("#7C3AED")(figures.arrowRight),
    bullet: chalk.hex("#6B7280")(figures.bullet),
    star: chalk.hex("#F59E0B")(figures.star),
  },
};

// ASCII art logo
const logo = `
${theme.primary("  ███╗   ██╗███████╗██╗     ██╗      █████╗ ")}
${theme.primary("  ████╗  ██║██╔════╝██║     ██║     ██╔══██╗")}
${theme.primary("  ██╔██╗ ██║█████╗  ██║     ██║     ███████║")}
${theme.primary("  ██║╚██╗██║██╔══╝  ██║     ██║     ██╔══██║")}
${theme.primary("  ██║ ╚████║███████╗███████╗███████╗██║  ██║")}
${theme.primary("  ╚═╝  ╚═══╝╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝")}
`;

const tagline = theme.muted("  Reliability layer for coding agents\n");

function box(content: string, title?: string): string {
  const lines = content.split("\n");
  const maxLen = Math.max(...lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, "").length), (title?.length ?? 0) + 4);
  const width = Math.min(maxLen + 4, 70);
  
  const top = title 
    ? `${theme.muted("┌─")} ${theme.bold(title)} ${theme.muted("─".repeat(Math.max(0, width - title.length - 5)) + "┐")}`
    : theme.muted("┌" + "─".repeat(width) + "┐");
  const bottom = theme.muted("└" + "─".repeat(width) + "┘");
  
  const boxedLines = lines.map(line => {
    const cleanLen = line.replace(/\x1b\[[0-9;]*m/g, "").length;
    const padding = " ".repeat(Math.max(0, width - cleanLen - 2));
    return `${theme.muted("│")} ${line}${padding} ${theme.muted("│")}`;
  });
  
  return [top, ...boxedLines, bottom].join("\n");
}

function divider(char = "─"): string {
  return theme.muted(char.repeat(50));
}

// =============================================================================
// Argument Parsing
// =============================================================================

interface CliArgs {
  command: "check" | "validate" | "run" | "mcp" | "playground" | "help";
  taskPath?: string;
  repoPath?: string;
  changesPath?: string;
  skipValidation?: boolean;
  skipPrerequisites?: boolean;
  output?: "json" | "pretty";
  // MCP-specific args
  workspace?: string;
  // Playground-specific args
  port?: number;
  host?: string;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    command: "help",
    output: "pretty",
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    // Commands
    if (arg === "check" || arg === "validate" || arg === "run" || arg === "mcp" || arg === "playground" || arg === "help") {
      result.command = arg;
      i++;
      continue;
    }

    // Options
    if (arg === "--task" || arg === "-t") {
      result.taskPath = args[++i];
    } else if (arg === "--repo" || arg === "-r") {
      result.repoPath = args[++i];
    } else if (arg === "--changes" || arg === "-c") {
      result.changesPath = args[++i];
    } else if (arg === "--skip-validation") {
      result.skipValidation = true;
    } else if (arg === "--skip-prerequisites") {
      result.skipPrerequisites = true;
    } else if (arg === "--json") {
      result.output = "json";
    } else if (arg === "--help" || arg === "-h") {
      result.command = "help";
    } else if (arg === "--workspace" || arg === "-w") {
      result.workspace = args[++i];
    } else if (arg.startsWith("--workspace=")) {
      result.workspace = arg.slice("--workspace=".length);
    } else if (arg === "--port" || arg === "-p") {
      result.port = parseInt(args[++i], 10);
    } else if (arg.startsWith("--port=")) {
      result.port = parseInt(arg.slice("--port=".length), 10);
    } else if (arg === "--host") {
      result.host = args[++i];
    } else if (arg.startsWith("--host=")) {
      result.host = arg.slice("--host=".length);
    }

    i++;
  }

  return result;
}

// =============================================================================
// Task Loading
// =============================================================================

function loadTask(taskPath: string): Task {
  const fullPath = path.resolve(taskPath);

  // Check if it's a directory (look for task.yaml inside)
  let yamlPath = fullPath;
  if (fs.statSync(fullPath).isDirectory()) {
    yamlPath = path.join(fullPath, "task.yaml");
  }

  if (!fs.existsSync(yamlPath)) {
    throw new Error(`Task file not found: ${yamlPath}`);
  }

  const content = fs.readFileSync(yamlPath, "utf-8");
  const raw = yaml.load(content) as RawTaskYaml;

  // Transform snake_case to camelCase
  const constraints = raw.constraints ?? [];

  return {
    id: raw.id,
    name: raw.name,
    prompt: raw.prompt,
    category: raw.category as Task["category"],
    difficulty: raw.difficulty as Task["difficulty"],
    fixture: raw.fixture,
    constraints: constraints.map((c) => ({
      id: c.id,
      description: c.description,
      rule: c.rule,
      filesNotToModify: c.files_not_to_modify,
      forbiddenPatterns: c.forbidden_patterns,
    })),
    validation: raw.validation ?? {},
    expected: {
      filesToModify: raw.expected?.files_to_modify ?? [],
      filesToIgnore: raw.expected?.files_to_ignore ?? [],
      expectedLineCount: raw.expected?.expected_line_count,
    },
    refusalExpected: raw.refusal_expected,
    refusalPatterns: raw.refusal_patterns,
    timeoutSeconds: raw.timeout_seconds,
  };
}

function loadChanges(changesPath: string): Changes {
  const content = fs.readFileSync(changesPath, "utf-8");
  const data = JSON.parse(content);

  // Expect { files: FileChange[] } or { files: FileChange[], diff: string }
  return {
    files: data.files as FileChange[],
    diff: data.diff,
  };
}

// =============================================================================
// Output Formatting
// =============================================================================

function formatPretty(result: Record<string, unknown>): string {
  const lines: string[] = [];
  
  // Header with pass/fail status
  if (result.passed !== undefined) {
    if (result.passed) {
      lines.push("");
      lines.push(`  ${theme.icons.success}  ${theme.success.bold("PASSED")}`);
    } else {
      lines.push("");
      lines.push(`  ${theme.icons.error}  ${theme.error.bold("FAILED")}`);
    }
    lines.push("");
  }

  // Refusal section
  if (result.refusal) {
    const refusal = result.refusal as { shouldRefuse: boolean; reason: string };
    if (refusal.shouldRefuse) {
      lines.push(`  ${theme.icons.warning}  ${theme.warning.bold("REFUSAL DETECTED")}`);
      lines.push(`     ${theme.muted("Reason:")} ${refusal.reason}`);
      lines.push("");
    }
  }

  // Constraints table
  if (result.constraints) {
    const constraints = result.constraints as Array<{ id: string; passed: boolean; violationDetails?: string }>;
    if (constraints.length > 0) {
      lines.push(`  ${theme.secondary.bold("Constraints")}`);
      lines.push("");
      
      const table = new Table({
        chars: {
          "top": "", "top-mid": "", "top-left": "", "top-right": "",
          "bottom": "", "bottom-mid": "", "bottom-left": "", "bottom-right": "",
          "left": "  ", "left-mid": "", "mid": "", "mid-mid": "",
          "right": "", "right-mid": "", "middle": " │ ",
        },
        style: { "padding-left": 1, "padding-right": 1 },
      });
      
      for (const c of constraints) {
        const icon = c.passed ? theme.icons.success : theme.icons.error;
        const status = c.passed ? theme.success("pass") : theme.error("fail");
        const details = c.violationDetails ? theme.muted(c.violationDetails) : "";
        table.push([icon, c.id, status, details]);
      }
      
      lines.push(table.toString());
      lines.push("");
    }
  }

  // Validation section
  if (result.validation) {
    const val = result.validation as {
      test?: { success: boolean };
      lint?: { success: boolean };
      compile?: { success: boolean };
    };
    
    lines.push(`  ${theme.secondary.bold("Validation")}`);
    lines.push("");
    
    const items: string[] = [];
    if (val.test) {
      const icon = val.test.success ? theme.icons.success : theme.icons.error;
      items.push(`  ${icon}  Test`);
    }
    if (val.lint) {
      const icon = val.lint.success ? theme.icons.success : theme.icons.error;
      items.push(`  ${icon}  Lint`);
    }
    if (val.compile) {
      const icon = val.compile.success ? theme.icons.success : theme.icons.error;
      items.push(`  ${icon}  Compile`);
    }
    
    lines.push(items.join("    "));
    lines.push("");
  }

  // Scope section
  if (result.scope) {
    const scope = result.scope as { scopeCreepRatio: number; extraFiles: string[] };
    lines.push(`  ${theme.secondary.bold("Scope Analysis")}`);
    lines.push("");
    
    const ratio = scope.scopeCreepRatio * 100;
    const color = ratio === 0 ? theme.success : ratio < 50 ? theme.warning : theme.error;
    const bar = createProgressBar(Math.min(ratio, 100), 20, ratio === 0);
    
    lines.push(`  ${theme.muted("Scope Creep:")} ${bar} ${color(`${ratio.toFixed(0)}%`)}`);
    
    if (scope.extraFiles.length > 0) {
      lines.push("");
      lines.push(`  ${theme.muted("Extra files:")}`);
      for (const file of scope.extraFiles.slice(0, 5)) {
        lines.push(`    ${theme.icons.bullet} ${theme.warning(file)}`);
      }
      if (scope.extraFiles.length > 5) {
        lines.push(`    ${theme.muted(`... and ${scope.extraFiles.length - 5} more`)}`);
      }
    }
    lines.push("");
  }

  // Metrics section
  if (result.metrics) {
    const metrics = result.metrics as Record<string, unknown>;
    lines.push(`  ${theme.secondary.bold("Metrics")}`);
    lines.push("");
    
    const table = new Table({
      chars: {
        "top": "", "top-mid": "", "top-left": "", "top-right": "",
        "bottom": "", "bottom-mid": "", "bottom-left": "", "bottom-right": "",
        "left": "  ", "left-mid": "", "mid": "", "mid-mid": "",
        "right": "", "right-mid": "", "middle": "  ",
      },
      style: { "padding-left": 0, "padding-right": 2 },
    });
    
    const sc = metrics.scopeCreep as number;
    const cv = metrics.constraintViolations as number;
    const vi = metrics.validationIntegrity as number;
    
    table.push([
      theme.muted("Scope Creep"),
      formatMetricValue(sc, { good: 0, bad: 0.5, format: "percent" }),
    ]);
    table.push([
      theme.muted("Violations"),
      formatMetricValue(cv, { good: 0, bad: 0, format: "count" }),
    ]);
    table.push([
      theme.muted("Validation"),
      formatMetricValue(vi, { good: 1, bad: 0.5, format: "percent", reverse: true }),
    ]);
    
    if (metrics.refusalCorrectness !== null) {
      const rc = metrics.refusalCorrectness as boolean;
      table.push([
        theme.muted("Refusal"),
        rc ? theme.success("correct") : theme.error("incorrect"),
      ]);
    }
    
    lines.push(table.toString());
  }

  // Artifacts section
  if (result.artifacts) {
    const artifacts = result.artifacts as { runDir: string };
    lines.push("");
    lines.push(`  ${theme.muted("📁 Artifacts:")} ${theme.dim(artifacts.runDir)}`);
  }

  lines.push("");
  return lines.join("\n");
}

function createProgressBar(percent: number, width: number, success: boolean): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  
  if (success) {
    return theme.success("█".repeat(width));
  }
  
  const color = percent < 30 ? theme.success : percent < 70 ? theme.warning : theme.error;
  return color("█".repeat(filled)) + theme.dim("░".repeat(empty));
}

function formatMetricValue(
  value: number, 
  opts: { good: number; bad: number; format: "percent" | "count"; reverse?: boolean }
): string {
  let color: typeof theme.success;
  
  if (opts.reverse) {
    color = value >= opts.good ? theme.success : value >= opts.bad ? theme.warning : theme.error;
  } else {
    color = value <= opts.good ? theme.success : value <= opts.bad ? theme.warning : theme.error;
  }
  
  if (opts.format === "percent") {
    return color(`${(value * 100).toFixed(0)}%`);
  }
  return color(String(value));
}

// =============================================================================
// Commands
// =============================================================================

async function runCheckCommand(args: CliArgs): Promise<void> {
  if (!args.taskPath || !args.repoPath) {
    console.error(theme.error(`\n  ${theme.icons.error}  Missing required options: --task and --repo\n`));
    process.exit(1);
  }

  const task = loadTask(args.taskPath!);
  const repoPath = path.resolve(args.repoPath!);

  console.log("");
  console.log(`  ${theme.icons.arrow}  ${theme.muted("Checking task")} ${theme.primary.bold(task.id)}`);
  console.log("");

  const result = check(task, repoPath, {
    skipPrerequisites: args.skipPrerequisites,
  });

  if (args.output === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.shouldRefuse) {
      console.log(box([
        `${theme.icons.warning}  ${theme.warning.bold("SHOULD REFUSE")}`,
        "",
        `${theme.muted("Reason:")}     ${result.reason}`,
        result.patternsMatched.length > 0 
          ? `${theme.muted("Patterns:")}   ${result.patternsMatched.join(", ")}`
          : "",
        `${theme.muted("Confidence:")} ${theme.accent(`${(result.confidence * 100).toFixed(0)}%`)}`,
      ].filter(Boolean).join("\n"), "Refusal Check"));
    } else {
      console.log(`  ${theme.icons.success}  ${theme.success.bold("OK TO PROCEED")}`);
      console.log("");
      console.log(`  ${theme.muted("Task:")} ${task.name}`);
      console.log(`  ${theme.muted("Category:")} ${theme.secondary(task.category)} ${theme.muted("•")} ${theme.muted("Difficulty:")} ${theme.secondary(task.difficulty)}`);
    }
    console.log("");
  }

  process.exit(result.shouldRefuse ? 1 : 0);
}

async function runValidateCommand(args: CliArgs): Promise<void> {
  if (!args.taskPath || !args.repoPath || !args.changesPath) {
    console.error(theme.error(`\n  ${theme.icons.error}  Missing required options: --task, --repo, and --changes\n`));
    process.exit(1);
  }

  const task = loadTask(args.taskPath!);
  const repoPath = path.resolve(args.repoPath!);
  const changes = loadChanges(args.changesPath!);

  console.log("");
  console.log(`  ${theme.icons.arrow}  ${theme.muted("Validating")} ${theme.primary.bold(task.id)}`);

  const result = await runTask(repoPath, task, changes, {
    skipRefusalCheck: true,
    skipValidation: args.skipValidation,
    skipArtifacts: true,
  });

  if (args.output === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatPretty(result as unknown as Record<string, unknown>));
  }

  process.exit(result.passed ? 0 : 1);
}

async function runRunCommand(args: CliArgs): Promise<void> {
  if (!args.taskPath || !args.repoPath) {
    console.error(theme.error(`\n  ${theme.icons.error}  Missing required options: --task and --repo\n`));
    process.exit(1);
  }

  const task = loadTask(args.taskPath!);
  const repoPath = path.resolve(args.repoPath!);

  console.log("");
  console.log(`  ${theme.icons.arrow}  ${theme.muted("Running")} ${theme.primary.bold(task.id)}`);

  // Optionally load changes
  let changes: Changes | undefined;
  if (args.changesPath) {
    changes = loadChanges(args.changesPath);
    console.log(`  ${theme.muted("   with")} ${changes.files.length} ${theme.muted("file changes")}`);
  }

  const result = await runTask(repoPath, task, changes, {
    skipValidation: args.skipValidation,
    skipPrerequisites: args.skipPrerequisites,
  });

  if (args.output === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatPretty(result as unknown as Record<string, unknown>));
  }

  process.exit(result.passed ? 0 : 1);
}

function showHelp(): void {
  console.log(logo);
  console.log(tagline);
  
  // Commands section
  console.log(`  ${theme.secondary.bold("Commands")}`);
  console.log("");
  
  const cmdTable = new Table({
    chars: {
      "top": "", "top-mid": "", "top-left": "", "top-right": "",
      "bottom": "", "bottom-mid": "", "bottom-left": "", "bottom-right": "",
      "left": "  ", "left-mid": "", "mid": "", "mid-mid": "",
      "right": "", "right-mid": "", "middle": "  ",
    },
    style: { "padding-left": 0, "padding-right": 2 },
  });
  
  cmdTable.push(
    [theme.primary("check"), theme.muted("Pre-flight safety check — can the task proceed?")],
    [theme.primary("validate"), theme.muted("Validate changes against task constraints")],
    [theme.primary("run"), theme.muted("Full run: check + validate + compute metrics")],
    [theme.primary("mcp"), theme.muted("Start MCP server for AI agent integration")],
    [theme.primary("playground"), theme.muted("Start playground server with real-time dashboard")],
    [theme.primary("help"), theme.muted("Show this help message")],
  );
  console.log(cmdTable.toString());
  console.log("");
  
  // Options section
  console.log(`  ${theme.secondary.bold("Options")}`);
  console.log("");
  
  const optTable = new Table({
    chars: {
      "top": "", "top-mid": "", "top-left": "", "top-right": "",
      "bottom": "", "bottom-mid": "", "bottom-left": "", "bottom-right": "",
      "left": "  ", "left-mid": "", "mid": "", "mid-mid": "",
      "right": "", "right-mid": "", "middle": "  ",
    },
    style: { "padding-left": 0, "padding-right": 2 },
  });
  
  optTable.push(
    [theme.accent("--task, -t"), theme.muted("<path>"), "Path to task.yaml or task directory"],
    [theme.accent("--repo, -r"), theme.muted("<path>"), "Path to repository"],
    [theme.accent("--changes, -c"), theme.muted("<path>"), "Path to changes.json file"],
    [theme.accent("--workspace, -w"), theme.muted("<path>"), "Workspace path (for mcp/playground)"],
    [theme.accent("--port, -p"), theme.muted("<number>"), "Port for playground server (default: 3847)"],
    [theme.accent("--host"), theme.muted("<host>"), "Host for playground server (default: localhost)"],
    [theme.accent("--skip-validation"), "", "Skip test/lint/compile commands"],
    [theme.accent("--skip-prerequisites"), "", "Skip prerequisite checks"],
    [theme.accent("--json"), "", "Output as JSON"],
    [theme.accent("--help, -h"), "", "Show help"],
  );
  console.log(optTable.toString());
  console.log("");
  
  // Examples section
  console.log(`  ${theme.secondary.bold("Examples")}`);
  console.log("");
  console.log(`  ${theme.muted("# Check if a task can proceed")}`);
  console.log(`  ${theme.dim("$")} nella check -t tasks/get-user-by-id -r ./fixture`);
  console.log("");
  console.log(`  ${theme.muted("# Validate changes against constraints")}`);
  console.log(`  ${theme.dim("$")} nella validate -t tasks/fix-bug -r ./fixture -c changes.json`);
  console.log("");
  console.log(`  ${theme.muted("# Full run with JSON output")}`);
  console.log(`  ${theme.dim("$")} nella run -t tasks/add-feature -r ./fixture -c changes.json --json`);
  console.log("");
  console.log(`  ${theme.muted("# Start MCP server for AI agent integration")}`);
  console.log(`  ${theme.dim("$")} nella mcp --workspace /path/to/project`);
  console.log("");
  console.log(`  ${theme.muted("# Start playground server with real-time dashboard")}`);
  console.log(`  ${theme.dim("$")} nella playground --workspace /path/to/project --port 3847`);
  console.log("");
  
  // Footer
  console.log(divider());
  console.log(`  ${theme.muted("Documentation:")} ${theme.secondary("https://github.com/nella-labs/nella")}`);
  console.log(`  ${theme.muted("Version:")} ${theme.dim("0.2.0")}`);
  console.log("");
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "check":
      await runCheckCommand(args);
      break;
    case "validate":
      await runValidateCommand(args);
      break;
    case "run":
      await runRunCommand(args);
      break;
    case "mcp":
      await startMcpServer({ workspace: args.workspace });
      break;
    case "playground":
      await startPlaygroundServer({
        workspace: args.workspace,
        port: args.port,
        host: args.host,
      });
      break;
    case "help":
    default:
      showHelp();
      break;
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
