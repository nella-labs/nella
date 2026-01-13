/**
 * Session Store
 *
 * Persistent storage for session state across agent runs.
 * Stores changes, assumptions, and dependency snapshots.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  Session,
  SessionMetadata,
  ChangeRecord,
  Assumption,
  DependencySnapshot,
} from "../types";

/**
 * Default session file location
 */
const SESSION_FILENAME = "session.json";
const NELLA_DIR = ".nella";

/**
 * Generate a unique ID
 */
function generateId(): string {
  return crypto.randomBytes(8).toString("hex");
}

/**
 * Generate a session ID with timestamp
 */
function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0].replace(/-/g, "");
  const random = crypto.randomBytes(4).toString("hex");
  return `session_${date}_${random}`;
}

/**
 * Session Store - manages persistent session state
 */
export class SessionStore {
  private session: Session;
  private storePath: string;
  private dirty: boolean = false;

  constructor(repoPath: string) {
    this.storePath = path.join(repoPath, NELLA_DIR, SESSION_FILENAME);
    this.session = this.load() ?? this.create(repoPath);
  }

  /**
   * Load session from disk
   */
  private load(): Session | null {
    try {
      if (fs.existsSync(this.storePath)) {
        const data = fs.readFileSync(this.storePath, "utf-8");
        return JSON.parse(data) as Session;
      }
    } catch (e) {
      // Corrupted or unreadable, start fresh
    }
    return null;
  }

  /**
   * Create a new session
   */
  private create(repoPath: string): Session {
    const now = new Date().toISOString();
    return {
      id: generateSessionId(),
      startedAt: now,
      repoPath,
      changes: [],
      assumptions: [],
      dependencySnapshot: null,
      metadata: {
        lastActivityAt: now,
        runCount: 0,
        totalFilesModified: 0,
      },
    };
  }

