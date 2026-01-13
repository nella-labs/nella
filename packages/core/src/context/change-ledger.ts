/**
 * Change Ledger
 *
 * Provides higher-level analysis of change history.
 * Tracks patterns, dependencies between changes, and change impact.
 */

import * as crypto from "crypto";
import {
  ChangeRecord,
  FileChangeHistory,
  Assumption,
} from "../types";
import { SessionStore } from "./session-store";

/**
 * Normalize file path for comparison
 */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * Compute content hash
 */
function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Change Ledger - analyzes and queries change history
 */
export class ChangeLedger {
  constructor(private session: SessionStore) {}

  /**
   * Record a change with full context
   */
  recordChange(
    runId: string,
    file: string,
    operation: "create" | "modify" | "delete",
    reason: string,
    options: {
      dependsOn?: string[];
      assumptionIds?: string[];
      content?: string;
    } = {}
  ): ChangeRecord {
    return this.session.recordChange({
      runId,
      file: normalizePath(file),
      operation,
      reason,
      dependsOn: (options.dependsOn ?? []).map(normalizePath),
      assumptionIds: options.assumptionIds ?? [],
      contentHash: options.content ? hashContent(options.content) : undefined,
    });
  }

  /**
   * Record multiple changes from a run
   */
  recordChanges(
    runId: string,
    changes: Array<{
      file: string;
      operation: "create" | "modify" | "delete";
      reason: string;
      content?: string;
    }>
  ): ChangeRecord[] {
    return changes.map((change) =>
      this.recordChange(runId, change.file, change.operation, change.reason, {
        content: change.content,
      })
    );
  }

  /**
   * Get complete history for a file
   */
  getFileHistory(file: string): FileChangeHistory {
    const normalized = normalizePath(file);
    const changes = this.session.getChangesForFile(normalized);

    // Determine current state based on last change
    let currentState: "exists" | "deleted" | "unknown" = "unknown";
    let lastModifiedAt: string | null = null;

    if (changes.length > 0) {
      const lastChange = changes[changes.length - 1];
      lastModifiedAt = lastChange.timestamp;
      currentState = lastChange.operation === "delete" ? "deleted" : "exists";
    }

    return {
      file: normalized,
      changes,
      currentState,
      lastModifiedAt,
    };
  }

  /**
   * Get all changes in chronological order
   */
  getAllChanges(): ChangeRecord[] {
    return this.session.getAllChanges();
  }

  /**
   * Get recent changes
   */
  getRecentChanges(limit: number = 20): ChangeRecord[] {
    return this.session.getRecentChanges(limit);
  }

  /**
   * Get changes from a specific run
   */
  getRunChanges(runId: string): ChangeRecord[] {
    return this.session.getChangesForRun(runId);
  }

  /**
   * Get files that have been modified in the session
   */
  getModifiedFiles(): string[] {
    return this.session.getModifiedFiles();
  }

  /**
   * Get hotspot files (most frequently changed)
   */
  getHotspotFiles(limit: number = 10): Array<{ file: string; changeCount: number }> {
    return this.session.getHotspotFiles(limit);
  }

  /**
   * Get files that depend on a specific file
   */
  getDependents(file: string): string[] {
    const normalized = normalizePath(file);
    const dependents = new Set<string>();

    for (const change of this.getAllChanges()) {
      if (change.dependsOn.includes(normalized)) {
        dependents.add(change.file);
      }
    }

    return Array.from(dependents);
  }

  /**
   * Get the dependency chain for a file (files it depends on)
   */
  getDependencies(file: string): string[] {
    const normalized = normalizePath(file);
    const changes = this.session.getChangesForFile(normalized);
    const dependencies = new Set<string>();

    for (const change of changes) {
      for (const dep of change.dependsOn) {
        dependencies.add(dep);
      }
    }

    return Array.from(dependencies);
  }

  /**
   * Analyze the impact of modifying a file
   * Returns files that might be affected based on recorded dependencies
   */
  analyzeImpact(file: string): {
    directDependents: string[];
    transitiveDependents: string[];
    relatedAssumptions: Assumption[];
  } {
    const normalized = normalizePath(file);
    const directDependents = this.getDependents(normalized);

    // Get transitive dependents (files that depend on our direct dependents)
    const transitiveDependents = new Set<string>();
    const visited = new Set<string>([normalized]);

    const queue = [...directDependents];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const deps = this.getDependents(current);
      for (const dep of deps) {
        if (!visited.has(dep)) {
          transitiveDependents.add(dep);
          queue.push(dep);
        }
      }
    }

