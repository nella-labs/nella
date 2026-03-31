/**
 * Branch Index Manager
 *
 * Manages branch-aware indexing with a copy-on-write overlay model.
 * The default branch holds a full canonical index. Feature branches
 * store only chunks for files that differ from the parent. Search on
 * a feature branch composites the overlay on top of the parent.
 */

import * as fs from "fs";
import * as path from "path";
import type {
  IndexMetadata,
  SearchQuery,
  SearchResponse,
  SearchResult,
  IndexConfig,
} from "./types";
import { IndexManager, type IndexManagerConfig } from "./index";
import type { BranchIndexInfo } from "../workspace/types";
import * as git from "../utils/git";
import { saveBest, loadAny } from "./persistence";

// =============================================================================
// Types
// =============================================================================

export interface BranchIndexConfig {
  workspaceId: string;
  workspacePath: string;
  /** Base storage path: ~/.nella/workspaces/<id>/index */
  baseStoragePath: string;
  /** Default branch name (auto-detected if not provided) */
  defaultBranch?: string;
  /** Index config for creating new IndexManager instances */
  indexConfig: IndexConfig;
}

interface ParentRef {
  parentBranch: string;
  forkCommit: string;
  createdAt: string;
}

// =============================================================================
// Branch Index Manager
// =============================================================================

export class BranchIndexManager {
  private config: BranchIndexConfig;
  private defaultBranch: string;
  private managers: Map<string, IndexManager> = new Map();
  private branchInfo: Map<string, BranchIndexInfo> = new Map();

  constructor(config: BranchIndexConfig) {
    this.config = config;
    this.defaultBranch = config.defaultBranch || "main";
    this.loadBranchInfo();
  }

  // ===========================================================================
  // Branch Detection
  // ===========================================================================

  /**
   * Detect the current git branch from the workspace path.
   */
  async detectCurrentBranch(): Promise<string> {
    if (!(await git.isGitRepo(this.config.workspacePath))) {
      return this.defaultBranch;
    }
    return git.getCurrentBranch(this.config.workspacePath);
  }

  /**
   * Auto-detect and set the default branch if not configured.
   */
  async detectDefaultBranch(): Promise<string> {
    if (!(await git.isGitRepo(this.config.workspacePath))) {
      return this.defaultBranch;
    }
    this.defaultBranch = await git.getDefaultBranch(this.config.workspacePath);
    return this.defaultBranch;
  }

  // ===========================================================================
  // Index Access
  // ===========================================================================

  /**
   * Get or create an IndexManager for a specific branch.
   * Default branch gets a full index; feature branches get overlay storage.
   */
  getIndexForBranch(branch: string): IndexManager {
    const cached = this.managers.get(branch);
    if (cached) return cached;

    const storagePath = this.getBranchStoragePath(branch);
    const managerConfig: IndexManagerConfig = {
      ...this.config.indexConfig,
      workspaceId: this.config.workspaceId,
      workspacePath: this.config.workspacePath,
      storagePath,
    };

    const manager = new IndexManager(managerConfig);
    this.managers.set(branch, manager);
    return manager;
  }

  /**
   * Get the storage path for a branch's index.
   */
  private getBranchStoragePath(branch: string): string {
    if (this.isDefaultBranch(branch)) {
      return path.join(this.config.baseStoragePath, "main");
    }
    const sanitized = this.sanitizeBranchName(branch);
    return path.join(this.config.baseStoragePath, "branches", sanitized);
  }

  // ===========================================================================
  // Branch Index CRUD
  // ===========================================================================

  /**
   * Create a branch index overlay.
   * Records the fork point for incremental diffing.
   */
  async createBranchIndex(branch: string, parentBranch?: string): Promise<BranchIndexInfo> {
    const parent = parentBranch || this.defaultBranch;

    if (this.isDefaultBranch(branch)) {
      throw new Error(`Cannot create overlay for default branch '${branch}'`);
    }

    // Get fork point
    let forkCommit: string;
    try {
      forkCommit = await git.getForkPoint(this.config.workspacePath, branch, parent);
    } catch {
      // If fork point detection fails, use parent HEAD
      forkCommit = await git.getHeadCommit(this.config.workspacePath);
    }

    const headCommit = await git.getHeadCommit(this.config.workspacePath);

    // Create storage directory
    const storagePath = this.getBranchStoragePath(branch);
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }

    // Save parent reference
    const parentRef: ParentRef = {
      parentBranch: parent,
      forkCommit,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(storagePath, "parent-ref.json"),
      JSON.stringify(parentRef, null, 2),
    );

