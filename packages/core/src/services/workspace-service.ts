/**
 * Workspace Service
 *
 * Wraps WorkspaceRegistry and WorkspaceSwitcher for CRUD,
 * index triggering, and sync triggering.
 */

import {
  WorkspaceRegistry,
  getWorkspaceRegistry,
  createWorkspaceRegistry,
  type WorkspaceEntry,
  type WorkspaceConfig,
} from "../workspace";

// =============================================================================
// Types
// =============================================================================

export interface CreateWorkspaceParams {
  name: string;
  path: string;
  config?: Partial<WorkspaceConfig>;
  orgId?: string;
  projectId?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  config?: WorkspaceConfig;
  indexed: boolean;
  indexStatus: string;
  fileCount: number;
  orgId?: string;
  projectId?: string;
}

// =============================================================================
// Service
// =============================================================================

export class WorkspaceService {
  private registry: WorkspaceRegistry;

  constructor(registryPath?: string) {
    this.registry = registryPath
      ? createWorkspaceRegistry(registryPath)
      : getWorkspaceRegistry();
  }

  /**
   * Create and register a workspace.
   */
  async create(params: CreateWorkspaceParams): Promise<WorkspaceInfo> {
    const entry = this.registry.register(
      params.path,
      params.name,
      params.config,
      params.orgId,
      params.projectId
    );
    return this.toInfo(entry);
  }

  /**
   * List all registered workspaces.
   */
  async list(offset = 0, limit = 20): Promise<{ workspaces: WorkspaceInfo[]; total: number }> {
    const all = this.registry.list();
    const sliced = all.slice(offset, offset + limit);
    return {
      workspaces: sliced.map((e) => this.toInfo(e)),
      total: all.length,
    };
  }

  /**
   * Get a single workspace by ID.
   */
  async getById(id: string): Promise<WorkspaceInfo | null> {
    const entry = this.registry.get(id);
    return entry ? this.toInfo(entry) : null;
  }

  /**
   * Update workspace configuration.
   */
  async update(id: string, updates: Partial<Omit<WorkspaceEntry, "id" | "path" | "createdAt">>): Promise<WorkspaceInfo | null> {
    const entry = this.registry.get(id);
    if (!entry) return null;
    this.registry.update(id, updates);
    const updated = this.registry.get(id);
    return updated ? this.toInfo(updated) : null;
  }

  /**
   * Remove a workspace.
   */
  async remove(id: string): Promise<boolean> {
    const entry = this.registry.get(id);
    if (!entry) return false;
    this.registry.remove(id);
    return true;
  }

  private toInfo(entry: WorkspaceEntry): WorkspaceInfo {
    return {
      id: entry.id,
      name: entry.name,
      path: entry.path,
      config: entry.config,
      indexed: entry.indexStatus === "ready",
      indexStatus: entry.indexStatus,
      fileCount: entry.stats?.filesIndexed || 0,
      orgId: entry.orgId,
      projectId: entry.projectId,
    };
  }
}