    // Remove direct dependents from transitive
    for (const dep of directDependents) {
      transitiveDependents.delete(dep);
    }

    // Get related assumptions
    const relatedAssumptions = this.session.getAssumptionsForFiles([normalized]);

    return {
      directDependents,
      transitiveDependents: Array.from(transitiveDependents),
      relatedAssumptions,
    };
  }

  /**
   * Get changes grouped by file
   */
  getChangesByFile(): Map<string, ChangeRecord[]> {
    const byFile = new Map<string, ChangeRecord[]>();

    for (const change of this.getAllChanges()) {
      const existing = byFile.get(change.file) ?? [];
      existing.push(change);
      byFile.set(change.file, existing);
    }

    return byFile;
  }

  /**
   * Get changes grouped by run
   */
  getChangesByRun(): Map<string, ChangeRecord[]> {
    const byRun = new Map<string, ChangeRecord[]>();

    for (const change of this.getAllChanges()) {
      const existing = byRun.get(change.runId) ?? [];
      existing.push(change);
      byRun.set(change.runId, existing);
    }

    return byRun;
  }

  /**
   * Get change statistics
   */
  getStats(): {
    totalChanges: number;
    uniqueFiles: number;
    uniqueRuns: number;
    byOperation: Record<string, number>;
    avgChangesPerRun: number;
  } {
    const changes = this.getAllChanges();
    const files = new Set(changes.map((c) => c.file));
    const runs = new Set(changes.map((c) => c.runId));

    const byOperation: Record<string, number> = {
      create: 0,
      modify: 0,
      delete: 0,
    };

    for (const change of changes) {
      byOperation[change.operation]++;
    }

    return {
      totalChanges: changes.length,
      uniqueFiles: files.size,
      uniqueRuns: runs.size,
      byOperation,
      avgChangesPerRun: runs.size > 0 ? changes.length / runs.size : 0,
    };
  }

  /**
   * Find changes by reason (search in reason text)
   */
  searchByReason(query: string): ChangeRecord[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllChanges().filter((c) =>
      c.reason.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Find changes within a time range
   */
  getChangesInRange(startTime: Date, endTime: Date): ChangeRecord[] {
    const start = startTime.getTime();
    const end = endTime.getTime();

    return this.getAllChanges().filter((c) => {
      const time = new Date(c.timestamp).getTime();
      return time >= start && time <= end;
    });
  }

  /**
   * Get the last change to a file
   */
  getLastChange(file: string): ChangeRecord | null {
    const history = this.getFileHistory(file);
    return history.changes.length > 0
      ? history.changes[history.changes.length - 1]
      : null;
  }

  /**
   * Check if a file was modified in the current session
   */
  wasModified(file: string): boolean {
    return this.session.getChangesForFile(file).length > 0;
  }

  /**
   * Check if a file was deleted
   */
  wasDeleted(file: string): boolean {
    const history = this.getFileHistory(file);
    return history.currentState === "deleted";
  }

  /**
   * Get timeline of all changes (for visualization)
   */
  getTimeline(): Array<{
    timestamp: string;
    runId: string;
    changes: ChangeRecord[];
  }> {
    const byRun = this.getChangesByRun();
    const timeline: Array<{
      timestamp: string;
      runId: string;
      changes: ChangeRecord[];
    }> = [];

    for (const [runId, changes] of byRun) {
      if (changes.length > 0) {
        timeline.push({
          timestamp: changes[0].timestamp,
          runId,
          changes,
        });
      }
    }

    // Sort by timestamp
    timeline.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return timeline;
  }

  /**
   * Generate a summary of recent activity
   */
  getSummary(): string {
    const stats = this.getStats();
    const hotspots = this.getHotspotFiles(3);
    const recent = this.getRecentChanges(5);

    const lines: string[] = [
      `Total changes: ${stats.totalChanges} across ${stats.uniqueFiles} files in ${stats.uniqueRuns} runs`,
      `Operations: ${stats.byOperation.create} creates, ${stats.byOperation.modify} modifies, ${stats.byOperation.delete} deletes`,
    ];

    if (hotspots.length > 0) {
      lines.push(
        `Hotspots: ${hotspots.map((h) => `${h.file} (${h.changeCount})`).join(", ")}`
      );
    }

    if (recent.length > 0) {
      lines.push(`Recent: ${recent.map((r) => r.file).join(", ")}`);
    }

    return lines.join("\n");
  }
}
