/**
 * Context Module
 *
 * Provides stateful context tracking for coding agents.
 * Enables agents to remember changes and enforce consistency over time.
 */

export { SessionStore } from "./session-store";
export { DependencyTracker } from "./dependency-tracker";
export { AssumptionTracker } from "./assumption-tracker";
export { ChangeLedger } from "./change-ledger";

// Re-export context types
export type {
  Session,
  SessionMetadata,
  ChangeRecord,
  FileChangeHistory,
  Assumption,
  AssumptionType,
  AssumptionCheckResult,
  AssumptionConflict,
  DependencySnapshot,
  PackageInfo,
  DependencyChange,
  DependencyDiff,
  AgentContext,
  ContextStats,
} from "../types";

// =============================================================================
// Context Manager - High-level API
// =============================================================================

import { SessionStore } from "./session-store";
import { DependencyTracker } from "./dependency-tracker";
import { AssumptionTracker } from "./assumption-tracker";
import { ChangeLedger } from "./change-ledger";
import { AgentContext, ContextStats, DependencyDiff } from "../types";

/**
 * Context Manager - unified interface for all context tracking features
 */
export class ContextManager {
  public readonly session: SessionStore;
  public readonly dependencies: DependencyTracker;
  public readonly assumptions: AssumptionTracker;
  public readonly changes: ChangeLedger;

  constructor(repoPath: string) {
    this.session = new SessionStore(repoPath);
    this.dependencies = new DependencyTracker();
    this.assumptions = new AssumptionTracker(this.session);
    this.changes = new ChangeLedger(this.session);
  }

  /**
   * Get full context for the agent
   */
  getContext(recentChangesLimit: number = 20): AgentContext {
    const session = this.session.getSession();
    const recentChanges = this.changes.getRecentChanges(recentChangesLimit);
    const validAssumptions = this.assumptions.getValidAssumptions();
    const dependencies = this.session.getDependencySnapshot();
    const recentInvalidations = this.assumptions.getRecentlyInvalidated(10);

    const stats = this.getStats();

    return {
      session,
      recentChanges,
      validAssumptions,
      dependencies,
      recentInvalidations,
      stats,
    };
  }

  /**
   * Get context statistics
   */
  getStats(): ContextStats {
    const changeStats = this.changes.getStats();
    const assumptionSummary = this.assumptions.getSummary();
    const duration = this.session.getSessionDurationMinutes();
    const hotspots = this.session.getHotspotFiles(5);

    return {
      totalChanges: changeStats.totalChanges,
      hotspotFiles: hotspots,
      validAssumptionCount: assumptionSummary.valid,
      invalidatedAssumptionCount: assumptionSummary.invalidated,
      sessionDurationMinutes: duration,
    };
  }

  /**
   * Check for dependency changes and update snapshot
   */
  checkDependencies(repoPath: string): DependencyDiff | null {
    const previousSnapshot = this.session.getDependencySnapshot();
    const currentSnapshot = this.dependencies.takeSnapshot(repoPath);

    // Always update snapshot
    this.session.updateDependencySnapshot(currentSnapshot);
    this.session.save();

    if (!previousSnapshot) {
      // First snapshot, no diff
      return null;
    }

    const diff = this.dependencies.getDiff(
      previousSnapshot,
      currentSnapshot,
      this.assumptions.getValidAssumptions()
    );

    // Invalidate affected assumptions
    if (diff.affectedAssumptions.length > 0) {
      for (const assumption of diff.affectedAssumptions) {
        this.assumptions.invalidate(
          assumption.id,
          "dependency-check",
          `Dependency changes detected: ${this.dependencies.summarizeChanges(diff.changes)}`
        );
      }
    }

    return diff;
  }

  /**
   * Record changes from a run and check for invalidations
   */
  recordRunChanges(
    runId: string,
    changes: Array<{
      file: string;
      operation: "create" | "modify" | "delete";
      reason: string;
      content?: string;
    }>,
    checkInvalidations: boolean = true
  ): {
    recorded: number;
    invalidated: number;
  } {
    // Record all changes
    const recorded = this.changes.recordChanges(runId, changes);

    // Check for assumption invalidations
    let invalidated: number = 0;
    if (checkInvalidations) {
      const modifiedFiles = changes.map((c) => c.file);
      const invalidatedAssumptions = this.assumptions.checkInvalidations(
        modifiedFiles,
        runId
      );
      invalidated = invalidatedAssumptions.length;
    }

    // Increment run count
    this.session.incrementRunCount();

    // Save session
    this.session.save();

    return {
      recorded: recorded.length,
      invalidated,
    };
  }

  /**
   * Pre-flight check before applying changes
   * Returns warnings about potential conflicts
   */
  preflightCheck(plannedFiles: string[]): {
    conflicts: ReturnType<AssumptionTracker["getConflicts"]>;
    impactAnalysis: Map<string, ReturnType<ChangeLedger["analyzeImpact"]>>;
    dependencyDrift: boolean;
  } {
    // Check for assumption conflicts
    const conflicts = this.assumptions.getConflicts(plannedFiles);

    // Analyze impact for each planned file
    const impactAnalysis = new Map<
      string,
      ReturnType<ChangeLedger["analyzeImpact"]>
    >();
    for (const file of plannedFiles) {
      impactAnalysis.set(file, this.changes.analyzeImpact(file));
    }

    // Check for dependency drift (if we have a snapshot)
    const snapshot = this.session.getDependencySnapshot();
    let dependencyDrift = false;
    if (snapshot) {
      dependencyDrift = this.dependencies.hasChanged(
        this.session.getSession().repoPath,
        snapshot
      );
    }

    return {
      conflicts,
      impactAnalysis,
      dependencyDrift,
    };
  }

  /**
   * Save all pending changes
   */
  save(): void {
    this.session.save();
  }

  /**
   * Reset the session (start fresh)
   */
  reset(): void {
    this.session.reset();
  }

  /**
   * Get a summary suitable for logging
   */
  getSummary(): string {
    const stats = this.getStats();
    const changeSummary = this.changes.getSummary();
    const assumptionSummary = this.assumptions.getSummary();

    return [
      `Session: ${this.session.getSessionId()} (${stats.sessionDurationMinutes}min)`,
      changeSummary,
      `Assumptions: ${assumptionSummary.valid} valid, ${assumptionSummary.invalidated} invalidated`,
    ].join("\n");
  }
}
