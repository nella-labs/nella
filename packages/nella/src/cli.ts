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
 *
 * MCP Quick Start:
 *   npx @getnella/mcp                   # starts MCP server directly
 *   npx @getnella/mcp -w /path/to/repo  # with explicit workspace
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
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
  createIndexManager,
  DEFAULT_INDEX_CONFIG,
} from "@usenella/core";
import type { IndexManagerConfig, IndexEvent } from "@usenella/core";
import { startMcpServer } from "./mcp/server";
import { startHostedServer } from "./mcp/hosted-server";
import { startPlaygroundServer } from "./playground";
import {
  login,
  loadSession,
  clearSession,
  getValidSession,
  createApiKey,
} from "./auth";

// =============================================================================
// Theme & Styling
// =============================================================================

// Read version from package.json
const PKG_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch { return "0.0.0"; }
})();

const theme = {
  // Brand colors — Nella green identity
  primary: chalk.hex("#2ECC71"),      // Nella green (from logo)
  secondary: chalk.hex("#27AE60"),    // Darker green
  accent: chalk.hex("#F1C40F"),       // Gold

  // Status colors
  success: chalk.hex("#2ECC71"),      // Nella green
  error: chalk.hex("#EF4444"),        // Red
  warning: chalk.hex("#F59E0B"),      // Amber
  info: chalk.hex("#3498DB"),         // Soft blue

  // Text colors
  muted: chalk.hex("#95A5A6"),        // Light gray
  dim: chalk.dim,
  bold: chalk.bold,

  // Icons
  icons: {
    success: chalk.hex("#2ECC71")(figures.tick),
    error: chalk.hex("#EF4444")(figures.cross),
    warning: chalk.hex("#F59E0B")(figures.warning),
    info: chalk.hex("#3498DB")(figures.info),
    arrow: chalk.hex("#2ECC71")(figures.arrowRight),
    bullet: chalk.hex("#95A5A6")(figures.bullet),
    star: chalk.hex("#F1C40F")(figures.star),
  },
};

// ASCII art logo with green gradient (bright → dark from top to bottom)
const g1 = chalk.hex("#5BF5A0"); // Lightest
const g2 = chalk.hex("#3DE87D");
const g3 = chalk.hex("#2ECC71"); // Brand green
const g4 = chalk.hex("#27AE60");
const g5 = chalk.hex("#1F8A4C");
const g6 = chalk.hex("#176E3A"); // Darkest

const logo = `
${g1("  ███╗   ██╗")}${g1("███████╗")}${g1("██╗     ██╗      █████╗ ")}
${g2("  ████╗  ██║")}${g2("██╔════╝")}${g2("██║     ██║     ██╔══██╗")}
${g3("  ██╔██╗ ██║")}${g3("█████╗  ")}${g3("██║     ██║     ███████║")}
${g4("  ██║╚██╗██║")}${g4("██╔══╝  ")}${g4("██║     ██║     ██╔══██║")}
${g5("  ██║ ╚████║")}${g5("███████╗")}${g5("███████╗███████╗██║  ██║")}
${g6("  ╚═╝  ╚═══╝")}${g6("╚══════╝")}${g6("╚══════╝╚══════╝╚═╝  ╚═╝")}
`;

const tagline = `  ${theme.muted("Reliability layer for coding agents")}  ${chalk.dim(`v${PKG_VERSION}`)}\n`;

function sectionHeader(title: string): string {
  const line = theme.muted("─".repeat(Math.max(0, 40 - title.length)));
  return `  ${theme.primary("┌")} ${theme.primary.bold(title)} ${line}`;
}

function box(content: string, title?: string): string {
  const lines = content.split("\n");
  const maxLen = Math.max(...lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, "").length), (title?.length ?? 0) + 4);
  const width = Math.min(maxLen + 4, 70);

  const borderColor = chalk.hex("#27AE60");

  const top = title
    ? `${borderColor("╔═")} ${theme.primary.bold(title)} ${borderColor("═".repeat(Math.max(0, width - title.length - 5)) + "╗")}`
    : borderColor("╔" + "═".repeat(width) + "╗");
  const bottom = borderColor("╚" + "═".repeat(width) + "╝");

  const boxedLines = lines.map(line => {
    const cleanLen = line.replace(/\x1b\[[0-9;]*m/g, "").length;
    const padding = " ".repeat(Math.max(0, width - cleanLen - 2));
    return `${borderColor("║")} ${line}${padding} ${borderColor("║")}`;
  });

  return [top, ...boxedLines, bottom].join("\n");
}