    const now = new Date().toISOString();
    const info: BranchIndexInfo = {
      name: branch,
      parentBranch: parent,
      forkPoint: forkCommit,
      headCommit,
      indexStatus: "none",
      stats: { filesIndexed: 0, chunksCount: 0, totalTokens: 0 },
      createdAt: now,
      updatedAt: now,
    };

    this.branchInfo.set(branch, info);
    this.saveBranchInfo();

    return info;
  }

  /**
   * Get files changed on a branch relative to its parent fork point.
   */
  async getChangedFiles(branch: string): Promise<git.FileChange[]> {
    const info = this.branchInfo.get(branch);
    if (!info) {
      throw new Error(`No branch index for '${branch}'. Create one first.`);
    }

    return git.getChangedFilesSinceFork(
      this.config.workspacePath,
      branch,
      info.forkPoint,
    );
  }

  /**
   * Index a branch. For the default branch, does a full index.
   * For feature branches, only indexes files changed since fork point.
   */
  async indexBranch(
    branch: string,
    options: { force?: boolean; paths?: string[]; exclude?: string[] } = {},
  ): Promise<IndexMetadata> {
    const manager = this.getIndexForBranch(branch);

    if (this.isDefaultBranch(branch)) {
      // Full index for default branch
      const info = this.branchInfo.get(branch);
      if (info) {
        info.indexStatus = "indexing";
        info.updatedAt = new Date().toISOString();
        this.saveBranchInfo();
      }

      const metadata = await manager.index(options);

      if (info) {
        info.indexStatus = "ready";
        info.headCommit = await git.getHeadCommit(this.config.workspacePath).catch(() => "unknown");
        info.stats = {
          filesIndexed: metadata.stats.filesIndexed,
          chunksCount: metadata.stats.chunksCount,
          totalTokens: metadata.stats.totalTokens,
        };
        info.updatedAt = new Date().toISOString();
        this.saveBranchInfo();
      }

      return metadata;
    }

    // Feature branch: only index changed files
    let info = this.branchInfo.get(branch);
    if (!info) {
      info = await this.createBranchIndex(branch);
    }

    info.indexStatus = "indexing";
    info.updatedAt = new Date().toISOString();
    this.saveBranchInfo();

    let filesToIndex = options.paths;
    if (!filesToIndex) {
      const changes = await this.getChangedFiles(branch);
      filesToIndex = changes
        .filter((c) => c.status !== "D")
        .map((c) => path.resolve(this.config.workspacePath, c.path));
    }

    const metadata = await manager.index({
      ...options,
      paths: filesToIndex,
    });

    // Update metadata with branch info
    metadata.branchId = branch;
    metadata.parentBranchId = info.parentBranch;
    metadata.forkCommit = info.forkPoint;

    info.indexStatus = "ready";
    info.headCommit = await git.getHeadCommit(this.config.workspacePath).catch(() => "unknown");
    info.stats = {
      filesIndexed: metadata.stats.filesIndexed,
      chunksCount: metadata.stats.chunksCount,
      totalTokens: metadata.stats.totalTokens,
    };
    info.updatedAt = new Date().toISOString();
    this.saveBranchInfo();

    return metadata;
  }

  /**
   * Search a branch index with overlay composition.
   *
   * For the default branch, searches directly.
   * For feature branches, searches the overlay first, then fills in from parent.
   * Overlay results replace parent results for the same file paths.
   */
  async searchBranch(branch: string, query: SearchQuery): Promise<SearchResponse> {
    if (this.isDefaultBranch(branch)) {
      const manager = this.getIndexForBranch(branch);
      return manager.search(query);
    }

    const info = this.branchInfo.get(branch);
    if (!info) {
      // No branch index — fall through to parent
      return this.searchBranch(this.defaultBranch, query);
    }

    // Get overlay results
    const overlayManager = this.getIndexForBranch(branch);
    const overlayStatus = overlayManager.getStatus();

    // Get parent results
    const parentManager = this.getIndexForBranch(info.parentBranch);
    const parentResponse = await parentManager.search(query);

    if (!overlayStatus.ready) {
      // Overlay not indexed yet — return parent results only
      return parentResponse;
    }

    const overlayResponse = await overlayManager.search(query);

    // Composite: overlay results take priority for same file paths
    return this.compositeSearchResults(overlayResponse, parentResponse, query);
  }

  /**
   * Merge a branch index back into its parent (typically main).
   * Re-indexes the parent for all files that changed on the branch.
   */
  async mergeBranchIndex(sourceBranch: string, targetBranch?: string): Promise<void> {
    const target = targetBranch || this.defaultBranch;
    const info = this.branchInfo.get(sourceBranch);
    if (!info) {
      throw new Error(`No branch index for '${sourceBranch}'`);
    }

    // Get files that were changed on the source branch
    const sourceManager = this.getIndexForBranch(sourceBranch);
    const sourceChunks = sourceManager.getAllChunks();
    const changedFiles = [...new Set(sourceChunks.map((c) => c.filePath))];

    if (changedFiles.length > 0) {
      // Re-index the target branch for these files
      const targetManager = this.getIndexForBranch(target);
      await targetManager.index({ paths: changedFiles });
    }
  }

  /**
   * Delete a branch index and clean up storage.
   */
  async deleteBranchIndex(branch: string): Promise<void> {
    if (this.isDefaultBranch(branch)) {
      throw new Error(`Cannot delete default branch index '${branch}'`);
    }

    // Remove from managers cache
    this.managers.delete(branch);

    // Remove from branch info
    this.branchInfo.delete(branch);
    this.saveBranchInfo();

    // Remove storage directory
    const storagePath = this.getBranchStoragePath(branch);
    if (fs.existsSync(storagePath)) {
      fs.rmSync(storagePath, { recursive: true, force: true });
    }
  }

  // ===========================================================================
  // Branch Info
  // ===========================================================================

  /**
   * List all branch indexes.
   */
  listBranches(): BranchIndexInfo[] {
    return Array.from(this.branchInfo.values());
  }

  /**
   * Get info for a specific branch.
   */
  getBranchInfo(branch: string): BranchIndexInfo | null {
    return this.branchInfo.get(branch) || null;
  }

  /**
   * Check if a branch has an index (overlay or full).
   */
  hasBranchIndex(branch: string): boolean {
    if (this.isDefaultBranch(branch)) {
      const manager = this.getIndexForBranch(branch);
      return manager.getStatus().ready;
    }
    return this.branchInfo.has(branch);
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  private isDefaultBranch(branch: string): boolean {
    return branch === this.defaultBranch || branch === "main" || branch === "master";
  }

  private sanitizeBranchName(branch: string): string {
    return branch.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  /**
   * Composite overlay and parent search results.
   * Overlay results replace parent results for the same file paths.
   * Results are re-sorted by combined score.
   */
  private compositeSearchResults(
    overlay: SearchResponse,
    parent: SearchResponse,
    query: SearchQuery,
  ): SearchResponse {
    // Collect file paths from overlay
    const overlayFilePaths = new Set(
      overlay.results.map((r) => r.chunk.filePath),
    );

    // Filter parent results to exclude files covered by overlay
    const filteredParent = parent.results.filter(
      (r) => !overlayFilePaths.has(r.chunk.filePath),
    );

    // Combine and sort by score
    const combined = [...overlay.results, ...filteredParent]
      .sort((a, b) => b.score - a.score);

    const limit = query.limit || 10;

    return {
      results: combined.slice(0, limit),
      query: query.query,
      totalMatches: combined.length,
      searchTime: overlay.searchTime + parent.searchTime,
      tokensUsed: overlay.tokensUsed + parent.tokensUsed,
      cost: overlay.cost + parent.cost,
      confidence: Math.max(overlay.confidence, parent.confidence),
      suggestion: combined.length > 0
        ? (overlay.suggestion === "use_results" || parent.suggestion === "use_results"
          ? "use_results"
          : overlay.suggestion)
        : "no_matches",
    };
  }

  /**
   * Load branch info from the base storage path.
   */
  private loadBranchInfo(): void {
    const infoPath = path.join(this.config.baseStoragePath, "branch-info.json");
    const result = loadAny<Record<string, BranchIndexInfo>>(infoPath);
    if (result) {
      for (const [name, info] of Object.entries(result.data)) {
        this.branchInfo.set(name, info);
      }
    }

    // Ensure default branch info exists
    if (!this.branchInfo.has(this.defaultBranch)) {
      const defaultPath = this.getBranchStoragePath(this.defaultBranch);
      const hasExistingIndex = fs.existsSync(path.join(defaultPath, "metadata.json"));

      this.branchInfo.set(this.defaultBranch, {
        name: this.defaultBranch,
        parentBranch: this.defaultBranch,
        forkPoint: "",
        headCommit: "",
        indexStatus: hasExistingIndex ? "ready" : "none",
        stats: { filesIndexed: 0, chunksCount: 0, totalTokens: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Save branch info to disk.
   */
  private saveBranchInfo(): void {
    const infoPath = path.join(this.config.baseStoragePath, "branch-info.json");
    const dir = path.dirname(infoPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data: Record<string, BranchIndexInfo> = {};
    for (const [name, info] of this.branchInfo) {
      data[name] = info;
    }
    saveBest(infoPath, data, { forceJson: true, prettyJson: true });
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createBranchIndexManager(config: BranchIndexConfig): BranchIndexManager {
  return new BranchIndexManager(config);
}
