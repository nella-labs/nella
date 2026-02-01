/**
 * Supabase Sync Adapter
 *
 * Uses Supabase for:
 * - Auth
 * - API keys & agents storage
 * - Context sync (realtime)
 *
 * Note: Embeddings/chunks are NOT stored in Supabase.
 * Use GCP adapter for embeddings at scale.
 */

import type {
  SyncAdapter,
  SyncConfig,
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
  SyncEvent,
} from "../types";
import {
  initSupabase,
  getSupabaseClient,
  isSupabaseInitialized,
  disconnectSupabase,
} from "../../supabase/client";
import { subscribeToContext } from "../../supabase/realtime";

// ============================================================================
// Supabase Sync Adapter
// ============================================================================

export class SupabaseSyncAdapter implements SyncAdapter {
  readonly tier = "supabase" as const;
  
  private ready = false;
  
  async init(config: SyncConfig): Promise<void> {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error(
        "supabaseUrl and supabaseAnonKey are required for SupabaseSyncAdapter"
      );
    }
    
    await initSupabase({
      url: config.supabaseUrl,
      anonKey: config.supabaseAnonKey,
    });
    
    this.ready = true;
  }
  
  isReady(): boolean {
    return this.ready && isSupabaseInitialized();
  }
  
  async disconnect(): Promise<void> {
    await disconnectSupabase();
    this.ready = false;
  }
  
  // ---------------------------------------------------------------------------
  // Workspace Operations
  // ---------------------------------------------------------------------------
  
  async createWorkspace(params: CreateWorkspaceParams): Promise<Workspace> {
    const client = getSupabaseClient();
    const id = crypto.randomUUID();
    const now = new Date();
    
    const workspace: Workspace = {
      id,
      userId: params.userId,
      name: params.name,
      rootPath: params.rootPath,
      config: {
        includePatterns: params.config?.includePatterns || ["**/*"],
        excludePatterns: params.config?.excludePatterns || [
          "**/node_modules/**",
          "**/.git/**",
        ],
        maxFileSize: params.config?.maxFileSize || 1024 * 1024,
        indexOptions: {
          useAst: params.config?.indexOptions?.useAst ?? true,
          useStemming: params.config?.indexOptions?.useStemming ?? true,
          useHnsw: params.config?.indexOptions?.useHnsw ?? true,
          chunkSize: params.config?.indexOptions?.chunkSize || 512,
          chunkOverlap: params.config?.indexOptions?.chunkOverlap || 64,
        },
      },
      stats: {
        fileCount: 0,
        chunkCount: 0,
        totalSizeBytes: 0,
        indexTimeMs: 0,
      },
      createdAt: now,
      updatedAt: now,
      lastIndexedAt: null,
    };
    
    // Store workspace metadata using raw REST API to avoid type issues
    const response = await fetch(
      `${(client as unknown as { supabaseUrl: string }).supabaseUrl}/rest/v1/context`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": (client as unknown as { supabaseKey: string }).supabaseKey,
          "Authorization": `Bearer ${(client as unknown as { supabaseKey: string }).supabaseKey}`,
        },
        body: JSON.stringify({
          id,
          user_id: params.userId,
          workspace_id: id,
          key: "workspace",
          value: workspace,
        }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to create workspace: ${await response.text()}`);
    }
    
    return workspace;
  }
  
  async getWorkspace(id: string): Promise<Workspace | null> {
    const client = getSupabaseClient();
    
    const response = await fetch(
      `${(client as unknown as { supabaseUrl: string }).supabaseUrl}/rest/v1/context?workspace_id=eq.${id}&key=eq.workspace&select=value`,
      {
        headers: {
          "apikey": (client as unknown as { supabaseKey: string }).supabaseKey,
          "Authorization": `Bearer ${(client as unknown as { supabaseKey: string }).supabaseKey}`,
        },
      }
    );
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json() as Array<{ value: unknown }>;
    if (!data || data.length === 0) {
      return null;
    }
    
    return parseWorkspace(data[0].value);
  }
  
  async getWorkspacesByUser(userId: string): Promise<Workspace[]> {
    const client = getSupabaseClient();
    
    const response = await fetch(
      `${(client as unknown as { supabaseUrl: string }).supabaseUrl}/rest/v1/context?user_id=eq.${userId}&key=eq.workspace&select=value&order=created_at.desc`,
      {
        headers: {
          "apikey": (client as unknown as { supabaseKey: string }).supabaseKey,
          "Authorization": `Bearer ${(client as unknown as { supabaseKey: string }).supabaseKey}`,
        },
      }
    );
    
    if (!response.ok) {
      return [];
    }
    
    const data = await response.json() as Array<{ value: unknown }>;
    return data.map((d) => parseWorkspace(d.value));
  }
  
  async updateWorkspace(
    id: string,
    updates: Partial<Workspace>
  ): Promise<Workspace> {
    const existing = await this.getWorkspace(id);
    if (!existing) {
      throw new Error(`Workspace ${id} not found`);
    }
    
    const updated = {
      ...existing,
      ...updates,
      id, // Prevent id change
      updatedAt: new Date(),
    };
    
    const client = getSupabaseClient();
    const response = await fetch(
      `${(client as unknown as { supabaseUrl: string }).supabaseUrl}/rest/v1/context?workspace_id=eq.${id}&key=eq.workspace`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": (client as unknown as { supabaseKey: string }).supabaseKey,
          "Authorization": `Bearer ${(client as unknown as { supabaseKey: string }).supabaseKey}`,
        },
        body: JSON.stringify({
          value: updated,
          updated_at: new Date().toISOString(),
        }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to update workspace: ${await response.text()}`);
    }
    
    return updated;
  }
  
  async deleteWorkspace(id: string): Promise<void> {
    const client = getSupabaseClient();
    
    const response = await fetch(
      `${(client as unknown as { supabaseUrl: string }).supabaseUrl}/rest/v1/context?workspace_id=eq.${id}`,
      {
        method: "DELETE",
        headers: {
          "apikey": (client as unknown as { supabaseKey: string }).supabaseKey,
          "Authorization": `Bearer ${(client as unknown as { supabaseKey: string }).supabaseKey}`,
        },
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to delete workspace: ${await response.text()}`);
    }
  }
  
  // ---------------------------------------------------------------------------
  // File Operations (metadata only - content stored locally or in GCP)
  // ---------------------------------------------------------------------------
  
  async upsertFile(params: UpsertFileParams): Promise<IndexedFile> {
    const client = getSupabaseClient();
    const workspace = await this.getWorkspace(params.workspaceId);
    const id = crypto.randomUUID();
    const now = new Date();
    
    const file: IndexedFile = {
      id,
      workspaceId: params.workspaceId,
      relativePath: params.relativePath,
      language: params.language,
      sizeBytes: params.sizeBytes,
      hash: params.hash,
      // Note: content is NOT stored in Supabase (too large)
      metadata: params.metadata || { lines: 0 },
      createdAt: now,
      updatedAt: now,
    };
    
    const response = await fetch(
      `${(client as unknown as { supabaseUrl: string }).supabaseUrl}/rest/v1/context`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": (client as unknown as { supabaseKey: string }).supabaseKey,
          "Authorization": `Bearer ${(client as unknown as { supabaseKey: string }).supabaseKey}`,
          "Prefer": "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          id,
          user_id: workspace?.userId,
          workspace_id: params.workspaceId,
          key: `file:${params.relativePath}`,
          value: file,
        }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to upsert file: ${await response.text()}`);
    }
    
    return file;
  }
  
  async upsertFilesBatch(params: UpsertFileParams[]): Promise<number> {
    // Process sequentially (Supabase REST doesn't have efficient batch)
    for (const p of params) {
      await this.upsertFile(p);
    }
    return params.length;
  }
  
  async getFile(id: string): Promise<IndexedFile | null> {
    const client = getSupabaseClient();
    
    const response = await fetch(
      `${(client as unknown as { supabaseUrl: string }).supabaseUrl}/rest/v1/context?id=eq.${id}&select=value`,
      {
        headers: {
          "apikey": (client as unknown as { supabaseKey: string }).supabaseKey,
          "Authorization": `Bearer ${(client as unknown as { supabaseKey: string }).supabaseKey}`,
        },
      }
    );
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json() as Array<{ value: unknown }>;
    if (!data || data.length === 0) {
      return null;
    }
    
    return parseFile(data[0].value);
  }
  
  async getFileByPath(
    workspaceId: string,
    relativePath: string
  ): Promise<IndexedFile | null> {
    const client = getSupabaseClient();
    
    const response = await fetch(
      `${(client as unknown as { supabaseUrl: string }).supabaseUrl}/rest/v1/context?workspace_id=eq.${workspaceId}&key=eq.file:${encodeURIComponent(relativePath)}&select=value`,
      {
        headers: {
          "apikey": (client as unknown as { supabaseKey: string }).supabaseKey,
          "Authorization": `Bearer ${(client as unknown as { supabaseKey: string }).supabaseKey}`,
        },
      }
    );
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json() as Array<{ value: unknown }>;
    if (!data || data.length === 0) {
      return null;
    }
    
    return parseFile(data[0].value);
  }
  
  async getWorkspaceFiles(workspaceId: string): Promise<IndexedFile[]> {
    const client = getSupabaseClient();
    
    const response = await fetch(
      `${(client as unknown as { supabaseUrl: string }).supabaseUrl}/rest/v1/context?workspace_id=eq.${workspaceId}&key=like.file:*&select=value`,
      {
        headers: {
          "apikey": (client as unknown as { supabaseKey: string }).supabaseKey,
          "Authorization": `Bearer ${(client as unknown as { supabaseKey: string }).supabaseKey}`,
        },
      }
    );
    
    if (!response.ok) {
      return [];
    }
    
    const data = await response.json() as Array<{ value: unknown }>;
    return data.map((d) => parseFile(d.value));
  }
  
  async deleteFile(id: string): Promise<void> {
    const client = getSupabaseClient();
    
    const response = await fetch(
      `${(client as unknown as { supabaseUrl: string }).supabaseUrl}/rest/v1/context?id=eq.${id}`,
      {
        method: "DELETE",
        headers: {
          "apikey": (client as unknown as { supabaseKey: string }).supabaseKey,
          "Authorization": `Bearer ${(client as unknown as { supabaseKey: string }).supabaseKey}`,
        },
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to delete file: ${await response.text()}`);
    }
  }
  
  async deleteStaleFiles(
    workspaceId: string,
    validHashes: string[]
  ): Promise<number> {
    const files = await this.getWorkspaceFiles(workspaceId);
    const hashSet = new Set(validHashes);
    
    let count = 0;
    for (const file of files) {
      if (!hashSet.has(file.hash)) {
        await this.deleteFile(file.id);
        count++;
      }
    }
    
    return count;
  }
  
  // ---------------------------------------------------------------------------
  // Chunk Operations (NOT supported in Supabase adapter)
  // Use GCP adapter for chunks/embeddings at scale
  // ---------------------------------------------------------------------------
  
  async upsertChunk(_params: UpsertChunkParams): Promise<Chunk> {
    throw new Error(
      "Chunks are not stored in Supabase. Use GCP adapter for embeddings."
    );
  }
  
  async upsertChunksBatch(_params: UpsertChunkParams[]): Promise<number> {
    throw new Error(
      "Chunks are not stored in Supabase. Use GCP adapter for embeddings."
    );
  }
  
  async getChunk(_id: string): Promise<Chunk | null> {
    throw new Error(
      "Chunks are not stored in Supabase. Use GCP adapter for embeddings."
    );
  }
  
  async getFileChunks(_fileId: string): Promise<Chunk[]> {
    throw new Error(
      "Chunks are not stored in Supabase. Use GCP adapter for embeddings."
    );
  }
  
  async deleteChunksByFile(_fileId: string): Promise<void> {
    // No-op for Supabase
  }
  
  async deleteChunksByWorkspace(_workspaceId: string): Promise<void> {
    // No-op for Supabase
  }
  
  // ---------------------------------------------------------------------------
  // Search Operations (NOT supported in Supabase adapter)
  // Use GCP adapter or local adapter for search
  // ---------------------------------------------------------------------------
  
  async vectorSearch(_params: VectorSearchParams): Promise<SearchResult[]> {
    throw new Error(
      "Vector search is not supported in Supabase adapter. Use GCP adapter."
    );
  }
  
  async textSearch(_params: TextSearchParams): Promise<SearchResult[]> {
    throw new Error(
      "Text search is not supported in Supabase adapter. Use GCP or local adapter."
    );
  }
  
  async hybridSearch(_params: HybridSearchParams): Promise<SearchResult[]> {
    throw new Error(
      "Hybrid search is not supported in Supabase adapter. Use GCP adapter."
    );
  }
  
  // ---------------------------------------------------------------------------
  // Sync Operations (Supabase Realtime)
  // ---------------------------------------------------------------------------
  
  subscribeToWorkspace(
    workspaceId: string,
    handler: (event: SyncEvent) => void
  ): () => void {
    const client = getSupabaseClient();
    
    // Get user ID from session asynchronously
    let subscription: { unsubscribe: () => void } | null = null;
    
    client.auth.getUser().then(({ data: { user } }) => {
      const userId = user?.id || "anonymous";
      
      subscription = subscribeToContext(workspaceId, userId, (event) => {
        if (event.type === "context:insert" || event.type === "context:update") {
          const row = event.payload as { key: string; value: unknown };
          
          if (row.key === "workspace") {
            handler({
              type: "workspace:updated",
              workspace: parseWorkspace(row.value),
            });
          } else if (row.key.startsWith("file:")) {
            handler({
              type: event.type === "context:insert" ? "file:created" : "file:updated",
              file: parseFile(row.value),
            });
          }
        } else if (event.type === "context:delete") {
          const row = event.payload as { id: string; key: string };
          
          if (row.key?.startsWith("file:")) {
            handler({
              type: "file:deleted",
              fileId: row.id,
            });
          }
        }
      });
    });
    
    return () => {
      subscription?.unsubscribe();
    };
  }
  
  async pushChanges(): Promise<void> {
    // Supabase handles this via direct writes
  }
  
  async pullChanges(): Promise<[]> {
    // Supabase handles this via realtime subscriptions
    return [];
  }
}

// ============================================================================
// Helpers
// ============================================================================

function parseWorkspace(value: unknown): Workspace {
  const v = value as Record<string, unknown>;
  return {
    id: String(v.id),
    userId: String(v.userId),
    name: String(v.name),
    rootPath: String(v.rootPath),
    config: v.config as Workspace["config"],
    stats: v.stats as Workspace["stats"],
    createdAt: new Date(String(v.createdAt)),
    updatedAt: new Date(String(v.updatedAt)),
    lastIndexedAt: v.lastIndexedAt ? new Date(String(v.lastIndexedAt)) : null,
  };
}

function parseFile(value: unknown): IndexedFile {
  const v = value as Record<string, unknown>;
  return {
    id: String(v.id),
    workspaceId: String(v.workspaceId),
    relativePath: String(v.relativePath),
    language: String(v.language),
    sizeBytes: Number(v.sizeBytes),
    hash: String(v.hash),
    content: v.content ? String(v.content) : undefined,
    metadata: v.metadata as IndexedFile["metadata"],
    createdAt: new Date(String(v.createdAt)),
    updatedAt: new Date(String(v.updatedAt)),
  };
}

// ============================================================================
// Export
// ============================================================================

export function createSupabaseAdapter(): SyncAdapter {
  return new SupabaseSyncAdapter();
}