function divider(): string {
  return `  ${theme.muted("─".repeat(20))} ${theme.primary("✦")} ${theme.muted("─".repeat(20))}`;
}

// =============================================================================
// Argument Parsing
// =============================================================================

interface CliArgs {
  command: "check" | "validate" | "run" | "index" | "mcp" | "serve" | "connect" | "auth" | "playground" | "setup" | "help";
  force?: boolean;
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
  // Connect-specific args
  apiKey?: string;
  serverUrl?: string;
  client?: "claude" | "vscode" | "cursor" | "all";
  // Auth-specific args
  authSubcommand?: "login" | "logout" | "status";
  // Help flag (per-command)
  showHelp?: boolean;
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
    if (arg === "check" || arg === "validate" || arg === "run" || arg === "index" || arg === "mcp" || arg === "serve" || arg === "connect" || arg === "auth" || arg === "playground" || arg === "setup" || arg === "help") {
      result.command = arg as CliArgs["command"];

      // Parse auth subcommand
      if (arg === "auth" && i + 1 < args.length) {
        const sub = args[i + 1];
        if (sub === "login" || sub === "logout" || sub === "status") {
          result.authSubcommand = sub;
          i++; // consume subcommand
        }
      }

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
    } else if (arg === "--force" || arg === "-f") {
      result.force = true;
    } else if (arg === "--skip-validation") {
      result.skipValidation = true;
    } else if (arg === "--skip-prerequisites") {
      result.skipPrerequisites = true;
    } else if (arg === "--json") {
      result.output = "json";
    } else if (arg === "--help" || arg === "-h") {
      if (result.command === "help") {
        // No command set yet — show global help
        result.command = "help";
      } else {
        // Command already set — show command-specific help
        result.showHelp = true;
      }
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
    } else if (arg === "--api-key" || arg === "-k") {
      result.apiKey = args[++i];
    } else if (arg.startsWith("--api-key=")) {
      result.apiKey = arg.slice("--api-key=".length);
    } else if (arg === "--server-url" || arg === "-u") {
      result.serverUrl = args[++i];
    } else if (arg.startsWith("--server-url=")) {
      result.serverUrl = arg.slice("--server-url=".length);
    } else if (arg === "--client") {
      result.client = args[++i] as "claude" | "vscode" | "cursor" | "all";
    } else if (arg.startsWith("--client=")) {
      result.client = arg.slice("--client=".length) as "claude" | "vscode" | "cursor" | "all";
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
      lines.push(sectionHeader("Constraints"));
      
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
    
    lines.push(sectionHeader("Validation"));
    
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
    lines.push(sectionHeader("Scope Analysis"));
    
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
    lines.push(sectionHeader("Metrics"));
    
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
    return theme.success("▓".repeat(width));
  }

  const color = percent < 30 ? theme.success : percent < 70 ? theme.warning : theme.error;
  return color("▓".repeat(filled)) + theme.muted("░".repeat(empty));
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
  if (args.showHelp || (!args.taskPath || !args.repoPath)) {
    console.log(logo);
    console.log(tagline);
    console.log(`  ${theme.primary.bold("nella check")} — Pre-flight check: can the task proceed?\n`);
    console.log(`  ${theme.primary.bold("Usage:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella check --task <path> --repo <path>")}\n`);
    console.log(`  ${theme.primary.bold("Options:")}\n`);
    console.log(`    ${theme.accent("--task, -t")} ${theme.muted("<path>")}    Path to task.yaml or task directory`);
    console.log(`    ${theme.accent("--repo, -r")} ${theme.muted("<path>")}    Path to repository`);
    console.log(`    ${theme.accent("--skip-prerequisites")}    Skip prerequisite checks`);
    console.log(`    ${theme.accent("--json")}                Output as JSON`);
    console.log("");
    if (args.showHelp) return;
    process.exit(1);
  }

  const task = loadTask(args.taskPath!);
  const repoPath = path.resolve(args.repoPath!);

  console.log("");
  console.log(`  ${theme.primary("nella")} ${theme.muted("▸")} checking ${theme.primary.bold(task.id)}`);
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
  if (args.showHelp || (!args.taskPath || !args.repoPath || !args.changesPath)) {
    console.log(logo);
    console.log(tagline);
    console.log(`  ${theme.primary.bold("nella validate")} — Validate changes against task constraints\n`);
    console.log(`  ${theme.primary.bold("Usage:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella validate --task <path> --repo <path> --changes <path>")}\n`);
    console.log(`  ${theme.primary.bold("Options:")}\n`);
    console.log(`    ${theme.accent("--task, -t")} ${theme.muted("<path>")}       Path to task.yaml or task directory`);
    console.log(`    ${theme.accent("--repo, -r")} ${theme.muted("<path>")}       Path to repository`);
    console.log(`    ${theme.accent("--changes, -c")} ${theme.muted("<path>")}    Path to changes.json file`);
    console.log(`    ${theme.accent("--skip-validation")}        Skip test/lint/compile commands`);
    console.log(`    ${theme.accent("--json")}                   Output as JSON`);
    console.log("");
    if (args.showHelp) return;
    process.exit(1);
  }

