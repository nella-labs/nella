/**
 * Sync Manager
 *
 * Unified interface for managing sync across different backends.
 * Handles tier selection, fallback, and coordination.
 */

import type {
  SyncAdapter,
  SyncConfig,
  SyncTier,
  SyncStatus,
  CloudSyncOptions,
  CloudSyncStats,
  CloudSyncState,
  SyncManagerEvent,
  SyncManagerEventHandler,
  Workspace,
  IndexedFile,
  Chunk,
  SearchResult,
  CreateWorkspaceParams,
  UpsertFileParams,
  UpsertChunkParams,
  VectorSearchParams,
  TextSearchParams,
  HybridSearchParams,
} from "./types";
import { createLocalAdapter } from "./adapters/local";
import { createSupabaseAdapter } from "./adapters/supabase";
import { createGCPAdapter } from "./adapters/gcp";
import {
  createWorkspaceCloudSyncManager,
  type WorkspaceCloudSyncManager,
} from "./cloud";

// ============================================================================
// Sync Manager
// ============================================================================

export class SyncManager {
  private config: SyncConfig | null = null;
  private adapters: Map<SyncTier, SyncAdapter> = new Map();
  private primaryAdapter: SyncAdapter | null = null;
  private handlers: Set<SyncManagerEventHandler> = new Set();
  private lastSyncAt: Date | null = null;
  private cloudSyncManagers: Map<string, WorkspaceCloudSyncManager> = new Map();
  
  /**
   * Initialize the sync manager with configuration
   */
  async init(config: SyncConfig): Promise<void> {
    this.config = config;
    
    // Create adapter based on tier
    const adapter = this.createAdapter(config.tier);
    
    try {
      await adapter.init(config);
      this.adapters.set(config.tier, adapter);
      this.primaryAdapter = adapter;
      
      this.emit({ type: "connected", tier: config.tier });
    } catch (error) {
      // If primary tier fails, fall back to local
      if (config.tier !== "local") {
        console.warn(
          `Failed to initialize ${config.tier} adapter, falling back to local:`,
          error
        );
        
        const localAdapter = createLocalAdapter();
        await localAdapter.init({
          ...config,
          tier: "local",
          localPath: config.localPath || process.cwd(),
        });
        
        this.adapters.set("local", localAdapter);
        this.primaryAdapter = localAdapter;
        
        this.emit({ type: "connected", tier: "local" });
      } else {
        throw error;
      }
    }
  }
  
  /**
   * Get current status
   */
  getStatus(): SyncStatus {
    const tier = this.primaryAdapter?.tier || "local";
    const pendingChanges = Array.from(this.cloudSyncManagers.values()).reduce(
      (sum, manager) => sum + manager.getState().pending.length,
      0
    );
    
    return {
      tier,
      isConnected: this.primaryAdapter?.isReady() || false,
      lastSyncAt: this.lastSyncAt,
      pendingChanges,
    };
  }
  
  /**
   * Get the primary adapter
   */
  getAdapter(): SyncAdapter {
    if (!this.primaryAdapter) {
      throw new Error("SyncManager not initialized. Call init() first.");
    }
    return this.primaryAdapter;
  }
  
  /**
   * Get adapter by tier (if available)
   */
  getAdapterByTier(tier: SyncTier): SyncAdapter | null {
    return this.adapters.get(tier) || null;
  }
  
  /**
   * Check if a specific tier is available
   */
  isTierAvailable(tier: SyncTier): boolean {
    return this.adapters.has(tier) && this.adapters.get(tier)!.isReady();
  }
  
  /**
   * Disconnect all adapters
   */
  async disconnect(): Promise<void> {
    for (const manager of this.cloudSyncManagers.values()) {
      await manager.destroy();
    }
    this.cloudSyncManagers.clear();

    for (const [tier, adapter] of this.adapters) {
      await adapter.disconnect();
      this.emit({ type: "disconnected", tier });
    }
    
    this.adapters.clear();
    this.primaryAdapter = null;
    this.config = null;
  }
  
