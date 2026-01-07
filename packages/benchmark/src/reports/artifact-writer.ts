/**
 * Artifact Writer
 *
 * Saves per-task artifacts (diff.patch, logs.jsonl, metrics.json, etc.)
 */

import * as fs from "fs";
import * as path from "path";
import { TaskRun, RunArtifacts, LogEntry, Metrics, ValidationResults } from "../types";

export interface ArtifactWriterOptions {
  outputDir: string;
  agent: string;
  taskId: string;
}

/**
 * Write all artifacts for a task run
 */
export function writeArtifacts(
  options: ArtifactWriterOptions,
  artifacts: RunArtifacts,
  run: TaskRun
): void {
  const { outputDir, agent, taskId } = options;
  const taskDir = path.join(outputDir, agent, taskId);

  // Ensure directory exists
  fs.mkdirSync(taskDir, { recursive: true });

  // Write diff.patch
  fs.writeFileSync(path.join(taskDir, "diff.patch"), artifacts.diffPatch, "utf-8");

  // Write logs.jsonl
  const logsContent = artifacts.logs.map((log) => JSON.stringify(log)).join("\n");
  fs.writeFileSync(path.join(taskDir, "logs.jsonl"), logsContent, "utf-8");

  // Write commands.txt
  fs.writeFileSync(path.join(taskDir, "commands.txt"), artifacts.commands.join("\n"), "utf-8");

  // Write metrics.json
  fs.writeFileSync(path.join(taskDir, "metrics.json"), JSON.stringify(run.metrics, null, 2), "utf-8");

  // Write cost.json
  const costData = {
    tokensUsed: run.metrics.tokensUsed,
    estimatedCost: run.metrics.estimatedCost,
  };
  fs.writeFileSync(path.join(taskDir, "cost.json"), JSON.stringify(costData, null, 2), "utf-8");

  // Write validation outputs
  writeValidationOutputs(taskDir, run.validation);
}

/**
 * Write validation outputs to validation/ subdirectory
 */
function writeValidationOutputs(taskDir: string, validation: ValidationResults): void {
  const validationDir = path.join(taskDir, "validation");
  fs.mkdirSync(validationDir, { recursive: true });

  if (validation.testOutput) {
    fs.writeFileSync(path.join(validationDir, "test.txt"), validation.testOutput, "utf-8");
  }

  if (validation.lintOutput) {
    fs.writeFileSync(path.join(validationDir, "lint.txt"), validation.lintOutput, "utf-8");
  }

  if (validation.compileOutput) {
    fs.writeFileSync(path.join(validationDir, "compile.txt"), validation.compileOutput, "utf-8");
  }
}

/**
 * Create a log entry
 */
export function createLogEntry(
  type: LogEntry["type"],
  content: string
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    type,
    content,
  };
}

/**
 * Get the artifact directory path
 */
export function getArtifactDir(outputDir: string, agent: string, taskId: string): string {
  return path.join(outputDir, agent, taskId);
}
