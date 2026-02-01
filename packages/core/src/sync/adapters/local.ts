/**
 * Local Sync Adapter
 *
 * File-based storage using JSON files.
 * No external dependencies, works offline.
 */

import { readFile, writeFile, mkdir, unlink, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
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
} from "../types";

// ============================================================================
// Local Storage Paths
// ============================================================================

function getStoragePath(basePath: string, ...parts: string[]): string {
  return join(basePath, ".nella", ...parts);
}

async function ensureDir(path: string): Promise<void> {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function readJSON<T>(path: string): Promise<T | null> {
  try {
    const data = await readFile(path, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function writeJSON(path: string, data: unknown): Promise<void> {
  await ensureDir(path);
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

// ============================================================================
// Local Sync Adapter
// ============================================================================

export class LocalSyncAdapter implements SyncAdapter {
  readonly tier = "local" as const;
  
  private basePath: string | null = null;
  private ready = false;
  
  // In-memory caches
  private workspaces: Map<string, Workspace> = new Map();
  private files: Map<string, IndexedFile> = new Map();
  private chunks: Map<string, Chunk> = new Map();
  
  // Indexes
  private filesByWorkspace: Map<string, Set<string>> = new Map();
  private chunksByFile: Map<string, Set<string>> = new Map();
  private chunksByWorkspace: Map<string, Set<string>> = new Map();
  
  async init(config: SyncConfig): Promise<void> {
    if (!config.localPath) {
      throw new Error("localPath is required for LocalSyncAdapter");
    }
    
    this.basePath = config.localPath;
    
    // Load existing data
    await this.loadData();
    
    this.ready = true;
  }
  
  isReady(): boolean {
    return this.ready;
  }
  
  async disconnect(): Promise<void> {
    // Persist any pending changes
    await this.saveData();
    
    this.workspaces.clear();
    this.files.clear();
    this.chunks.clear();
    this.filesByWorkspace.clear();
    this.chunksByFile.clear();
    this.chunksByWorkspace.clear();
    
    this.ready = false;
  }
  
  // ---------------------------------------------------------------------------
  // Data Persistence
  // ---------------------------------------------------------------------------
  
  private async loadData(): Promise<void> {
    if (!this.basePath) return;
    
    const storagePath = getStoragePath(this.basePath);
    
    // Load workspaces
    const workspacesData = await readJSON<Workspace[]>(
      join(storagePath, "workspaces.json")
    );
    if (workspacesData) {
      for (const ws of workspacesData) {
        this.workspaces.set(ws.id, {
          ...ws,
          createdAt: new Date(ws.createdAt),
          updatedAt: new Date(ws.updatedAt),
          lastIndexedAt: ws.lastIndexedAt ? new Date(ws.lastIndexedAt) : null,
        });
      }
    }
    
    // Load files
    const filesData = await readJSON<IndexedFile[]>(
      join(storagePath, "files.json")
    );
    if (filesData) {
      for (const file of filesData) {
        const parsed = {
          ...file,
          createdAt: new Date(file.createdAt),
          updatedAt: new Date(file.updatedAt),
        };
        this.files.set(file.id, parsed);
        
        // Update index
        if (!this.filesByWorkspace.has(file.workspaceId)) {
          this.filesByWorkspace.set(file.workspaceId, new Set());
        }
        this.filesByWorkspace.get(file.workspaceId)!.add(file.id);
      }
    }
    
    // Load chunks (from workspace-specific files for performance)
    for (const ws of this.workspaces.values()) {
      const chunksData = await readJSON<Chunk[]>(
        join(storagePath, "chunks", `${ws.id}.json`)
      );
      if (chunksData) {
        for (const chunk of chunksData) {
          const parsed = {
            ...chunk,
            createdAt: new Date(chunk.createdAt),
          };
          this.chunks.set(chunk.id, parsed);
          
          // Update indexes
          if (!this.chunksByFile.has(chunk.fileId)) {
            this.chunksByFile.set(chunk.fileId, new Set());
          }
          this.chunksByFile.get(chunk.fileId)!.add(chunk.id);
          
          if (!this.chunksByWorkspace.has(chunk.workspaceId)) {
            this.chunksByWorkspace.set(chunk.workspaceId, new Set());
          }
          this.chunksByWorkspace.get(chunk.workspaceId)!.add(chunk.id);
        }
      }
    }
  }
  
  private async saveData(): Promise<void> {
    if (!this.basePath) return;
    
    const storagePath = getStoragePath(this.basePath);
    
    // Save workspaces
    await writeJSON(
      join(storagePath, "workspaces.json"),
      Array.from(this.workspaces.values())
    );
    
    // Save files
    await writeJSON(
      join(storagePath, "files.json"),
      Array.from(this.files.values())
    );
    
    // Save chunks per workspace
    for (const ws of this.workspaces.values()) {
      const chunkIds = this.chunksByWorkspace.get(ws.id);
      if (chunkIds) {
        const chunks = Array.from(chunkIds)
          .map((id) => this.chunks.get(id))
          .filter(Boolean);
        await writeJSON(join(storagePath, "chunks", `${ws.id}.json`), chunks);
      }
    }
  }
  
  // ---------------------------------------------------------------------------
  // Workspace Operations
  // ---------------------------------------------------------------------------
  
  async createWorkspace(params: CreateWorkspaceParams): Promise<Workspace> {
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
    
    this.workspaces.set(id, workspace);
    await this.saveData();
    
    return workspace;
  }
  
  async getWorkspace(id: string): Promise<Workspace | null> {
    return this.workspaces.get(id) || null;
  }
  
  async getWorkspacesByUser(userId: string): Promise<Workspace[]> {
    return Array.from(this.workspaces.values()).filter(
      (ws) => ws.userId === userId
    );
  }
  
  async updateWorkspace(
    id: string,
    updates: Partial<Workspace>
  ): Promise<Workspace> {
    const workspace = this.workspaces.get(id);
    if (!workspace) {
      throw new Error(`Workspace ${id} not found`);
    }
    
    const updated = {
      ...workspace,
      ...updates,
      id, // Prevent id change
      updatedAt: new Date(),
    };
    
    this.workspaces.set(id, updated);
    await this.saveData();
    
    return updated;
  }
  
  async deleteWorkspace(id: string): Promise<void> {
    // Delete all chunks in workspace
    const chunkIds = this.chunksByWorkspace.get(id);
    if (chunkIds) {
      for (const chunkId of chunkIds) {
        this.chunks.delete(chunkId);
      }
      this.chunksByWorkspace.delete(id);
    }
    
    // Delete all files in workspace
    const fileIds = this.filesByWorkspace.get(id);
    if (fileIds) {
      for (const fileId of fileIds) {
        this.files.delete(fileId);
        this.chunksByFile.delete(fileId);
      }
      this.filesByWorkspace.delete(id);
    }
    
    // Delete workspace
    this.workspaces.delete(id);
    
    // Delete chunk file
    if (this.basePath) {
      try {
        await unlink(
          getStoragePath(this.basePath, "chunks", `${id}.json`)
        );
      } catch {
        // File may not exist
      }
    }
    
    await this.saveData();
  }
  
  // ---------------------------------------------------------------------------
  // File Operations
  // ---------------------------------------------------------------------------
  
  async upsertFile(params: UpsertFileParams): Promise<IndexedFile> {
    // Check for existing file by path
    const existing = await this.getFileByPath(
      params.workspaceId,
      params.relativePath
    );
    
    const id = existing?.id || crypto.randomUUID();
    const now = new Date();
    
    const file: IndexedFile = {
      id,
      workspaceId: params.workspaceId,
      relativePath: params.relativePath,
      language: params.language,
      sizeBytes: params.sizeBytes,
      hash: params.hash,
      content: params.content,
      metadata: params.metadata || { lines: 0 },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    
    this.files.set(id, file);
    
    // Update index
    if (!this.filesByWorkspace.has(params.workspaceId)) {
      this.filesByWorkspace.set(params.workspaceId, new Set());
    }
    this.filesByWorkspace.get(params.workspaceId)!.add(id);
    
    // Don't save on every upsert (batch saves)
    return file;
  }
  
  async upsertFilesBatch(params: UpsertFileParams[]): Promise<number> {
    for (const p of params) {
      await this.upsertFile(p);
    }
    await this.saveData();
    return params.length;
  }
  
  async getFile(id: string): Promise<IndexedFile | null> {
    return this.files.get(id) || null;
  }
  
  async getFileByPath(
    workspaceId: string,
    relativePath: string
  ): Promise<IndexedFile | null> {
    const fileIds = this.filesByWorkspace.get(workspaceId);
    if (!fileIds) return null;
    
    for (const id of fileIds) {
      const file = this.files.get(id);
      if (file && file.relativePath === relativePath) {
        return file;
      }
    }
    
    return null;
  }
  
  async getWorkspaceFiles(workspaceId: string): Promise<IndexedFile[]> {
    const fileIds = this.filesByWorkspace.get(workspaceId);
    if (!fileIds) return [];
    
    return Array.from(fileIds)
      .map((id) => this.files.get(id))
      .filter((f): f is IndexedFile => f !== undefined);
  }
  
  async deleteFile(id: string): Promise<void> {
    const file = this.files.get(id);
    if (!file) return;
    
    // Delete chunks
    await this.deleteChunksByFile(id);
    
    // Delete file
    this.files.delete(id);
    this.filesByWorkspace.get(file.workspaceId)?.delete(id);
    
    await this.saveData();
  }
  
  async deleteStaleFiles(
    workspaceId: string,
    validHashes: string[]
  ): Promise<number> {
    const fileIds = this.filesByWorkspace.get(workspaceId);
    if (!fileIds) return 0;
    
    const hashSet = new Set(validHashes);
    const toDelete: string[] = [];
    
    for (const id of fileIds) {
      const file = this.files.get(id);
      if (file && !hashSet.has(file.hash)) {
        toDelete.push(id);
      }
    }
    
    for (const id of toDelete) {
      await this.deleteFile(id);
    }
    
    return toDelete.length;
  }
  
  // ---------------------------------------------------------------------------
  // Chunk Operations
  // ---------------------------------------------------------------------------
  
  async upsertChunk(params: UpsertChunkParams): Promise<Chunk> {
    const id = crypto.randomUUID();
    const now = new Date();
    
    const chunk: Chunk = {
      id,
      fileId: params.fileId,
      workspaceId: params.workspaceId,
      content: params.content,
      startLine: params.startLine,
      endLine: params.endLine,
      chunkType: params.chunkType,
      symbolName: params.symbolName,
      embedding: params.embedding,
      metadata: params.metadata || { token_count: 0 },
      createdAt: now,
    };
    
    this.chunks.set(id, chunk);
    
    // Update indexes
    if (!this.chunksByFile.has(params.fileId)) {
      this.chunksByFile.set(params.fileId, new Set());
    }
    this.chunksByFile.get(params.fileId)!.add(id);
    
    if (!this.chunksByWorkspace.has(params.workspaceId)) {
      this.chunksByWorkspace.set(params.workspaceId, new Set());
    }
    this.chunksByWorkspace.get(params.workspaceId)!.add(id);
    
    return chunk;
  }
  
  async upsertChunksBatch(params: UpsertChunkParams[]): Promise<number> {
    for (const p of params) {
      await this.upsertChunk(p);
    }
    await this.saveData();
    return params.length;
  }
  
  async getChunk(id: string): Promise<Chunk | null> {
    return this.chunks.get(id) || null;
  }
  
  async getFileChunks(fileId: string): Promise<Chunk[]> {
    const chunkIds = this.chunksByFile.get(fileId);
    if (!chunkIds) return [];
    
    return Array.from(chunkIds)
      .map((id) => this.chunks.get(id))
      .filter((c): c is Chunk => c !== undefined);
  }
  
  async deleteChunksByFile(fileId: string): Promise<void> {
    const chunkIds = this.chunksByFile.get(fileId);
    if (!chunkIds) return;
    
    for (const id of chunkIds) {
      const chunk = this.chunks.get(id);
      if (chunk) {
        this.chunksByWorkspace.get(chunk.workspaceId)?.delete(id);
      }
      this.chunks.delete(id);
    }
    
    this.chunksByFile.delete(fileId);
  }
  
  async deleteChunksByWorkspace(workspaceId: string): Promise<void> {
    const chunkIds = this.chunksByWorkspace.get(workspaceId);
    if (!chunkIds) return;
    
    for (const id of chunkIds) {
      const chunk = this.chunks.get(id);
      if (chunk) {
        this.chunksByFile.get(chunk.fileId)?.delete(id);
      }
      this.chunks.delete(id);
    }
    
    this.chunksByWorkspace.delete(workspaceId);
    await this.saveData();
  }
  
  // ---------------------------------------------------------------------------
  // Search Operations
  // ---------------------------------------------------------------------------
  
  async vectorSearch(params: VectorSearchParams): Promise<SearchResult[]> {
    const chunkIds = this.chunksByWorkspace.get(params.workspaceId);
    if (!chunkIds || !params.embedding) return [];
    
    const results: Array<{ chunk: Chunk; file: IndexedFile; similarity: number }> = [];
    
    for (const id of chunkIds) {
      const chunk = this.chunks.get(id);
      if (!chunk || !chunk.embedding) continue;
      
      // Filter by chunk type
      if (params.chunkTypes && !params.chunkTypes.includes(chunk.chunkType)) {
        continue;
      }
      
      const file = this.files.get(chunk.fileId);
      if (!file) continue;
      
      // Filter by file pattern
      if (params.filePatterns) {
        const matches = params.filePatterns.some((pattern) => {
          const regex = new RegExp(pattern.replace(/\*/g, ".*"));
          return regex.test(file.relativePath);
        });
        if (!matches) continue;
      }
      
      // Compute cosine similarity
      const similarity = cosineSimilarity(params.embedding, chunk.embedding);
      
      if (similarity >= (params.threshold || 0.7)) {
        results.push({ chunk, file, similarity });
      }
    }
    
    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);
    
    // Limit results
    const limited = results.slice(0, params.limit || 10);
    
    return limited.map(({ chunk, file, similarity }) => ({
      chunkId: chunk.id,
      fileId: chunk.fileId,
      workspaceId: chunk.workspaceId,
      relativePath: file.relativePath,
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      chunkType: chunk.chunkType,
      symbolName: chunk.symbolName,
      similarity,
      language: file.language,
    }));
  }
  
  async textSearch(params: TextSearchParams): Promise<SearchResult[]> {
    const chunkIds = this.chunksByWorkspace.get(params.workspaceId);
    if (!chunkIds) return [];
    
    const query = params.query.toLowerCase();
    const results: Array<{ chunk: Chunk; file: IndexedFile; score: number }> = [];
    
    for (const id of chunkIds) {
      const chunk = this.chunks.get(id);
      if (!chunk) continue;
      
      // Filter by chunk type
      if (params.chunkTypes && !params.chunkTypes.includes(chunk.chunkType)) {
        continue;
      }
      
      const file = this.files.get(chunk.fileId);
      if (!file) continue;
      
      // Filter by file pattern
      if (params.filePatterns) {
        const matches = params.filePatterns.some((pattern) => {
          const regex = new RegExp(pattern.replace(/\*/g, ".*"));
          return regex.test(file.relativePath);
        });
        if (!matches) continue;
      }
      
      // Simple text matching
      const content = chunk.content.toLowerCase();
      if (content.includes(query)) {
        // Score based on frequency and position
        const count = (content.match(new RegExp(query, "g")) || []).length;
        const position = content.indexOf(query) / content.length;
        const score = count * 0.5 + (1 - position) * 0.5;
        
        results.push({ chunk, file, score });
      }
    }
    
    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    
    // Limit results
    const limited = results.slice(0, params.limit || 10);
    
    return limited.map(({ chunk, file, score }) => ({
      chunkId: chunk.id,
      fileId: chunk.fileId,
      workspaceId: chunk.workspaceId,
      relativePath: file.relativePath,
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      chunkType: chunk.chunkType,
      symbolName: chunk.symbolName,
      similarity: score,
      language: file.language,
    }));
  }
  
  async hybridSearch(params: HybridSearchParams): Promise<SearchResult[]> {
    const vectorWeight = params.vectorWeight ?? 0.7;
    const textWeight = params.textWeight ?? 0.3;
    
    // Get both results
    const [vectorResults, textResults] = await Promise.all([
      this.vectorSearch({
        workspaceId: params.workspaceId,
        embedding: params.embedding,
        limit: (params.limit || 10) * 2,
        threshold: 0, // We'll filter later
        chunkTypes: params.chunkTypes,
      }),
      this.textSearch({
        workspaceId: params.workspaceId,
        query: params.query,
        limit: (params.limit || 10) * 2,
        chunkTypes: params.chunkTypes,
      }),
    ]);
    
    // Merge results
    const merged = new Map<string, SearchResult>();
    
    for (const result of vectorResults) {
      merged.set(result.chunkId, {
        ...result,
        similarity: result.similarity * vectorWeight,
      });
    }
    
    for (const result of textResults) {
      const existing = merged.get(result.chunkId);
      if (existing) {
        existing.similarity += result.similarity * textWeight;
      } else {
        merged.set(result.chunkId, {
          ...result,
          similarity: result.similarity * textWeight,
        });
      }
    }
    
    // Sort and filter
    const results = Array.from(merged.values())
      .filter((r) => r.similarity >= (params.threshold || 0.5))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, params.limit || 10);
    
    return results;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ============================================================================
// Export
// ============================================================================

export function createLocalAdapter(): SyncAdapter {
  return new LocalSyncAdapter();
}
