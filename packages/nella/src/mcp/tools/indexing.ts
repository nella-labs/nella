/**
 * Indexing Tools
 *
 * MCP tools for indexing the workspace codebase and searching indexed content.
 */

import * as path from "path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  createIndexManager,
  DEFAULT_INDEX_CONFIG,
  DEFAULT_EMBEDDING_MODEL,
  MODEL_DIMENSIONS,
  scanContent,
  formatInjectionWarning,
  BranchIndexManager,
  gitUtils,
} from "@usenella/core";
import type { IndexManagerConfig, IndexEvent, BranchIndexInfo } from "@usenella/core";
import type { ServerContext } from "../server";
import { getValidSession } from "../../auth";
import {
  generateNonce,
  wrapSearchResult,
  wrapSearchResponse,
} from "./result-isolation";

// =============================================================================
// Tool Definitions
// =============================================================================

export function registerIndexingTools(): Tool[] {
  return [
    {
      name: "nella_index",
      description: `Index or re-index the workspace codebase for search and code verification.

Run this when:
- Starting work on a new project
- Files have changed significantly
- You need to search the codebase with nella_search

Automatically respects .gitignore and .nellaignore files. Use the exclude parameter for one-off exclusions.

Returns stats on files indexed, chunks created, and embeddings generated.`,
      inputSchema: {
        type: "object",
        properties: {
          force: {
            type: "boolean",
            description: "Force full reindex, ignoring cached embeddings (default: false)",
          },
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Specific file or directory paths to index (default: entire workspace)",
          },
          exclude: {
            type: "array",
            items: { type: "string" },
            description: "Additional glob patterns to exclude (e.g., ['**/tests/**', '**/docs/**']). Merged with .gitignore and .nellaignore.",
          },
          branch: {
            type: "string",
            description: "Git branch to index. If omitted, indexes the current branch. For non-default branches, only changed files are indexed (overlay model).",
          },
        },
      },
    },
    {
      name: "nella_search",
      description: `Search the indexed codebase using hybrid (semantic + lexical) search.

Returns ranked results with file paths, line numbers, and symbols. Default compact mode returns only metadata (~300 tokens for 5 results). Use detail: "full" to include code blocks.

Best for:
- Finding where something is defined or implemented
- Understanding module/function relationships
- Locating code patterns across the codebase

Requires nella_index to have been run first.

Search modes:
- hybrid: Combines semantic and lexical search (default, best results)
- semantic: Vector similarity search (good for conceptual queries)
- lexical: BM25 keyword search (good for exact matches)`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (natural language or code pattern)",
          },
          mode: {
            type: "string",
            enum: ["hybrid", "semantic", "lexical"],
            description: "Search mode (default: hybrid)",
          },
          detail: {
            type: "string",
            enum: ["compact", "full"],
            description: "Output detail level. 'compact' (default): file paths, line ranges, symbols, and scores — no code blocks. 'full': includes full code chunks.",
          },
          topK: {
            type: "number",
            description: "Number of results to return (default: 5)",
          },
          language: {
            type: "string",
            description: "Filter by programming language (e.g., 'typescript', 'python')",
          },
          filePattern: {
            type: "string",
            description: "Filter by file path pattern (e.g., 'src/components/**')",
          },
          branch: {
            type: "string",
            description: "Git branch to search. Searches the branch overlay + parent. If omitted, searches the current branch.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "nella_branch_info",
      description: `Get branch indexing information for the workspace.

Returns the current git branch, default branch, and all branch indexes with their status, stats, and parent relationships. Useful for understanding which branches have been indexed.`,
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ];
}

// =============================================================================
// Shared IndexManager / BranchIndexManager cache
// =============================================================================

let cachedManager: ReturnType<typeof createIndexManager> | null = null;
let cachedWorkspacePath: string | null = null;
let cachedBranchManager: BranchIndexManager | null = null;
let cachedBranchWorkspacePath: string | null = null;