  /**
   * Save session to disk
   */
  save(): void {
    // Ensure directory exists
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.storePath, JSON.stringify(this.session, null, 2));
    this.dirty = false;
  }

  /**
   * Save if there are pending changes
   */
  saveIfDirty(): void {
    if (this.dirty) {
      this.save();
    }
  }

  /**
   * Get the current session
   */
  getSession(): Session {
    return this.session;
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.session.id;
  }

  // ===========================================================================
  // Change Management
  // ===========================================================================

  /**
   * Record a new change
   */
  recordChange(change: Omit<ChangeRecord, "id" | "timestamp">): ChangeRecord {
    const fullChange: ChangeRecord = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      ...change,
    };

    this.session.changes.push(fullChange);
    this.session.metadata.totalFilesModified++;
    this.updateActivity();
    this.dirty = true;

    return fullChange;
  }

  /**
   * Get all changes
   */
  getAllChanges(): ChangeRecord[] {
    return [...this.session.changes];
  }

  /**
   * Get recent changes (last N)
   */
  getRecentChanges(limit: number = 20): ChangeRecord[] {
    return this.session.changes.slice(-limit);
  }

  /**
   * Get changes for a specific file
   */
  getChangesForFile(file: string): ChangeRecord[] {
    const normalized = file.replace(/\\/g, "/");
    return this.session.changes.filter(
      (c) => c.file.replace(/\\/g, "/") === normalized
    );
  }

  /**
   * Get changes from a specific run
   */
  getChangesForRun(runId: string): ChangeRecord[] {
    return this.session.changes.filter((c) => c.runId === runId);
  }

  /**
   * Get files that have been modified
   */
  getModifiedFiles(): string[] {
    const files = new Set<string>();
    for (const change of this.session.changes) {
      files.add(change.file.replace(/\\/g, "/"));
    }
    return Array.from(files);
  }

  /**
   * Get hotspot files (most frequently changed)
   */
  getHotspotFiles(limit: number = 10): Array<{ file: string; changeCount: number }> {
    const counts = new Map<string, number>();
    for (const change of this.session.changes) {
      const file = change.file.replace(/\\/g, "/");
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([file, changeCount]) => ({ file, changeCount }))
      .sort((a, b) => b.changeCount - a.changeCount)
      .slice(0, limit);
  }

  // ===========================================================================
  // Assumption Management
  // ===========================================================================

  /**
   * Add a new assumption
   */
  addAssumption(
    assumption: Omit<Assumption, "id" | "createdAt" | "valid">
  ): Assumption {
    const full: Assumption = {
      id: generateId(),
      createdAt: new Date().toISOString(),
      valid: true,
      ...assumption,
    };

    this.session.assumptions.push(full);
    this.updateActivity();
    this.dirty = true;

    return full;
  }

  /**
   * Get all assumptions
   */
  getAllAssumptions(): Assumption[] {
    return [...this.session.assumptions];
  }

  /**
   * Get only valid assumptions
   */
  getValidAssumptions(): Assumption[] {
    return this.session.assumptions.filter((a) => a.valid);
  }

  /**
   * Get invalidated assumptions
   */
  getInvalidatedAssumptions(): Assumption[] {
    return this.session.assumptions.filter((a) => !a.valid);
  }

  /**
   * Get assumptions for specific files
   */
  getAssumptionsForFiles(files: string[]): Assumption[] {
    const normalizedFiles = files.map((f) => f.replace(/\\/g, "/"));
    return this.session.assumptions.filter((a) =>
      a.relatedFiles.some((f) =>
        normalizedFiles.includes(f.replace(/\\/g, "/"))
      )
    );
  }

  /**
   * Get assumption by ID
   */
  getAssumption(id: string): Assumption | undefined {
    return this.session.assumptions.find((a) => a.id === id);
  }

  /**
   * Invalidate an assumption
   */
  invalidateAssumption(
    id: string,
    runId: string,
    reason: string
  ): Assumption | null {
    const assumption = this.session.assumptions.find((a) => a.id === id);
    if (assumption && assumption.valid) {
      assumption.valid = false;
      assumption.invalidatedAt = new Date().toISOString();
      assumption.invalidatedBy = runId;
      assumption.invalidationReason = reason;
      this.dirty = true;
      return assumption;
    }
    return null;
  }

  /**
   * Revalidate an assumption (mark as valid again)
   */
  revalidateAssumption(id: string): Assumption | null {
    const assumption = this.session.assumptions.find((a) => a.id === id);
    if (assumption && !assumption.valid) {
      assumption.valid = true;
      assumption.invalidatedAt = undefined;
      assumption.invalidatedBy = undefined;
      assumption.invalidationReason = undefined;
      this.dirty = true;
      return assumption;
    }
    return null;
  }

  // ===========================================================================
  // Dependency Snapshot Management
  // ===========================================================================

  /**
   * Update dependency snapshot
   */
  updateDependencySnapshot(snapshot: DependencySnapshot): void {
    this.session.dependencySnapshot = snapshot;
    this.updateActivity();
    this.dirty = true;
  }

  /**
   * Get current dependency snapshot
   */
  getDependencySnapshot(): DependencySnapshot | null {
    return this.session.dependencySnapshot;
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Increment run count
   */
  incrementRunCount(): void {
    this.session.metadata.runCount++;
    this.updateActivity();
    this.dirty = true;
  }

  /**
   * Update last activity timestamp
   */
  private updateActivity(): void {
    this.session.metadata.lastActivityAt = new Date().toISOString();
  }

  /**
   * Get session metadata
   */
  getMetadata(): SessionMetadata {
    return { ...this.session.metadata };
  }

  /**
   * Get session duration in minutes
   */
  getSessionDurationMinutes(): number {
    const start = new Date(this.session.startedAt).getTime();
    const now = Date.now();
    return Math.round((now - start) / 1000 / 60);
  }

  /**
   * Clear all session data (start fresh)
   */
  reset(): void {
    this.session = this.create(this.session.repoPath);
    this.dirty = true;
    this.save();
  }

  /**
   * Check if session file exists
   */
  static exists(repoPath: string): boolean {
    const storePath = path.join(repoPath, NELLA_DIR, SESSION_FILENAME);
    return fs.existsSync(storePath);
  }

  /**
   * Delete session file
   */
  static delete(repoPath: string): boolean {
    const storePath = path.join(repoPath, NELLA_DIR, SESSION_FILENAME);
    if (fs.existsSync(storePath)) {
      fs.unlinkSync(storePath);
      return true;
    }
    return false;
  }
}