  const task = loadTask(args.taskPath!);
  const repoPath = path.resolve(args.repoPath!);
  const changes = loadChanges(args.changesPath!);

  console.log("");
  console.log(`  ${theme.primary("nella")} ${theme.muted("▸")} validating ${theme.primary.bold(task.id)}`);

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
  if (args.showHelp) {
    console.log(logo);
    console.log(tagline);
    console.log(`  ${theme.primary.bold("nella run")} — Full run: check + validate + metrics\n`);
    console.log(`  ${theme.primary.bold("Usage:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella run --task <path> --repo <path> [--changes <path>]")}\n`);
    console.log(`  ${theme.primary.bold("Options:")}\n`);
    console.log(`    ${theme.accent("--task, -t")} ${theme.muted("<path>")}       Path to task.yaml or task directory`);
    console.log(`    ${theme.accent("--repo, -r")} ${theme.muted("<path>")}       Path to repository`);
    console.log(`    ${theme.accent("--changes, -c")} ${theme.muted("<path>")}    Path to changes.json file (optional)`);
    console.log(`    ${theme.accent("--skip-validation")}        Skip test/lint/compile commands`);
    console.log(`    ${theme.accent("--skip-prerequisites")}     Skip prerequisite checks`);
    console.log(`    ${theme.accent("--json")}                   Output as JSON`);
    console.log("");
    return;
  }
  if (!args.taskPath || !args.repoPath) {
    console.error(theme.error(`\n  ${theme.icons.error}  Missing required options: --task and --repo\n`));
    process.exit(1);
  }

  const task = loadTask(args.taskPath!);
  const repoPath = path.resolve(args.repoPath!);

  console.log("");
  console.log(`  ${theme.primary("nella")} ${theme.muted("▸")} running ${theme.primary.bold(task.id)}`);

