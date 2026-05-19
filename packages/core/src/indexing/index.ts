/**
 * Index Manager
 *
 * Main orchestrator for the RAG indexing system.
 * Manages document loading, chunking, embedding, and search.
 */

import * as fs from "fs";
import * as path from "path";
import { minimatch } from "minimatch";
import type {
  CodeChunk,
  ContentSource,
  IndexMetadata,
  IndexConfig,
  DEFAULT_INDEX_CONFIG,
  SearchQuery,
  SearchResponse,
  VerifyCodeRequest,
  VerifyCodeResult,
  IndexEvent,
} from "./types";
import { Chunker, createChunker } from "./chunker";
import { Embedder, createEmbedder } from "./embedder";
import { VectorStore, createVectorStore } from "./vector-store";
import { LexicalIndex, createLexicalIndex } from "./lexical-index";
import { HybridSearcher, createHybridSearcher } from "./hybrid-search";
import { CodeVerifier, createCodeVerifier } from "./verifier";
import { scoreInjectionRisk } from "./injection-scorer";
import { saveBest, loadAny, removePersistedFile } from "./persistence";

// =============================================================================
// Types
// =============================================================================

export interface IndexManagerConfig extends IndexConfig {
  workspaceId: string;
  workspacePath: string;
  storagePath: string;  // Where to store index files
}

export type IndexEventHandler = (event: IndexEvent) => void;

// =============================================================================
// Index Manager Class
// =============================================================================

export class IndexManager {
  private config: IndexManagerConfig;
  private metadata: IndexMetadata | null = null;

  // Components
  private chunker: Chunker;
  private embedder: Embedder;
  private vectorStore: VectorStore;
  private lexicalIndex: LexicalIndex;
  private hybridSearcher: HybridSearcher;
  private verifier: CodeVerifier;

  // State
  private chunks: Map<string, CodeChunk> = new Map();
  private fileHashes: Map<string, string> = new Map();
  private eventHandlers: IndexEventHandler[] = [];

  constructor(config: IndexManagerConfig) {
    this.config = config;

    // Initialize components
    this.chunker = createChunker({
      maxTokens: config.chunking.maxTokens,
      overlap: config.chunking.overlap,
      strategy: config.chunking.strategy,
    });

    this.embedder = createEmbedder({
      provider: config.embedder.provider,
      model: config.embedder.model,
      dimensions: config.embedder.dimensions,
      apiKey: config.embedder.apiKey,
      endpoint: config.embedder.endpoint,
      deployment: config.embedder.deployment,
      apiBase: config.embedder.apiBase,
    });

    this.vectorStore = createVectorStore({
      dimensions: config.embedder.dimensions,
    });

    this.lexicalIndex = createLexicalIndex();

    // When embeddings are proxied through Nella (session-auth users have no
    // local VOYAGE_API_KEY), route rerank through the same proxy so rerank
    // actually fires instead of silently degrading to RRF-only.
    const providerInfo = this.embedder.getProviderInfo();
    const rerankOverride = providerInfo.provider === "nella" && providerInfo.apiKey && providerInfo.apiBase
      ? {
          rerankApiKey: providerInfo.apiKey,
          rerankUrl: `${providerInfo.apiBase.replace(/\/$/, "")}/rerank`,
        }
      : {};

    this.hybridSearcher = createHybridSearcher(
      this.vectorStore,
      this.lexicalIndex,
      this.embedder,
      {
        vectorWeight: config.search.vectorWeight,
        lexicalWeight: config.search.lexicalWeight,
        topK: config.search.topK,
        rerankEnabled: config.search.rerankEnabled,
        ...rerankOverride,
      }
    );

    this.verifier = createCodeVerifier(this.lexicalIndex);

    // Initialize persistence
    this.initPersistence();
  }

  /**
   * Initialize persistence paths
   */
  private initPersistence(): void {
    const storagePath = this.config.storagePath;

    // Create storage directory
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }

    // Initialize component persistence
    this.embedder.initCache(path.join(storagePath, "embeddings.cache.json"));
    this.vectorStore.initPersistence(path.join(storagePath, "vectors.json"));
    this.lexicalIndex.initPersistence(path.join(storagePath, "lexical.json"));