async function getOrCreateManager(workspacePath: string): Promise<ReturnType<typeof createIndexManager>> {
  if (cachedManager && cachedWorkspacePath === workspacePath) {
    return cachedManager;
  }

  const workspaceId = path.basename(workspacePath);
  const storagePath = path.join(workspacePath, ".nella", "index");

  // Use Nella cloud embeddings when authenticated, fall back to Azure (requires env vars)
  const session = await getValidSession();
  let embedderConfig: IndexManagerConfig["embedder"];
  if (session) {
    embedderConfig = {
      provider: "nella",
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: MODEL_DIMENSIONS[DEFAULT_EMBEDDING_MODEL],
      apiKey: session.access_token,
      apiBase: "https://app.getnella.dev/api",
    };
  } else if (process.env.AZURE_EMBEDDING_API_KEY && process.env.AZURE_ENDPOINT) {
    embedderConfig = {
      provider: "azure",
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: MODEL_DIMENSIONS[DEFAULT_EMBEDDING_MODEL],
    };
  } else {
    throw new Error(
      "No embedding provider configured. Either run 'nella auth login' for cloud embeddings, " +
      "or set AZURE_EMBEDDING_API_KEY and AZURE_ENDPOINT environment variables.",
    );
  }

  const config: IndexManagerConfig = {
    workspaceId,
    workspacePath,
    storagePath,
    chunking: {
      maxTokens: 512,
      overlap: 50,
      strategy: "ast",
    },
    embedder: embedderConfig,
    search: {
      vectorWeight: 0.4,
      lexicalWeight: 0.6,
      rerankEnabled: true,
      topK: 5,
    },
    include: DEFAULT_INDEX_CONFIG.include,
    exclude: [...DEFAULT_INDEX_CONFIG.exclude, "**/.nella/**"],
  };

  cachedManager = createIndexManager(config);
  cachedWorkspacePath = workspacePath;
  return cachedManager;
}

async function getOrCreateBranchManager(workspacePath: string): Promise<BranchIndexManager> {
  if (cachedBranchManager && cachedBranchWorkspacePath === workspacePath) {
    return cachedBranchManager;
  }

  const isRepo = await gitUtils.isGitRepo(workspacePath);
  if (!isRepo) {
    throw new Error("Workspace is not a git repository. Branch operations require git.");
  }

  const defaultBranch = await gitUtils.getDefaultBranch(workspacePath);
  const storagePath = path.join(workspacePath, ".nella", "index");

  // Resolve embedder config
  const session = await getValidSession();
  let embedderConfig: IndexManagerConfig["embedder"];
  if (session) {
    embedderConfig = {
      provider: "nella",
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: MODEL_DIMENSIONS[DEFAULT_EMBEDDING_MODEL],
      apiKey: session.access_token,
      apiBase: "https://app.getnella.dev/api",
    };
  } else if (process.env.AZURE_EMBEDDING_API_KEY && process.env.AZURE_ENDPOINT) {
    embedderConfig = {
      provider: "azure",
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: MODEL_DIMENSIONS[DEFAULT_EMBEDDING_MODEL],
    };
  } else {
    throw new Error(
      "No embedding provider configured. Run 'nella auth login' or set AZURE_EMBEDDING_API_KEY.",
    );
  }

  cachedBranchManager = new BranchIndexManager({
    workspaceId: path.basename(workspacePath),
    workspacePath,
    baseStoragePath: storagePath,
    defaultBranch,
    indexConfig: {
      ...DEFAULT_INDEX_CONFIG,
      chunking: { maxTokens: 512, overlap: 50, strategy: "ast" },
      embedder: embedderConfig,
      search: { vectorWeight: 0.4, lexicalWeight: 0.6, rerankEnabled: true, topK: 5 },
      exclude: [...DEFAULT_INDEX_CONFIG.exclude, "**/.nella/**"],
    },
  });
  cachedBranchWorkspacePath = workspacePath;
  return cachedBranchManager;
}

// =============================================================================
// Tool Handler
// =============================================================================

export async function handleIndexingTool(
  name: string,
  args: Record<string, unknown>,
  context: ServerContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean } | null> {
  switch (name) {
    case "nella_index":
      return handleIndex(args, context);
    case "nella_search":
      return handleSearch(args, context);
    case "nella_branch_info":
      return handleBranchInfo(context);
    default:
      return null;
  }
}

// =============================================================================
// Index Handler
// =============================================================================