  // Optionally load changes
  let changes: Changes | undefined;
  if (args.changesPath) {
    changes = loadChanges(args.changesPath);
    console.log(`  ${theme.muted("       with")} ${changes.files.length} ${theme.muted("file changes")}`);
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

// =============================================================================
// Connect Command
// =============================================================================

interface McpClientConfig {
  url: string;
  headers: { Authorization: string };
}

function getClaudeDesktopConfigPath(): string {
  const platform = process.platform;
  if (platform === "win32") {
    return path.join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json");
  } else if (platform === "darwin") {
    return path.join(process.env.HOME || "", "Library", "Application Support", "Claude", "claude_desktop_config.json");
  } else {
    return path.join(process.env.HOME || "", ".config", "claude", "claude_desktop_config.json");
  }
}

function getVsCodeMcpConfigPath(): string {
  // Write to .vscode/mcp.json in the current working directory
  return path.join(process.cwd(), ".vscode", "mcp.json");
}

function getCursorMcpConfigPath(): string {
  // Write to ~/.cursor/mcp.json (global Cursor MCP config)
  const home = process.platform === "win32" ? process.env.USERPROFILE || "" : process.env.HOME || "";
  return path.join(home, ".cursor", "mcp.json");
}

function configureClaudeDesktop(serverUrl: string, apiKey: string): { success: boolean; path: string; error?: string } {
  const configPath = getClaudeDesktopConfigPath();

  try {
    let config: Record<string, unknown> = {};

    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } else {
      // Ensure directory exists
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Add or update nella MCP server
    const mcpServers = (config.mcpServers as Record<string, unknown>) || {};
    mcpServers.nella = {
      url: serverUrl,
      headers: { Authorization: `Bearer ${apiKey}` },
    } as McpClientConfig;
    config.mcpServers = mcpServers;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    return { success: true, path: configPath };
  } catch (err) {
    return { success: false, path: configPath, error: err instanceof Error ? err.message : String(err) };
  }
}

function configureVsCode(serverUrl: string, apiKey: string): { success: boolean; path: string; error?: string } {
  const configPath = getVsCodeMcpConfigPath();

  try {
    let config: Record<string, unknown> = {};

    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } else {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    const servers = (config.servers as Record<string, unknown>) || {};
    servers.nella = {
      url: serverUrl,
      headers: { Authorization: `Bearer ${apiKey}` },
    } as McpClientConfig;
    config.servers = servers;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    return { success: true, path: configPath };
  } catch (err) {
    return { success: false, path: configPath, error: err instanceof Error ? err.message : String(err) };
  }
}

function configureCursor(serverUrl: string, apiKey: string): { success: boolean; path: string; error?: string } {
  const configPath = getCursorMcpConfigPath();

  try {
    let config: Record<string, unknown> = {};

    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } else {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Cursor uses "mcpServers" (same as Claude Desktop)
    const mcpServers = (config.mcpServers as Record<string, unknown>) || {};
    mcpServers.nella = {
      url: serverUrl,
      headers: { Authorization: `Bearer ${apiKey}` },
    } as McpClientConfig;
    config.mcpServers = mcpServers;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    return { success: true, path: configPath };
  } catch (err) {
    return { success: false, path: configPath, error: err instanceof Error ? err.message : String(err) };
  }
}

// =============================================================================
// Auth Command
// =============================================================================

async function runAuthCommand(args: CliArgs): Promise<void> {
  console.log(logo);
  console.log(tagline);

  const sub = args.authSubcommand;

  if (!sub || args.showHelp) {
    console.log(`  ${theme.primary.bold("nella auth")} — Manage authentication\n`);
    console.log(`  ${theme.primary.bold("Usage:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella auth login")}    ${theme.muted("Log in with your Nella account")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella auth logout")}   ${theme.muted("Clear stored credentials")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella auth status")}   ${theme.muted("Show current login state")}`);
    console.log("");
    return;
  }

  if (sub === "login") {
    console.log(`  ${theme.icons.info}  ${theme.bold("Log in to Nella")}\n`);

    const result = await login();

    if (result.success) {
      console.log(`\n  ${theme.icons.success}  ${theme.success.bold("Logged in")} as ${theme.secondary(result.email!)}`);
      console.log(`  ${theme.muted("   Session saved to ~/.nella/auth.json")}\n`);
      console.log(`  ${theme.muted("Next:")} ${theme.secondary("nella connect")} to configure your MCP clients\n`);
    } else {
      console.log(`\n  ${theme.icons.error}  ${theme.error.bold("Login failed:")} ${result.error}\n`);
      process.exit(1);
    }
    return;
  }

  if (sub === "logout") {
    clearSession();
    console.log(`  ${theme.icons.success}  ${theme.success("Logged out")} \u2014 credentials removed\n`);
    return;
  }

  if (sub === "status") {
    const session = await getValidSession();
    if (session) {
      console.log(`  ${theme.icons.success}  ${theme.success.bold("Authenticated")}\n`);
      console.log(`  ${theme.muted("Email:")}   ${theme.secondary(session.user.email)}`);
      console.log(`  ${theme.muted("User ID:")} ${theme.dim(session.user.id)}`);
      const exp = new Date(session.expires_at * 1000);
      console.log(`  ${theme.muted("Expires:")} ${theme.dim(exp.toLocaleString())}`);
    } else {
      console.log(`  ${theme.icons.warning}  ${theme.warning("Not logged in")}`);
      console.log(`\n  ${theme.muted("Run")} ${theme.secondary("nella auth login")} ${theme.muted("to authenticate")}`);
    }
    console.log("");
    return;
  }
}

async function runConnectCommand(args: CliArgs): Promise<void> {
  console.log(logo);
  console.log(tagline);

  if (args.showHelp) {
    console.log(`  ${theme.primary.bold("nella connect")} — Configure MCP clients to use Nella\n`);
    console.log(`  ${theme.primary.bold("Usage:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella connect")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella connect --api-key nella_your_key")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella connect --client claude")}\n`);
    console.log(`  ${theme.primary.bold("Options:")}\n`);
    console.log(`    ${theme.accent("--api-key, -k")} ${theme.muted("<key>")}       API key (auto-created if logged in)`);
    console.log(`    ${theme.accent("--server-url, -u")} ${theme.muted("<url>")}    Server URL (default: production)`);
    console.log(`    ${theme.accent("--client")} ${theme.muted("<name>")}            Target client: claude, vscode, cursor, or all (default: all)`);
    console.log("");
    return;
  }

  const serverUrl = args.serverUrl || "https://mcp.getnella.dev/mcp";
  let apiKey = args.apiKey || process.env.NELLA_API_KEY;
  const client = args.client || "all";

  // If no API key provided, try to auto-create one using stored session
  if (!apiKey) {
    const session = await getValidSession();
    if (session) {
      console.log(`  ${theme.icons.info}  Logged in as ${theme.secondary(session.user.email)}`);
      console.log(`  ${theme.muted("   Creating API key automatically...")}\n`);

      const keyName = `cli-${os.hostname()}-${new Date().toISOString().slice(0, 10)}`;
      const { apiKey: newKey, error } = await createApiKey(session, keyName);

      if (newKey) {
        apiKey = newKey;
        console.log(`  ${theme.icons.success}  API key created: ${theme.dim(newKey.substring(0, 15) + "...")}\n`);
      } else {
        console.log(`  ${theme.icons.error}  Failed to create key: ${error}`);
        console.log(`  ${theme.muted("   Pass one manually with --api-key")}\n`);
        process.exit(1);
      }
    } else {
      console.log(box([
        `${theme.icons.error}  ${theme.error.bold("No API key provided")}`,
        "",
        `  Either log in first, or pass a key directly:`,
        "",
        `  ${theme.muted("$")} ${theme.secondary("nella auth login")}`,
        `  ${theme.muted("$")} ${theme.secondary("nella connect")}`,
        "",
        `  ${theme.muted("— or —")}`,
        "",
        `  ${theme.muted("$")} ${theme.secondary("nella connect --api-key nella_your_key_here")}`,
        "",
        `  Get your API key at ${theme.secondary("https://app.getnella.dev/dashboard/api-keys")}`,
      ].join("\n"), "Setup"), "\n");
      process.exit(1);
    }
  }

  if (!apiKey.startsWith("nella_")) {
    console.log(`  ${theme.icons.error}  API key must start with ${theme.accent("nella_")}\n`);
    process.exit(1);
  }

  console.log(`  ${theme.icons.info}  ${theme.bold("Connecting to Nella MCP Server")}\n`);
  console.log(`  ${theme.muted("Server:")}  ${theme.secondary(serverUrl)}`);
  console.log(`  ${theme.muted("Key:")}     ${theme.dim(apiKey.substring(0, 15) + "..." + apiKey.slice(-4))}`);
  console.log("");

  // Verify the server is reachable
  try {
    const http = require("http");
    const https = require("https");
    const healthUrl = serverUrl.replace(/\/mcp$/, "/health");
    const mod = healthUrl.startsWith("https") ? https : http;

    const healthCheck = await new Promise<{ ok: boolean; version?: string }>((resolve) => {
      const req = mod.get(healthUrl, (res: { statusCode?: number; on: Function }) => {
        let data = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve({ ok: res.statusCode === 200, version: json.version });
          } catch {
            resolve({ ok: false });
          }
        });
      });
      req.on("error", () => resolve({ ok: false }));
      req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false }); });
    });

    if (healthCheck.ok) {
      console.log(`  ${theme.icons.success}  Server reachable ${theme.muted(`(v${healthCheck.version})`)}`);
    } else {
      console.log(`  ${theme.icons.warning}  Server unreachable — config will be written anyway`);
    }
  } catch {
    console.log(`  ${theme.icons.warning}  Could not verify server — config will be written anyway`);
  }

  console.log("");

  const results: { name: string; success: boolean; path: string; error?: string }[] = [];

  if (client === "claude" || client === "all") {
    const r = configureClaudeDesktop(serverUrl, apiKey);
    results.push({ name: "Claude Desktop", ...r });
  }

  if (client === "vscode" || client === "all") {
    const r = configureVsCode(serverUrl, apiKey);
    results.push({ name: "VS Code (Copilot)", ...r });
  }

  if (client === "cursor" || client === "all") {
    const r = configureCursor(serverUrl, apiKey);
    results.push({ name: "Cursor", ...r });
  }

  for (const r of results) {
    if (r.success) {
      console.log(`  ${theme.icons.success}  ${theme.success(r.name)} configured`);
      console.log(`     ${theme.muted(r.path)}`);
    } else {
      console.log(`  ${theme.icons.error}  ${theme.error(r.name)} failed: ${r.error}`);
      console.log(`     ${theme.muted(r.path)}`);
    }
  }

  console.log("");
  console.log(divider());

  const allSuccess = results.every((r) => r.success);
  if (allSuccess) {
    console.log(`\n  ${theme.icons.star}  ${theme.success.bold("All set!")} ${theme.muted("Restart your clients to connect.")}\n`);
  } else {
    console.log(`\n  ${theme.icons.warning}  ${theme.warning("Some clients failed to configure. Check paths above.")}\n`);
  }
}