  /**
   * Subscribe to events
   */
  onEvent(handler: SyncManagerEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  
  private emit(event: SyncManagerEvent): void {
    this.handlers.forEach((h) => h(event));
  }
  
  private createAdapter(tier: SyncTier): SyncAdapter {
    switch (tier) {
      case "local":
        return createLocalAdapter();
      case "supabase":
        return createSupabaseAdapter();
      case "gcp":
        return createGCPAdapter();
      default:
        throw new Error(`Unknown sync tier: ${tier}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Cloud File Sync Operations
  // ---------------------------------------------------------------------------

  async createCloudSync(
    workspaceId: string,
    workspacePath: string,
    options: Partial<CloudSyncOptions> = {},
    orgId?: string,
    projectId?: string
  ): Promise<WorkspaceCloudSyncManager> {
    if (!this.config) {
      throw new Error("SyncManager not initialized. Call init() first.");
    }
    if (!this.config.cloudStorageConfig) {
      throw new Error("cloudStorageConfig is required to create cloud sync");
    }

    const existing = this.cloudSyncManagers.get(workspaceId);
    if (existing) {
      return existing;
    }

    const manager = createWorkspaceCloudSyncManager(
      workspaceId,
      workspacePath,
      this.config,
      options,
      undefined,
      orgId,
      projectId
    );
    manager.onEvent((event) => this.emit(event));
    await manager.init();
    this.cloudSyncManagers.set(workspaceId, manager);
    return manager;
  }

  async syncWorkspace(workspaceId: string): Promise<CloudSyncStats> {
    const manager = await this.getOrCreateCloudSync(workspaceId);
    const stats = await manager.sync();
    this.lastSyncAt = new Date();
    return stats;
  }

  async pushWorkspace(workspaceId: string): Promise<CloudSyncStats> {
    const manager = await this.getOrCreateCloudSync(workspaceId);
    const stats = await manager.push();
    this.lastSyncAt = new Date();
    return stats;
  }

  async pullWorkspace(workspaceId: string): Promise<CloudSyncStats> {
    const manager = await this.getOrCreateCloudSync(workspaceId);
    const stats = await manager.pull();
    this.lastSyncAt = new Date();
    return stats;
  }

  getCloudSyncState(workspaceId: string): CloudSyncState | null {
    const manager = this.cloudSyncManagers.get(workspaceId);
    return manager ? manager.getState() : null;
  }

  async resolveCloudConflict(
    workspaceId: string,
    conflictId: string,
    resolution: "local-wins" | "remote-wins"
  ): Promise<void> {
    const manager = await this.getOrCreateCloudSync(workspaceId);
    await manager.resolveConflict(conflictId, resolution);
  }

  private async getOrCreateCloudSync(
    workspaceId: string
  ): Promise<WorkspaceCloudSyncManager> {
    const existing = this.cloudSyncManagers.get(workspaceId);
    if (existing) {
      return existing;
    }
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    return await this.createCloudSync(
      workspaceId,
      workspace.rootPath,
      {},
      workspace.orgId,
      workspace.projectId
    );
  }
  
  // ---------------------------------------------------------------------------
  // Workspace Operations (delegated to primary adapter)
  // ---------------------------------------------------------------------------
  
  async createWorkspace(params: CreateWorkspaceParams): Promise<Workspace> {
    return this.getAdapter().createWorkspace(params);
  }
  
  async getWorkspace(id: string): Promise<Workspace | null> {
    return this.getAdapter().getWorkspace(id);
  }
  
  async getWorkspacesByUser(userId: string): Promise<Workspace[]> {
    return this.getAdapter().getWorkspacesByUser(userId);
  }
  
  async updateWorkspace(
    id: string,
    updates: Partial<Workspace>
  ): Promise<Workspace> {
    return this.getAdapter().updateWorkspace(id, updates);
  }
  
  async deleteWorkspace(id: string): Promise<void> {
    return this.getAdapter().deleteWorkspace(id);
  }
  
  // ---------------------------------------------------------------------------
  // File Operations (delegated to primary adapter)
  // ---------------------------------------------------------------------------
  
  async upsertFile(params: UpsertFileParams): Promise<IndexedFile> {
    return this.getAdapter().upsertFile(params);
  }
  
  async upsertFilesBatch(params: UpsertFileParams[]): Promise<number> {
    return this.getAdapter().upsertFilesBatch(params);
  }
  
  async getFile(id: string): Promise<IndexedFile | null> {
    return this.getAdapter().getFile(id);
  }
  
  async getFileByPath(
    workspaceId: string,
    relativePath: string
  ): Promise<IndexedFile | null> {
    return this.getAdapter().getFileByPath(workspaceId, relativePath);
  }
  
  async getWorkspaceFiles(workspaceId: string): Promise<IndexedFile[]> {
    return this.getAdapter().getWorkspaceFiles(workspaceId);
  }
  
  async deleteFile(id: string): Promise<void> {
    return this.getAdapter().deleteFile(id);
  }
  
  async deleteStaleFiles(
    workspaceId: string,
    validHashes: string[]
  ): Promise<number> {
    return this.getAdapter().deleteStaleFiles(workspaceId, validHashes);
  }
  
  // ---------------------------------------------------------------------------
  // Chunk Operations (delegated to primary adapter)
  // ---------------------------------------------------------------------------
  
  async upsertChunk(params: UpsertChunkParams): Promise<Chunk> {
    return this.getAdapter().upsertChunk(params);
  }
  
  async upsertChunksBatch(params: UpsertChunkParams[]): Promise<number> {
    return this.getAdapter().upsertChunksBatch(params);
  }
  
  async getChunk(id: string): Promise<Chunk | null> {
    return this.getAdapter().getChunk(id);
  }
  
  async getFileChunks(fileId: string): Promise<Chunk[]> {
    return this.getAdapter().getFileChunks(fileId);
  }
  
  async deleteChunksByFile(fileId: string): Promise<void> {
    return this.getAdapter().deleteChunksByFile(fileId);
  }
  
  async deleteChunksByWorkspace(workspaceId: string): Promise<void> {
    return this.getAdapter().deleteChunksByWorkspace(workspaceId);
  }
  
  // ---------------------------------------------------------------------------
  // Search Operations (with fallback)
  // ---------------------------------------------------------------------------
  
  async vectorSearch(params: VectorSearchParams): Promise<SearchResult[]> {
    // Try primary adapter first
    try {
      return await this.getAdapter().vectorSearch(params);
    } catch (error) {
      // Fall back to local if available
      const local = this.adapters.get("local");
      if (local && local !== this.primaryAdapter) {
        return local.vectorSearch(params);
      }
      throw error;
    }
  }
  
  async textSearch(params: TextSearchParams): Promise<SearchResult[]> {
    try {
      return await this.getAdapter().textSearch(params);
    } catch (error) {
      const local = this.adapters.get("local");
      if (local && local !== this.primaryAdapter) {
        return local.textSearch(params);
      }
      throw error;
    }
  }
  
  async hybridSearch(params: HybridSearchParams): Promise<SearchResult[]> {
    try {
      return await this.getAdapter().hybridSearch(params);
    } catch (error) {
      const local = this.adapters.get("local");
      if (local && local !== this.primaryAdapter) {
        return local.hybridSearch(params);
      }
      throw error;
    }
  }
  
  // ---------------------------------------------------------------------------
  // Multi-Tier Operations
  // ---------------------------------------------------------------------------
  
  /**
   * Sync data from one tier to another
   */
  async syncBetweenTiers(
    sourceTier: SyncTier,
    targetTier: SyncTier,
    workspaceId: string
  ): Promise<{ files: number; chunks: number }> {
    const source = this.adapters.get(sourceTier);
    const target = this.adapters.get(targetTier);
    
    if (!source || !target) {
      throw new Error(`Both tiers must be initialized for sync`);
    }
    
    this.emit({ type: "sync:start" });
    
    try {
      // Get workspace
      const workspace = await source.getWorkspace(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }
      
      // Sync workspace
      await target.createWorkspace({
        userId: workspace.userId,
        name: workspace.name,
        rootPath: workspace.rootPath,
        config: workspace.config,
      });
      
      // Sync files
      const files = await source.getWorkspaceFiles(workspaceId);
      let fileCount = 0;
      
      for (const file of files) {
        await target.upsertFile({
          workspaceId: file.workspaceId,
          relativePath: file.relativePath,
          language: file.language,
          sizeBytes: file.sizeBytes,
          hash: file.hash,
          content: file.content,
          metadata: file.metadata,
        });
        fileCount++;
      }
      
      // Sync chunks (if supported by both)
      let chunkCount = 0;
      
      for (const file of files) {
        try {
          const chunks = await source.getFileChunks(file.id);
          
          for (const chunk of chunks) {
            await target.upsertChunk({
              fileId: chunk.fileId,
              workspaceId: chunk.workspaceId,
              content: chunk.content,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              chunkType: chunk.chunkType,
              symbolName: chunk.symbolName,
              embedding: chunk.embedding,
              metadata: chunk.metadata,
            });
            chunkCount++;
          }
        } catch {
          // Source might not support chunks (e.g., Supabase)
        }
      }
      
      this.lastSyncAt = new Date();
      this.emit({ type: "sync:complete", changesCount: fileCount + chunkCount });
      
      return { files: fileCount, chunks: chunkCount };
    } catch (error) {
      this.emit({ type: "sync:error", error: error as Error });
      throw error;
    }
  }
  
  /**
   * Initialize multiple tiers for hybrid operation
   */
  async initMultipleTiers(configs: SyncConfig[]): Promise<void> {
    for (const config of configs) {
      const adapter = this.createAdapter(config.tier);
      
      try {
        await adapter.init(config);
        this.adapters.set(config.tier, adapter);
        this.emit({ type: "connected", tier: config.tier });
      } catch (error) {
        console.warn(`Failed to initialize ${config.tier} adapter:`, error);
      }
    }
    
    // Set primary adapter (prefer GCP > Supabase > Local)
    this.primaryAdapter =
      this.adapters.get("gcp") ||
      this.adapters.get("supabase") ||
      this.adapters.get("local") ||
      null;
    
    if (!this.primaryAdapter) {
      throw new Error("Failed to initialize any sync adapter");
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const syncManager = new SyncManager();

// ============================================================================
// Convenience Functions
// ============================================================================

export async function initSync(config: SyncConfig): Promise<void> {
  await syncManager.init(config);
}

export function getSyncStatus(): SyncStatus {
  return syncManager.getStatus();
}

export async function disconnectSync(): Promise<void> {
  await syncManager.disconnect();
}