async function handleIndex(
  args: Record<string, unknown>,
  context: ServerContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const force = (args.force as boolean) || false;
  const paths = args.paths as string[] | undefined;
  const exclude = args.exclude as string[] | undefined;
  const branch = args.branch as string | undefined;

  try {
    // Branch-aware indexing when branch is specified or workspace is a git repo
    if (branch || await gitUtils.isGitRepo(context.workspacePath)) {
      const branchManager = await getOrCreateBranchManager(context.workspacePath);
      const targetBranch = branch || await branchManager.detectCurrentBranch();
      const metadata = await branchManager.indexBranch(targetBranch, { force, paths, exclude });
      const stats = metadata.stats;

      return {
        content: [{
          type: "text",
          text: [
            `Index complete (branch: ${targetBranch}).`,
            ``,
            `- Files indexed: ${stats.filesIndexed}`,
            `- Chunks created: ${stats.chunksCount}`,
            `- Embeddings: ${stats.embeddingsCount}`,
            `- Tokens processed: ${stats.totalTokens}`,
            metadata.branchId ? `- Branch overlay: ${metadata.branchId} (parent: ${metadata.parentBranchId || "none"})` : "",
            ``,
            `Storage: ${path.join(context.workspacePath, ".nella", "index")}`,
          ].filter(Boolean).join("\n"),
        }],
      };
    }

    // Non-git fallback: original flat index behavior
    const manager = await getOrCreateManager(context.workspacePath);
    const metadata = await manager.index({ force, paths, exclude });
    const stats = metadata.stats;

    return {
      content: [{
        type: "text",
        text: [
          `Index complete.`,
          ``,
          `- Files indexed: ${stats.filesIndexed}`,
          `- Chunks created: ${stats.chunksCount}`,
          `- Embeddings: ${stats.embeddingsCount}`,
          `- Tokens processed: ${stats.totalTokens}`,
          ``,
          `Storage: ${path.join(context.workspacePath, ".nella", "index")}`,
        ].join("\n"),
      }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Indexing failed: ${message}` }],
      isError: true,
    };
  }
}

// =============================================================================
// Search Handler
// =============================================================================

async function handleSearch(
  args: Record<string, unknown>,
  context: ServerContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const query = args.query as string;
  const mode = (args.mode as "hybrid" | "semantic" | "lexical") || "hybrid";
  const detail = (args.detail as "compact" | "full") || "compact";
  const topK = (args.topK as number) || 5;
  const language = args.language as string | undefined;
  const filePattern = args.filePattern as string | undefined;
  const branch = args.branch as string | undefined;

  // Branch-aware search
  if (branch || await gitUtils.isGitRepo(context.workspacePath)) {
    try {
      const branchManager = await getOrCreateBranchManager(context.workspacePath);
      const targetBranch = branch || await branchManager.detectCurrentBranch();
      // Delegate to branch search handler below
      const searchQuery = {
        query, mode, limit: topK,
        filter: {
          fileTypes: language ? [language] : undefined,
          paths: filePattern ? [filePattern] : undefined,
        },
      };
      const response = await branchManager.searchBranch(targetBranch, searchQuery);
      // Fall through to shared formatting below (response variable reused)
      return formatSearchResponse(response, query, detail, context);
    } catch {
      // If branch search fails (e.g., no index), fall back to flat manager
    }
  }

  const manager = await getOrCreateManager(context.workspacePath);
  const status = manager.getStatus();

  if (!status.ready) {
    return {
      content: [{
        type: "text",
        text: "Index is empty. Run nella_index first to index the workspace.",
      }],
      isError: true,
    };
  }

  try {
    const response = await manager.search({
      query,
      mode,
      limit: topK,
      filter: {
        fileTypes: language ? [language] : undefined,
        paths: filePattern ? [filePattern] : undefined,
      },
    });

    return formatSearchResponse(response, query, detail, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Search failed: ${message}` }],
      isError: true,
    };
  }
}

// =============================================================================
// Search Response Formatter (shared by flat and branch search)
// =============================================================================