// =============================================================================
// Setup Command — install Claude Code plugin
// =============================================================================

function runSetupCommand(): void {
  const pluginSrc = path.join(__dirname, "..", "claude-plugin");
  const claudeDir = path.join(os.homedir(), ".claude");
  const marketplacesDir = path.join(claudeDir, "plugins", "marketplaces");
  const nellaMarketplace = path.join(marketplacesDir, "nella");
  const pluginDest = path.join(nellaMarketplace, "plugins", "nella");
  const knownMarketplacesPath = path.join(claudeDir, "plugins", "known_marketplaces.json");

  if (!fs.existsSync(pluginSrc)) {
    console.log(`\n  ${theme.icons.error}  ${theme.error.bold("Plugin source not found.")} ${theme.muted("Try reinstalling @getnella/mcp.")}\n`);
    process.exit(1);
  }

  function copyDir(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  const isUpdate = fs.existsSync(pluginDest);
  copyDir(pluginSrc, pluginDest);

  // Register nella as a known marketplace so Claude Code discovers the plugin
  let knownMarketplaces: Record<string, unknown> = {};
  try {
    knownMarketplaces = JSON.parse(fs.readFileSync(knownMarketplacesPath, "utf-8"));
  } catch {}
  if (!knownMarketplaces["nella"]) {
    knownMarketplaces["nella"] = {
      source: { source: "local" },
      installLocation: nellaMarketplace,
      lastUpdated: new Date().toISOString(),
    };
    fs.writeFileSync(knownMarketplacesPath, JSON.stringify(knownMarketplaces, null, 2) + "\n");
  }

  // Clean up legacy plugin location (pre-v0.1.4)
  const legacyDest = path.join(claudeDir, "plugins", "nella");
  if (fs.existsSync(legacyDest) && fs.statSync(legacyDest).isDirectory()) {
    const legacyPlugin = path.join(legacyDest, ".claude-plugin");
    if (fs.existsSync(legacyPlugin)) {
      fs.rmSync(legacyDest, { recursive: true, force: true });
    }
  }

  console.log(logo);
  console.log(tagline);
  if (isUpdate) {
    console.log(`  ${theme.icons.success}  ${theme.success.bold("Plugin updated")} ${theme.muted("→")} ${theme.primary(pluginDest)}`);
  } else {
    console.log(`  ${theme.icons.success}  ${theme.success.bold("Plugin installed")} ${theme.muted("→")} ${theme.primary(pluginDest)}`);
  }
  console.log(`\n  ${theme.icons.arrow}  Restart Claude Code, then use ${theme.primary.bold("/nella")} to get started.\n`);
}

// =============================================================================
// Index Command — index workspace for search & code verification
// =============================================================================

async function runIndexCommand(args: CliArgs): Promise<void> {
  if (args.showHelp) {
    console.log(logo);
    console.log(tagline);
    console.log(`  ${theme.primary.bold("nella index")} — Index workspace for search & code verification\n`);
    console.log(`  ${theme.primary.bold("Usage:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella index [--workspace <path>] [--force]")}\n`);
    console.log(`  ${theme.primary.bold("Options:")}\n`);
    console.log(`    ${theme.accent("--workspace, -w")} ${theme.muted("<path>")}    Workspace path (default: cwd)`);
    console.log(`    ${theme.accent("--force, -f")}                    Force full reindex`);
    console.log("");
    return;
  }

  const workspacePath = path.resolve(args.workspace || process.cwd());
  const workspaceId = path.basename(workspacePath);
  const storagePath = path.join(workspacePath, ".nella", "index");

  console.log(logo);
  console.log(tagline);
  console.log(`  ${theme.icons.arrow}  Indexing ${theme.primary.bold(workspacePath)}\n`);

  if (args.force) {
    console.log(`  ${theme.muted("Mode: full reindex (--force)")}\n`);
  }

  const config: IndexManagerConfig = {
    workspaceId,
    workspacePath,
    storagePath,
    chunking: {
      maxTokens: 512,
      overlap: 50,
      strategy: "ast",
    },
    embedder: {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
    },
    search: {
      vectorWeight: 0.7,
      lexicalWeight: 0.3,
      rerankEnabled: false,
      topK: 10,
    },
    include: DEFAULT_INDEX_CONFIG.include,
    exclude: [...DEFAULT_INDEX_CONFIG.exclude, "**/.nella/**"],
  };

  const manager = createIndexManager(config);

  let lastProgressLine = "";
  manager.onEvent((event: IndexEvent) => {
    switch (event.type) {
      case "index:start":
        console.log(`  ${theme.icons.info}  Found ${theme.primary.bold(String(event.totalFiles))} files to process\n`);
        break;
      case "index:progress": {
        const pct = Math.round((event.processed / event.total) * 100);
        lastProgressLine = `  ${theme.muted(`[${pct}%]`)} ${theme.muted(event.currentFile)}`;
        process.stderr.write(`\r${lastProgressLine}${"".padEnd(20)}`);
        break;
      }
      case "index:embed":
        process.stderr.write("\r" + " ".repeat(80) + "\r");
        console.log(`  ${theme.icons.info}  Embedded batch of ${theme.primary(String(event.batchSize))} chunks ${theme.muted(`(${event.tokensUsed} tokens)`)}`);
        break;
      case "index:error":
        process.stderr.write("\r" + " ".repeat(80) + "\r");
        console.log(`  ${theme.icons.error}  ${theme.error(event.error)} ${event.filePath ? theme.muted(event.filePath) : ""}`);
        break;
      case "index:complete":
        process.stderr.write("\r" + " ".repeat(80) + "\r");
        break;
    }
  });

  try {
    const metadata = await manager.index({ force: args.force });
    const stats = metadata.stats;

    console.log("");
    console.log(box([
      `${theme.icons.success}  ${theme.success.bold("Index Complete")}`,
      "",
      `   Files indexed:    ${theme.primary.bold(String(stats.filesIndexed))}`,
      `   Chunks created:   ${theme.primary.bold(String(stats.chunksCount))}`,
      `   Embeddings:       ${theme.primary.bold(String(stats.embeddingsCount))}`,
      `   Tokens processed: ${theme.primary.bold(String(stats.totalTokens))}`,
      "",
      `   Storage: ${theme.muted(path.relative(workspacePath, storagePath) + "/")}`,
    ].join("\n"), "Index"));
    console.log("");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("");
    console.log(`  ${theme.icons.error}  ${theme.error.bold("Indexing failed")}`);
    console.log(`  ${theme.muted(message)}`);
    console.log("");
    process.exit(1);
  }
}

function showHelp(): void {
  console.log(logo);
  console.log(tagline);

  // Quick start
  console.log(`  ${theme.muted("Quick start:")} ${theme.primary("npx @getnella/mcp")} ${theme.muted("--workspace ./my-project")}`);
  console.log("");

  const tableChars = {
    "top": "", "top-mid": "", "top-left": "", "top-right": "",
    "bottom": "", "bottom-mid": "", "bottom-left": "", "bottom-right": "",
    "left": "    ", "left-mid": "", "mid": "", "mid-mid": "",
    "right": "", "right-mid": "", "middle": "  ",
  };
  const tableStyle = { "padding-left": 0, "padding-right": 2 };

  // Validation commands
  console.log(sectionHeader("Validation"));
  const valTable = new Table({ chars: tableChars, style: tableStyle });
  valTable.push(
    [theme.primary("check"), theme.muted("Pre-flight safety check — can the task proceed?")],
    [theme.primary("validate"), theme.muted("Validate changes against task constraints")],
    [theme.primary("run"), theme.muted("Full pipeline: check + validate + metrics")],
    [theme.primary("index"), theme.muted("Index workspace for search & code verification")],
  );
  console.log(valTable.toString());
  console.log("");

  // Server commands
  console.log(sectionHeader("Servers"));
  const srvTable = new Table({ chars: tableChars, style: tableStyle });
  srvTable.push(
    [theme.primary("mcp"), theme.muted("Start MCP server for AI agents (stdio)")],
    [theme.primary("serve"), theme.muted("Start hosted MCP server (HTTP)")],
    [theme.primary("playground"), theme.muted("Real-time debugging dashboard")],
  );
  console.log(srvTable.toString());
  console.log("");

  // Setup commands
  console.log(sectionHeader("Setup"));
  const setupTable = new Table({ chars: tableChars, style: tableStyle });
  setupTable.push(
    [theme.primary("setup"), theme.muted("Install /nella slash command in Claude Code")],
    [theme.primary("auth"), theme.muted("Login, logout, or check status")],
    [theme.primary("connect"), theme.muted("Configure Claude, VS Code & Cursor")],
    [theme.primary("help"), theme.muted("Show this help message")],
  );
  console.log(setupTable.toString());
  console.log("");

  // Options
  console.log(sectionHeader("Options"));
  const optTable = new Table({ chars: tableChars, style: tableStyle });
  optTable.push(
    [theme.accent("--task, -t"), theme.muted("<path>"), "Task YAML or directory"],
    [theme.accent("--repo, -r"), theme.muted("<path>"), "Repository path"],
    [theme.accent("--changes, -c"), theme.muted("<path>"), "Changes JSON file"],
    [theme.accent("--workspace, -w"), theme.muted("<path>"), "Workspace path (mcp/playground)"],
    [theme.accent("--port, -p"), theme.muted("<num>"), "Server port (default: 3847)"],
    [theme.accent("--host"), theme.muted("<host>"), "Server host (default: localhost)"],
    [theme.accent("--api-key, -k"), theme.muted("<key>"), "API key for connect"],
    [theme.accent("--server-url, -u"), theme.muted("<url>"), "Server URL for connect"],
    [theme.accent("--client"), theme.muted("<name>"), "claude, vscode, cursor, or all"],
    [theme.accent("--force, -f"), "", "Force full reindex"],
    [theme.accent("--skip-validation"), "", "Skip test/lint/compile"],
    [theme.accent("--skip-prerequisites"), "", "Skip prerequisite checks"],
    [theme.accent("--json"), "", "Output as JSON"],
    [theme.accent("--help, -h"), "", "Show help"],
  );
  console.log(optTable.toString());
  console.log("");

  // Footer
  console.log(divider());
  console.log(`\n  ${theme.muted("Docs")}  ${theme.secondary("https://getnella.dev/docs")}`);
  console.log(`  ${theme.muted("Repo")}  ${theme.secondary("https://github.com/nella-labs/nella")}`);
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
    case "index":
      await runIndexCommand(args);
      break;
    case "mcp":
      if (args.showHelp) {
        console.log(logo);
        console.log(tagline);
        console.log(`  ${theme.primary.bold("nella mcp")} — Start MCP server for AI agent integration (stdio)\n`);
        console.log(`  ${theme.primary.bold("Usage:")}\n`);
        console.log(`    ${theme.muted("$")} ${theme.primary("nella mcp [--workspace <path>]")}\n`);
        console.log(`  ${theme.primary.bold("Options:")}\n`);
        console.log(`    ${theme.accent("--workspace, -w")} ${theme.muted("<path>")}    Workspace path`);
        console.log("");
        break;
      }
      await startMcpServer({ workspace: args.workspace });
      break;
    case "serve":
      if (args.showHelp) {
        console.log(logo);
        console.log(tagline);
        console.log(`  ${theme.primary.bold("nella serve")} — Start hosted MCP server (HTTP)\n`);
        console.log(`  ${theme.primary.bold("Usage:")}\n`);
        console.log(`    ${theme.muted("$")} ${theme.primary("nella serve [--port <number>] [--host <host>]")}\n`);
        console.log(`  ${theme.primary.bold("Options:")}\n`);
        console.log(`    ${theme.accent("--port, -p")} ${theme.muted("<number>")}    Port (default: 3847)`);
        console.log(`    ${theme.accent("--host")} ${theme.muted("<host>")}           Host (default: localhost)`);
        console.log("");
        break;
      }
      await startHostedServer({ port: args.port, host: args.host });
      break;
    case "auth":
      await runAuthCommand(args);
      break;
    case "connect":
      await runConnectCommand(args);
      break;
    case "setup":
      runSetupCommand();
      break;
    case "playground":
      if (args.showHelp) {
        console.log(logo);
        console.log(tagline);
        console.log(`  ${theme.primary.bold("nella playground")} — Start playground server with real-time dashboard\n`);
        console.log(`  ${theme.primary.bold("Usage:")}\n`);
        console.log(`    ${theme.muted("$")} ${theme.primary("nella playground [--workspace <path>] [--repo <url>] [--port <number>] [--host <host>]")}\n`);
        console.log(`  ${theme.primary.bold("Options:")}\n`);
        console.log(`    ${theme.accent("--workspace, -w")} ${theme.muted("<path>")}      Workspace path`);
        console.log(`    ${theme.accent("--repo, -r")} ${theme.muted("<url|path>")}       Git repo URL or local path to use as workspace`);
        console.log(`    ${theme.accent("--port, -p")} ${theme.muted("<number>")}         Port (default: 3847)`);
        console.log(`    ${theme.accent("--host")} ${theme.muted("<host>")}               Host (default: localhost)`);
        console.log("");
        break;
      }
      await startPlaygroundServer({
        workspace: args.workspace,
        port: args.port,
        host: args.host,
        repo: args.repoPath,
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
