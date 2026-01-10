#!/usr/bin/env node

/**
 * Nella CLI
 *
 * Commands:
 *   nella check   - Pre-flight check: can the task proceed?
 *   nella validate - Validate changes against task constraints
 *   nella run     - Full run: check + validate + metrics
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  runTask,
  check,
  Task,
  RawTaskYaml,
  Changes,
  FileChange,
} from "@nella-labs/core";

// =============================================================================
// Argument Parsing
// =============================================================================

interface CliArgs {
  command: "check" | "validate" | "run" | "help";
  taskPath?: string;
  repoPath?: string;
  changesPath?: string;
  skipValidation?: boolean;
  skipPrerequisites?: boolean;
  output?: "json" | "pretty";
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
    if (arg === "check" || arg === "validate" || arg === "run" || arg === "help") {
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
  return {
    id: raw.id,
    name: raw.name,
    prompt: raw.prompt,
    category: raw.category as Task["category"],
    difficulty: raw.difficulty as Task["difficulty"],
    fixture: raw.fixture,
    constraints: (raw.constraints ?? []).map((c) => ({
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

  if (result.passed !== undefined) {
    lines.push(result.passed ? "✅ PASSED" : "❌ FAILED");
    lines.push("");
  }

  if (result.refusal) {
    const refusal = result.refusal as { shouldRefuse: boolean; reason: string };
    if (refusal.shouldRefuse) {
      lines.push("🚫 REFUSAL");
      lines.push(`   Reason: ${refusal.reason}`);
      lines.push("");
    }
  }

  if (result.constraints) {
    const constraints = result.constraints as Array<{ id: string; passed: boolean; violationDetails?: string }>;
    if (constraints.length > 0) {
      lines.push("Constraints:");
      for (const c of constraints) {
        const icon = c.passed ? "✓" : "✗";
        lines.push(`  ${icon} ${c.id}${c.violationDetails ? `: ${c.violationDetails}` : ""}`);
      }
      lines.push("");
    }
  }

  if (result.validation) {
    const val = result.validation as {
      test?: { success: boolean };
      lint?: { success: boolean };
      compile?: { success: boolean };
    };
    lines.push("Validation:");
    if (val.test) lines.push(`  Test:    ${val.test.success ? "✓" : "✗"}`);
    if (val.lint) lines.push(`  Lint:    ${val.lint.success ? "✓" : "✗"}`);
    if (val.compile) lines.push(`  Compile: ${val.compile.success ? "✓" : "✗"}`);
    lines.push("");
  }

  if (result.scope) {
    const scope = result.scope as { scopeCreepRatio: number; extraFiles: string[] };
    lines.push(`Scope Creep: ${(scope.scopeCreepRatio * 100).toFixed(1)}%`);
    if (scope.extraFiles.length > 0) {
      lines.push(`  Extra files: ${scope.extraFiles.join(", ")}`);
    }
    lines.push("");
  }

  if (result.metrics) {
    const metrics = result.metrics as Record<string, unknown>;
    lines.push("Metrics:");
    lines.push(`  Scope Creep: ${metrics.scopeCreep}`);
    lines.push(`  Constraint Violations: ${metrics.constraintViolations}`);
    lines.push(`  Validation Integrity: ${metrics.validationIntegrity}`);
    if (metrics.refusalCorrectness !== null) {
      lines.push(`  Refusal Correctness: ${metrics.refusalCorrectness}`);
    }
  }

  if (result.artifacts) {
    const artifacts = result.artifacts as { runDir: string };
    lines.push("");
    lines.push(`Artifacts: ${artifacts.runDir}`);
  }

  return lines.join("\n");
}

// =============================================================================
// Commands
// =============================================================================

async function runCheckCommand(args: CliArgs): Promise<void> {
  if (!args.taskPath || !args.repoPath) {
    console.error("Error: --task and --repo are required for check command");
    process.exit(1);
  }

  const task = loadTask(args.taskPath);
  const repoPath = path.resolve(args.repoPath);

  const result = check(task, repoPath, {
    skipPrerequisites: args.skipPrerequisites,
  });

  if (args.output === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.shouldRefuse) {
      console.log("🚫 SHOULD REFUSE");
      console.log(`   Reason: ${result.reason}`);
      if (result.patternsMatched.length > 0) {
        console.log(`   Patterns: ${result.patternsMatched.join(", ")}`);
      }
      console.log(`   Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    } else {
      console.log("✅ OK TO PROCEED");
    }
  }

  process.exit(result.shouldRefuse ? 1 : 0);
}

async function runValidateCommand(args: CliArgs): Promise<void> {
  if (!args.taskPath || !args.repoPath || !args.changesPath) {
    console.error("Error: --task, --repo, and --changes are required for validate command");
    process.exit(1);
  }

  const task = loadTask(args.taskPath);
  const repoPath = path.resolve(args.repoPath);
  const changes = loadChanges(args.changesPath);

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
    console.error("Error: --task and --repo are required for run command");
    process.exit(1);
  }

  const task = loadTask(args.taskPath);
  const repoPath = path.resolve(args.repoPath);

  // Optionally load changes
  let changes: Changes | undefined;
  if (args.changesPath) {
    changes = loadChanges(args.changesPath);
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
  console.log(`
Nella CLI - Reliability layer for coding agents

USAGE:
  nella <command> [options]

COMMANDS:
  check      Pre-flight check: can the task proceed?
  validate   Validate changes against task constraints
  run        Full run: check + validate + metrics
  help       Show this help message

OPTIONS:
  --task, -t <path>       Path to task.yaml or task directory
  --repo, -r <path>       Path to repository
  --changes, -c <path>    Path to changes.json file
  --skip-validation       Skip running test/lint/compile commands
  --skip-prerequisites    Skip prerequisite checks
  --json                  Output as JSON
  --help, -h              Show help

EXAMPLES:
  # Check if a task can proceed
  nella check --task tasks/get-user-by-id --repo ./fixture

  # Validate changes
  nella validate --task tasks/get-user-by-id --repo ./fixture --changes changes.json

  # Full run with changes
  nella run --task tasks/get-user-by-id --repo ./fixture --changes changes.json

  # Full run without changes (just check + metrics)
  nella run --task tasks/get-user-by-id --repo ./fixture --json
`);
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
