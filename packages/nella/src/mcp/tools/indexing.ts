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
  scanContent,
  formatInjectionWarning,
} from "@usenella/core";
import type { IndexManagerConfig, IndexEvent } from "@usenella/core";
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

Options:
- force: Full reindex (ignores cache, re-embeds everything)
- paths: Only index specific files/directories

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
        },
      },
    },
    {
      name: "nella_search",
      description: `Search the indexed codebase using hybrid (semantic + lexical) search.

USE THIS FIRST when you need to find, understand, or locate code. This is faster and more token-efficient than grep/glob — one search replaces multiple manual lookups. Use it for:
- Finding where something is defined or implemented
- Understanding how a module or function works
- Locating code to modify or refactor
- Discovering patterns the codebase uses

Requires the workspace to be indexed first with nella_index.

Search modes:
- hybrid: Combines semantic and lexical search (default, best results)
- semantic: Vector similarity search (good for conceptual queries)
- lexical: BM25 keyword search (good for exact matches)

Returns matching code chunks with file paths, line numbers, and relevance scores.`,
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
          topK: {
            type: "number",
            description: "Number of results to return (default: 10)",
          },
          language: {
            type: "string",
            description: "Filter by programming language (e.g., 'typescript', 'python')",
          },
          filePattern: {
            type: "string",
            description: "Filter by file path pattern (e.g., 'src/components/**')",
          },
        },
        required: ["query"],
      },
    },
  ];
}

// =============================================================================
// Shared IndexManager cache
// =============================================================================

let cachedManager: ReturnType<typeof createIndexManager> | null = null;
let cachedWorkspacePath: string | null = null;

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
      model: "text-embedding-3-small",
      dimensions: 1536,
      apiKey: session.access_token,
      apiBase: "https://app.getnella.dev/api",
    };
  } else if (process.env.AZURE_EMBEDDING_API_KEY && process.env.AZURE_ENDPOINT) {
    embedderConfig = {
      provider: "azure",
      model: "text-embedding-3-small",
      dimensions: 1536,
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
      topK: 10,
    },
    include: DEFAULT_INDEX_CONFIG.include,
    exclude: [...DEFAULT_INDEX_CONFIG.exclude, "**/.nella/**"],
  };

  cachedManager = createIndexManager(config);
  cachedWorkspacePath = workspacePath;
  return cachedManager;
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

  const manager = await getOrCreateManager(context.workspacePath);

  try {
    const metadata = await manager.index({ force, paths });
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
  const topK = (args.topK as number) || 10;
  const language = args.language as string | undefined;
  const filePattern = args.filePattern as string | undefined;

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

    if (response.results.length === 0) {
      return {
        content: [{
          type: "text",
          text: `No results found for "${query}". Try broader terms, check spelling, or run nella_index if the workspace hasn't been indexed recently.`,
        }],
      };
    }

    // Build header with confidence guidance
    let header = `Found ${response.results.length} results for "${query}" (${response.searchTime}ms, confidence: ${(response.confidence * 100).toFixed(0)}%):`;

    if (response.suggestion === "low_confidence") {
      header += `\n> Low confidence results. Consider: (1) reindex with nella_index if files changed, (2) use more specific terms, (3) try mode: "lexical" for exact symbol matches.`;
    } else if (response.suggestion === "query_unclear") {
      header += `\n> Query may be too broad. Try searching for specific function names, class names, or file paths.`
    }
    const nonce = generateNonce();
    const totalResults = response.results.length;

    const wrappedResults: string[] = [];

    for (let i = 0; i < response.results.length; i++) {
      const result = response.results[i];
      const relPath = path.relative(context.workspacePath, result.chunk.filePath);
      const [startLine, endLine] = result.chunk.lines;
      const score = (result.score * 100).toFixed(1);
      const trustLevel = result.chunk.source?.trustLevel || "workspace";

      // L2: Scan content for injection patterns
      const scan = scanContent(result.chunk.content);
      const injectionWarning = formatInjectionWarning(scan);

      // Format the result content
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
        {
          filePath: relPath,
          lines: result.chunk.lines,
          trustLevel,
          resultIndex: i,
          totalResults,
          injectionWarning,
        },
        nonce,
        context.hmacKey,
      );

      wrappedResults.push(wrapped.content);
    }

    const output = wrapSearchResponse(header, wrappedResults, {
      sessionToken: context.sessionToken,
      hmacKey: context.hmacKey,
    });

    return {
      content: [{ type: "text", text: output }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Search failed: ${message}` }],
      isError: true,
    };
  }
}
