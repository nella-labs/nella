/**
 * Logger
 *
 * Structured JSONL logging for run records.
 */

import * as fs from "fs";
import * as path from "path";
import { LogEntry, LogEntryType } from "../types";

/**
 * Structured logger that writes JSONL to a file
 */
export class RunLogger {
  private logPath: string;
  private entries: LogEntry[] = [];

  constructor(runDir: string) {
    this.logPath = path.join(runDir, "logs.jsonl");
  }

  /**
   * Log an entry
   */
  log(type: LogEntryType, data: Record<string, unknown>): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      type,
      data,
    };

    this.entries.push(entry);

    // Append to file immediately (streaming)
    fs.appendFileSync(this.logPath, JSON.stringify(entry) + "\n");
  }

  /**
   * Log a plan declaration
   */
  logPlan(files: string[], summary: string): void {
    this.log("plan", { files, summary });
  }

  /**
   * Log a refusal decision
   */
  logRefusal(reason: string, patterns: string[]): void {
    this.log("refusal", { reason, patterns });
  }

  /**
   * Log a constraint check result
   */
  logConstraintCheck(id: string, passed: boolean, details?: string): void {
    this.log("constraint_check", { id, passed, details });
  }

  /**
   * Log a validation result
   */
  logValidation(
    type: "test" | "lint" | "compile",
    passed: boolean,
    exitCode: number
  ): void {
    this.log("validation", { type, passed, exitCode });
  }

  /**
   * Log scope check result
   */
  logScopeCheck(
    extraFiles: string[],
    missingFiles: string[],
    ratio: number
  ): void {
    this.log("scope_check", { extraFiles, missingFiles, scopeCreepRatio: ratio });
  }

  /**
   * Log final metrics
   */
  logMetrics(metrics: object): void {
    this.log("metrics", { ...metrics });
  }

  /**
   * Log an error
   */
  logError(error: string): void {
    this.log("error", { error });
  }

  /**
   * Get all entries
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }
}

/**
 * Generate a unique run ID
 * Format: YYYY-MM-DD_HHMMSS_XXXX (date_time_random4)
 */
export function generateRunId(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const time = now.toTimeString().split(" ")[0].replace(/:/g, "");
  const random = Math.random().toString(36).substring(2, 6);
  return `${date}_${time}_${random}`;
}