function formatSearchResponse(
  response: import("@usenella/core").SearchResponse,
  query: string,
  detail: "compact" | "full",
  context: ServerContext,
): { content: Array<{ type: "text"; text: string }> } {
  if (response.results.length === 0) {
    return {
      content: [{
        type: "text",
        text: `No results found for "${query}". Try broader terms, check spelling, or run nella_index if the workspace hasn't been indexed recently.`,
      }],
    };
  }

  let header = `Found ${response.results.length} results for "${query}" (${response.searchTime}ms, ${(response.confidence * 100).toFixed(0)}%):`;
  if (response.suggestion === "low_confidence") {
    header += `\n> Low confidence. Try: reindex, more specific terms, or mode: "lexical".`;
  } else if (response.suggestion === "query_unclear") {
    header += `\n> Query may be too broad. Try specific function/class names.`;
  }

  if (detail === "compact") {
    const lines: string[] = [];
    for (let i = 0; i < response.results.length; i++) {
      const result = response.results[i];
      const relPath = path.relative(context.workspacePath, result.chunk.filePath);
      const [startLine, endLine] = result.chunk.lines;
      const score = (result.score * 100).toFixed(1);
      const symbolNames = result.chunk.symbols.map((s) => s.name).join(", ");
      const symbolKinds = [...new Set(result.chunk.symbols.map((s) => s.kind))].join(", ");
      const symbolSuffix = symbolNames ? ` — ${symbolNames} [${symbolKinds}]` : "";
      lines.push(`${i + 1}. ${relPath}:${startLine}-${endLine} (${score}%)${symbolSuffix}`);
    }

    const output = wrapSearchResponse(header, lines, {
      sessionToken: context.sessionToken,
      hmacKey: context.hmacKey,
      compact: true,
    });
    return { content: [{ type: "text", text: output }] };
  }

  // Full mode
  const nonce = generateNonce();
  const totalResults = response.results.length;
  const wrappedResults: string[] = [];

  for (let i = 0; i < response.results.length; i++) {
    const result = response.results[i];
    const relPath = path.relative(context.workspacePath, result.chunk.filePath);
    const [startLine, endLine] = result.chunk.lines;
    const score = (result.score * 100).toFixed(1);
    const trustLevel = result.chunk.source?.trustLevel || "workspace";
    const scan = scanContent(result.chunk.content);
    const injectionWarning = formatInjectionWarning(scan);

    const resultLines: string[] = [];
    resultLines.push(`## ${relPath}:${startLine}-${endLine} (${score}% match)`);
    resultLines.push(`Type: ${result.chunk.type} | Language: ${result.chunk.language}`);
    if (result.chunk.symbols.length > 0) {
      resultLines.push(`Symbols: ${result.chunk.symbols.map((s) => s.name).join(", ")}`);
    }
    resultLines.push("```" + result.chunk.language);
    resultLines.push(result.chunk.content);
    resultLines.push("```");

    const wrapped = wrapSearchResult(
      resultLines.join("\n"),
      { filePath: relPath, lines: result.chunk.lines, trustLevel, resultIndex: i, totalResults, injectionWarning },
      nonce,
      context.hmacKey,
    );
    wrappedResults.push(wrapped.content);
  }

  const output = wrapSearchResponse(header, wrappedResults, {
    sessionToken: context.sessionToken,
    hmacKey: context.hmacKey,
  });
  return { content: [{ type: "text", text: output }] };
}

// =============================================================================
// Branch Info Handler
// =============================================================================

async function handleBranchInfo(
  context: ServerContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const isRepo = await gitUtils.isGitRepo(context.workspacePath);
    if (!isRepo) {
      return {
        content: [{
          type: "text",
          text: "Not a git repository. Branch indexing is not available.",
        }],
      };
    }

    const currentBranch = await gitUtils.getCurrentBranch(context.workspacePath);
    const defaultBranch = await gitUtils.getDefaultBranch(context.workspacePath);
    const remoteUrl = await gitUtils.getRemoteUrl(context.workspacePath);

    const branchManager = await getOrCreateBranchManager(context.workspacePath);
    const branches = branchManager.listBranches();

    const lines: string[] = [
      `Git Branch Info`,
      ``,
      `- Current branch: ${currentBranch}`,
      `- Default branch: ${defaultBranch}`,
      remoteUrl ? `- Remote: ${remoteUrl}` : `- Remote: (none)`,
      ``,
      `Branch Indexes (${branches.length}):`,
    ];

    for (const info of branches) {
      const current = info.name === currentBranch ? " *" : "";
      const parent = info.parentBranch !== info.name ? ` (parent: ${info.parentBranch})` : "";
      lines.push(`- ${info.name}${current}: ${info.indexStatus} | ${info.stats.filesIndexed} files, ${info.stats.chunksCount} chunks${parent}`);
    }

    if (branches.length === 0) {
      lines.push(`  (none — run nella_index to create one)`);
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Branch info failed: ${message}` }],
      isError: true,
    };
  }
}