    // Load existing metadata
    this.loadMetadata();
  }

  /**
   * Add event handler
   */
  onEvent(handler: IndexEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit event to all handlers
   */
  private emit(event: IndexEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Event handler error:", error);
      }
    }
  }

  /**
   * Index the workspace
   */
  async index(options: { force?: boolean; paths?: string[]; exclude?: string[] } = {}): Promise<IndexMetadata> {
    const { force = false, paths, exclude } = options;
    const workspacePath = this.config.workspacePath;

    // Get files to index
    const files = paths
      ? paths.map((p) => path.resolve(workspacePath, p))
      : this.getFilesToIndex(workspacePath, exclude);

    // Force reindex: wipe all state for a clean rebuild
    if (force) {
      this.chunks.clear();
      this.vectorStore.clear();
      this.lexicalIndex.clear();
      this.fileHashes.clear();
    }

    this.emit({
      type: "index:start",
      workspaceId: this.config.workspaceId,
      totalFiles: files.length,
    });

    let totalChunks = 0;
    let estimatedTokens = 0;
    let actualApiTokens = 0;
    let totalCost = 0;
    const startTime = Date.now();

    // Process files
    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];

      try {
        // Check if file needs reindexing
        const fileHash = this.computeFileHash(filePath);
        const existingHash = this.fileHashes.get(filePath);

        if (!force && existingHash === fileHash) {
          continue; // Skip unchanged files
        }

        this.emit({
          type: "index:progress",
          workspaceId: this.config.workspaceId,
          processed: i + 1,
          total: files.length,
          currentFile: path.relative(workspacePath, filePath),
        });

        // Remove old chunks for this file
        this.removeChunksForFile(filePath);

        // Chunk the file
        const fileChunks = await this.chunker.chunkFile(filePath);

        // Add chunks to indexes (with source trust classification — L3, L5)
        for (const chunk of fileChunks) {
          if (!chunk.source) {
            chunk.source = {
              origin: "workspace",
              trustLevel: "trusted",
            };
          }

          // L5: Compute injection risk score at index time
          const assessment = scoreInjectionRisk(chunk);
          chunk.source.injectionScore = assessment.score;

          // Update trust level based on injection score + origin
          if (chunk.source.origin === "workspace") {
            chunk.source.trustLevel = assessment.score >= 0.3 ? "semi-trusted" : "trusted";
          } else {
            chunk.source.trustLevel = assessment.score >= 0.2 ? "untrusted" : "semi-trusted";
          }

          this.chunks.set(chunk.id, chunk);
          this.lexicalIndex.add(chunk);
          this.hybridSearcher.registerChunk(chunk);
          this.verifier.registerChunk(chunk);

          this.emit({
            type: "index:chunk",
            workspaceId: this.config.workspaceId,
            chunkId: chunk.id,
            filePath: path.relative(workspacePath, filePath),
          });

          totalChunks++;
          estimatedTokens += chunk.tokens;
        }

        // Update file hash
        this.fileHashes.set(filePath, fileHash);

      } catch (error) {
        this.emit({
          type: "index:error",
          workspaceId: this.config.workspaceId,
          error: error instanceof Error ? error.message : String(error),
          filePath: path.relative(workspacePath, filePath),
        });
      }
    }

    // Save chunking + lexical progress before starting embeddings.
    // If the embedding API fails mid-way, at least the chunked data is on disk.
    this.lexicalIndex.save();
    this.saveChunks();
    this.saveFileHashes();

    // Restore embeddings from cache for chunks that were embedded in a
    // previous (possibly failed) session. This avoids re-processing
    // hundreds of batches at "0 tokens" just to hit the cache.
    const expectedDims = this.config.embedder.dimensions;
    let restoredFromCache = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.embedding) continue;
      const enriched = this.enrichChunkContent(chunk);
      const cached = this.embedder.getFromCache(enriched);
      if (cached && cached.length === expectedDims) {
        chunk.embedding = cached;
        this.vectorStore.add(chunk.id, cached);
        restoredFromCache++;
      }
    }
    if (restoredFromCache > 0) {
      this.emit({
        type: "index:embed",
        workspaceId: this.config.workspaceId,
        batchSize: restoredFromCache,
        tokensUsed: 0,
        cost: 0,
      });
    }

    // Generate embeddings only for chunks NOT in cache (truly new content).
    const chunksToEmbed = Array.from(this.chunks.values()).filter((c) => !c.embedding);

    if (chunksToEmbed.length > 0) {
      const maxBatchTokens = 7500;
      const maxBatchSize = 50;
      const concurrency = 4; // Fire up to 4 API calls in parallel

      // Build all batches upfront using ENRICHED content size (what the API
      // actually receives), not raw chunk tokens. Enrichment prepends file path,
      // symbols, and imports — typically 100-200 extra tokens per chunk — so raw
      // token counts underestimate batch size and produce too many small batches.
      const batches: CodeChunk[][] = [];
      let i = 0;
      while (i < chunksToEmbed.length) {
        const batch: CodeChunk[] = [];
        let batchTokens = 0;
        while (i < chunksToEmbed.length && batch.length < maxBatchSize) {
          const enriched = this.enrichChunkContent(chunksToEmbed[i]);
          const chunkTokens = Math.ceil(enriched.length / 3);
          if (batch.length > 0 && batchTokens + chunkTokens > maxBatchTokens) break;
          batchTokens += chunkTokens;
          batch.push(chunksToEmbed[i]);
          i++;
        }
        batches.push(batch);
      }

      try {
        // Process batches in parallel waves
        for (let wave = 0; wave < batches.length; wave += concurrency) {
          const waveBatches = batches.slice(wave, wave + concurrency);

          const results = await Promise.all(
            waveBatches.map(async (batch) => {
              const texts = batch.map((c) => this.enrichChunkContent(c));
              return this.embedder.embed({ texts });
            }),
          );

          // Store results from all batches in this wave
          for (let b = 0; b < waveBatches.length; b++) {
            const batch = waveBatches[b];
            const { embeddings, tokensUsed, cost } = results[b];
            actualApiTokens += tokensUsed;
            totalCost += cost;

            this.emit({
              type: "index:embed",
              workspaceId: this.config.workspaceId,
              batchSize: batch.length,
              tokensUsed,
              cost,
            });

            for (let j = 0; j < batch.length; j++) {
              batch[j].embedding = embeddings[j];
              this.vectorStore.add(batch[j].id, embeddings[j]);
            }
          }

          // Persist after each wave so progress survives failures
          this.embedder.saveCache();
          this.vectorStore.save();
          this.saveChunks();
        }
      } catch (embeddingError) {
        // Save whatever progress was made before re-throwing
        this.embedder.saveCache();
        this.vectorStore.save();
        this.saveChunks();
        this.saveFileHashes();
        this.savePartialMetadata(files.length, estimatedTokens, actualApiTokens, totalCost, startTime);
        throw embeddingError;
      }
    }

    // Final save
    this.embedder.saveCache();
    this.vectorStore.save();
    this.lexicalIndex.save();
    this.saveChunks();
    this.saveFileHashes();

    // Update metadata
    const duration = Date.now() - startTime;
    this.metadata = {
      workspaceId: this.config.workspaceId,
      workspacePath: this.config.workspacePath,
      createdAt: this.metadata?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: "1.0.0",
      stats: {
        filesIndexed: files.length,
        chunksCount: this.chunks.size,
        totalTokens: actualApiTokens,
        estimatedTokens,
        embeddingsCount: this.vectorStore.size,
        totalCost,
        durationMs: duration,
      },
      config: this.config,
    };
    this.saveMetadata();

    this.emit({
      type: "index:complete",
      workspaceId: this.config.workspaceId,
      stats: this.metadata.stats,
      duration,
    });

    return this.metadata;
  }

  /**
   * Search the index
   */
  async search(query: SearchQuery): Promise<SearchResponse> {
    const startTime = Date.now();
    const response = await this.hybridSearcher.search(query);

    this.emit({
      type: "search:query",
      query: query.query,
      resultsCount: response.results.length,
      searchTime: Date.now() - startTime,
    });

    if (response.tokensUsed > 0) {
      this.emit({
        type: "search:embed",
        tokensUsed: response.tokensUsed,
        cost: response.cost,
      });
    }

    return response;
  }

  /**
   * Verify code against the index
   */
  verify(request: VerifyCodeRequest): VerifyCodeResult {
    const result = this.verifier.verify(request);

    this.emit({
      type: "verify:check",
      filePath: request.filePath || "unknown",
      valid: result.valid,
      issuesCount: result.issues.length,
    });

    return result;
  }

  /**
   * Get a chunk by ID
   */
  getChunk(chunkId: string): CodeChunk | null {
    return this.chunks.get(chunkId) || null;
  }

  /**
   * Get all chunks for a file
   */
  getChunksForFile(filePath: string): CodeChunk[] {
    const normalizedPath = path.normalize(filePath);
    return Array.from(this.chunks.values()).filter(
      (c) => path.normalize(c.filePath) === normalizedPath
    );
  }

  /**
   * Get all indexed chunks
   */
  getAllChunks(): CodeChunk[] {
    return Array.from(this.chunks.values());
  }

  /**
   * Get index metadata
   */
  getMetadata(): IndexMetadata | null {
    return this.metadata;
  }

  /**
   * Get index status
   */
  getStatus(): {
    ready: boolean;
    stats: IndexMetadata["stats"] | null;
    lastUpdated: string | null;
  } {
    return {
      ready: this.chunks.size > 0,
      stats: this.metadata?.stats || null,
      lastUpdated: this.metadata?.updatedAt || null,
    };
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.chunks.clear();
    this.fileHashes.clear();
    this.vectorStore.clear();
    this.lexicalIndex.clear();
    this.metadata = null;

    // Clear persisted files (both legacy JSON and compressed)
    const files = [
      "chunks.json",
      "vectors.json",
      "lexical.json",
      "metadata.json",
      "file-hashes.json",
    ];
    for (const file of files) {
      removePersistedFile(path.join(this.config.storagePath, file));
    }
    // Also remove the vector store metadata file
    removePersistedFile(path.join(this.config.storagePath, "vectors.json.meta.json"));
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Prepend file path and symbol metadata to chunk content for better embeddings.
   * Only used for the embedding API call — stored chunk content stays as raw code.
   */
  private enrichChunkContent(chunk: CodeChunk): string {
    const parts: string[] = [];

    const relativePath = path.relative(this.config.workspacePath, chunk.filePath);
    parts.push(`// File: ${relativePath}`);

    if (chunk.symbols.length > 0) {
      const symbolNames = chunk.symbols
        .map((s) => `${s.kind} ${s.name}`)
        .join(", ");
      parts.push(`// Defines: ${symbolNames}`);
    }

    if (chunk.imports && chunk.imports.length > 0) {
      parts.push(`// Imports: ${chunk.imports.join(", ")}`);
    }

    parts.push("");
    parts.push(chunk.content);

    return parts.join("\n");
  }

  /**
   * Parse a .gitignore or .nellaignore file into minimatch-compatible patterns.
   * Handles comments, blank lines, directory patterns, and root-relative patterns.
   * Negation patterns (!) are skipped — they require ordered evaluation that
   * minimatch's simple .some() check can't support.
   */
  private static parseIgnoreFile(filePath: string): string[] {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, "utf-8");
    const patterns: string[] = [];

    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      // Skip negation patterns — would need ordered evaluation
      if (line.startsWith("!")) continue;

      let pattern = line;

      // Root-relative: starts with / → strip it (already relative to root)
      if (pattern.startsWith("/")) {
        pattern = pattern.slice(1);
      }

      // Directory pattern: ends with / → match everything inside
      if (pattern.endsWith("/")) {
        pattern = `**/${pattern}**`;
      } else if (!pattern.includes("/")) {
        // No slash → can match anywhere in tree
        pattern = `**/${pattern}`;
        // Also match as a directory containing files
        patterns.push(`**/${line}/**`);
      }

      patterns.push(pattern);
    }

    return patterns;
  }

  private getFilesToIndex(rootPath: string, extraExcludes?: string[]): string[] {
    const files: string[] = [];

    // Merge config excludes with .gitignore, .nellaignore, and any extra patterns
    const ignorePatterns = [
      ...IndexManager.parseIgnoreFile(path.join(rootPath, ".gitignore")),
      ...IndexManager.parseIgnoreFile(path.join(rootPath, ".nellaignore")),
    ];
    const allExcludes = [...this.config.exclude, ...ignorePatterns, ...(extraExcludes || [])];

    const walk = (dir: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(rootPath, fullPath);

        // Check excludes (config + .gitignore + .nellaignore)
        const excluded = allExcludes.some((pattern) =>
          minimatch(relativePath, pattern, { dot: true })
        );
        if (excluded) continue;

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          // Check includes
          const included = this.config.include.some((pattern) =>
            minimatch(relativePath, pattern, { dot: true })
          );
          if (included) {
            files.push(fullPath);
          }
        }
      }
    };

    walk(rootPath);
    return files;
  }

  private computeFileHash(filePath: string): string {
    const content = fs.readFileSync(filePath);
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  private removeChunksForFile(filePath: string): void {
    const normalizedPath = path.normalize(filePath);
    const chunksToRemove = Array.from(this.chunks.entries()).filter(
      ([, chunk]) => path.normalize(chunk.filePath) === normalizedPath
    );

    for (const [chunkId] of chunksToRemove) {
      this.chunks.delete(chunkId);
      this.vectorStore.remove(chunkId);
      this.lexicalIndex.remove(chunkId);
    }
  }

  private loadMetadata(): void {
    const metadataPath = path.join(this.config.storagePath, "metadata.json");
    if (fs.existsSync(metadataPath)) {
      try {
        const content = fs.readFileSync(metadataPath, "utf-8");
        this.metadata = JSON.parse(content);
      } catch (error) {
        console.debug("Failed to load index metadata:", (error as Error).message);
      }
    }

    // Load chunks
    this.loadChunks();
    this.loadFileHashes();
  }

  private saveMetadata(): void {
    const metadataPath = path.join(this.config.storagePath, "metadata.json");
    fs.writeFileSync(metadataPath, JSON.stringify(this.metadata, null, 2));
  }

  /**
   * Save metadata with partial stats when indexing fails mid-way.
   * This lets the next run resume from where it left off (chunks without
   * embeddings are re-embedded, chunks with embeddings are kept).
   */
  private savePartialMetadata(
    filesIndexed: number,
    estimatedTokens: number,
    actualApiTokens: number,
    totalCost: number,
    startTime: number,
  ): void {
    this.metadata = {
      workspaceId: this.config.workspaceId,
      workspacePath: this.config.workspacePath,
      createdAt: this.metadata?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: "1.0.0",
      stats: {
        filesIndexed,
        chunksCount: this.chunks.size,
        totalTokens: actualApiTokens,
        estimatedTokens,
        embeddingsCount: this.vectorStore.size,
        totalCost,
        durationMs: Date.now() - startTime,
      },
      config: this.config,
    };
    this.saveMetadata();
  }

  private loadChunks(): void {
    const chunksPath = path.join(this.config.storagePath, "chunks.json");
    const result = loadAny<CodeChunk[]>(chunksPath);
    if (result) {
      try {
        for (const chunk of result.data) {
          this.chunks.set(chunk.id, chunk);
          this.hybridSearcher.registerChunk(chunk);
          this.verifier.registerChunk(chunk);
        }

        // Rehydrate embeddings from vector store (stripped in v2 saves)
        this.rehydrateEmbeddings();
      } catch (error) {
        console.debug("Failed to load chunks:", (error as Error).message);
      }
    }
  }

  /**
   * Rehydrate chunk.embedding from the vector store.
   * In v2 format, embeddings are stripped from chunks.json to avoid duplication.
   * The sync adapter reads chunk.embedding directly, so we restore them here.
   */
  private rehydrateEmbeddings(): void {
    for (const chunk of this.chunks.values()) {
      if (!chunk.embedding && this.vectorStore.has(chunk.id)) {
        const vector = this.vectorStore.getVector(chunk.id);
        if (vector) {
          chunk.embedding = vector;
        }
      }
    }
  }

  private saveChunks(): void {
    const chunksPath = path.join(this.config.storagePath, "chunks.json");
    // Strip embedding arrays — they're stored in the vector store
    const chunks = Array.from(this.chunks.values()).map(chunk => {
      const { embedding, ...rest } = chunk;
      return rest;
    });
    saveBest(chunksPath, chunks);
  }

  private loadFileHashes(): void {
    const hashesPath = path.join(this.config.storagePath, "file-hashes.json");
    const result = loadAny<Record<string, string>>(hashesPath);
    if (result) {
      try {
        for (const [file, hash] of Object.entries(result.data)) {
          this.fileHashes.set(file, hash);
        }
      } catch (error) {
        console.debug("Failed to load file hashes:", (error as Error).message);
      }
    }
  }

  private saveFileHashes(): void {
    const hashesPath = path.join(this.config.storagePath, "file-hashes.json");
    const hashes: Record<string, string> = {};
    for (const [file, hash] of this.fileHashes) {
      hashes[file] = hash;
    }
    // Small file — keep as JSON for human readability
    saveBest(hashesPath, hashes, { forceJson: true, prettyJson: true });
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createIndexManager(config: IndexManagerConfig): IndexManager {
  return new IndexManager(config);
}

// =============================================================================
// Re-exports
// =============================================================================

export { Chunker, createChunker } from "./chunker";
export { Embedder, createEmbedder, EmbeddingCacheManager } from "./embedder";
export { VectorStore, createVectorStore } from "./vector-store";
export { LexicalIndex, createLexicalIndex } from "./lexical-index";
export { HybridSearcher, createHybridSearcher } from "./hybrid-search";
export { CodeVerifier, createCodeVerifier } from "./verifier";
export { scanContent, formatInjectionWarning } from "./content-scanner";
export type { ScanResult, DetectedPattern, InjectionPatternType, PatternSeverity } from "./content-scanner";
export { scoreInjectionRisk } from "./injection-scorer";
export type { InjectionAssessment, ScoringFactor } from "./injection-scorer";
export { deriveHmacKey, signResultHmac, verifyResultHmac, signResponseHmac, verifyResponseHmac } from "./hmac";
export type { HmacSignature, SignedResult } from "./hmac";
export { buildDependencyGraph, dependencyGraphToArchgraphModel } from "./graph";
export type { FileNode, DependencyEdge, DependencyGraph, GraphOptions } from "./graph";
export * from "./types";
