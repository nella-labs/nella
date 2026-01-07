/**
 * JSONL Writer
 *
 * Appends task run results to results.jsonl
 */

import * as fs from "fs";
import * as path from "path";
import { TaskRun } from "../types";

/**
 * Append a task run to results.jsonl
 */
export function appendResult(outputDir: string, run: TaskRun): void {
  const resultsPath = path.join(outputDir, "results.jsonl");

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Convert Maps to objects for JSON serialization
  const serializable = {
    ...run,
    metrics: { ...run.metrics },
    validation: { ...run.validation },
  };

  const line = JSON.stringify(serializable) + "\n";

  fs.appendFileSync(resultsPath, line, "utf-8");
}

/**
 * Read all results from results.jsonl
 */
export function readResults(outputDir: string): TaskRun[] {
  const resultsPath = path.join(outputDir, "results.jsonl");

  if (!fs.existsSync(resultsPath)) {
    return [];
  }

  const content = fs.readFileSync(resultsPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  return lines.map((line) => JSON.parse(line) as TaskRun);
}

/**
 * Clear results file
 */
export function clearResults(outputDir: string): void {
  const resultsPath = path.join(outputDir, "results.jsonl");

  if (fs.existsSync(resultsPath)) {
    fs.unlinkSync(resultsPath);
  }
}
