/**
 * Code Chunker
 *
 * AST-aware chunking for TypeScript/JavaScript code.
 * Falls back to recursive splitting for other file types.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { CodeChunk, ChunkType, CodeSymbol } from "./types";

// =============================================================================
// Configuration
// =============================================================================

export interface ChunkerConfig {
  maxTokens: number;
  minTokens: number;
  overlap: number;
  strategy: "ast" | "recursive" | "fixed";
}

const DEFAULT_CONFIG: ChunkerConfig = {
  maxTokens: 512,
  minTokens: 50,
  overlap: 50,
  strategy: "ast",
};

// Rough token estimate: ~4 chars per token
const CHARS_PER_TOKEN = 4;

// =============================================================================
// Chunker Class
// =============================================================================

export class Chunker {
  private config: ChunkerConfig;
  private chunkCounter: number = 0;

  constructor(config: Partial<ChunkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Chunk a file into code chunks
   */
  async chunkFile(filePath: string, content?: string): Promise<CodeChunk[]> {
    const fileContent = content ?? fs.readFileSync(filePath, "utf-8");
    const language = this.detectLanguage(filePath);

    // Choose strategy based on language and config
    if (this.config.strategy === "ast" && this.supportsAST(language)) {
      return this.astChunk(filePath, fileContent, language);
    } else if (this.config.strategy === "recursive" || language === "markdown") {
      return this.recursiveChunk(filePath, fileContent, language);
    } else {
      return this.fixedChunk(filePath, fileContent, language);
    }
  }

  /**
   * AST-based chunking for TypeScript/JavaScript
   */
  private async astChunk(filePath: string, content: string, language: string): Promise<CodeChunk[]> {
    const chunks: CodeChunk[] = [];
    const lines = content.split("\n");

    // Simple AST-like parsing without external dependencies
    // Extracts functions, classes, interfaces, types
    const patterns = this.getLanguagePatterns(language);

    let currentChunk: {
      startLine: number;
      endLine: number;
      type: ChunkType;
      symbols: CodeSymbol[];
      content: string[];
    } | null = null;

    let braceDepth = 0;
    let inMultiLineComment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Track multi-line comments
      if (trimmed.includes("/*") && !trimmed.includes("*/")) {
        inMultiLineComment = true;
      }
      if (trimmed.includes("*/")) {
        inMultiLineComment = false;
      }

      // Skip if in multi-line comment
      if (inMultiLineComment) {
        if (currentChunk) {
          currentChunk.content.push(line);
        }
        continue;
      }

      // Check for start of new construct
      let matched = false;
      for (const pattern of patterns) {
        const match = trimmed.match(pattern.regex);
        if (match) {
          // Save previous chunk if exists
          if (currentChunk && currentChunk.content.length > 0) {
            chunks.push(this.createChunk(filePath, currentChunk, language));
          }

          // Start new chunk
          currentChunk = {
            startLine: i + 1,
            endLine: i + 1,
            type: pattern.type,
            symbols: [{
              name: match[1] || "anonymous",
              kind: pattern.symbolKind,
              signature: trimmed,
              exported: trimmed.startsWith("export"),
            }],
            content: [line],
          };

          braceDepth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
          matched = true;
          break;
        }
      }

      if (!matched && currentChunk) {
        // Continue current chunk
        currentChunk.content.push(line);
        currentChunk.endLine = i + 1;

        // Track brace depth
        braceDepth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

        // End chunk when braces close
        if (braceDepth <= 0 && currentChunk.content.length > 1) {
          chunks.push(this.createChunk(filePath, currentChunk, language));
          currentChunk = null;
          braceDepth = 0;
        }
      } else if (!matched && !currentChunk) {
        // Handle standalone code (imports, top-level statements)
        if (trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("*")) {
          currentChunk = {
            startLine: i + 1,
            endLine: i + 1,
            type: this.detectChunkType(trimmed),
            symbols: this.extractSymbols(trimmed),
            content: [line],
          };
        }
      }

      // Check if chunk is too large
      if (currentChunk) {
        const tokens = this.estimateTokens(currentChunk.content.join("\n"));
        if (tokens > this.config.maxTokens) {
          chunks.push(this.createChunk(filePath, currentChunk, language));
          currentChunk = null;
          braceDepth = 0;
        }
      }
    }

    // Save final chunk
    if (currentChunk && currentChunk.content.length > 0) {
      chunks.push(this.createChunk(filePath, currentChunk, language));
    }

    // Merge small chunks
    return this.mergeSmallChunks(chunks);
  }

  /**
   * Recursive splitting for prose/markdown
   */
  private recursiveChunk(filePath: string, content: string, language: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const splitters = language === "markdown"
      ? ["\n## ", "\n### ", "\n#### ", "\n\n", "\n"]
      : ["\n\n\n", "\n\n", "\n"];

    const splitRecursive = (text: string, splitterIndex: number, startLine: number): void => {
      if (splitterIndex >= splitters.length) {
        // Final split by line
        const lines = text.split("\n");
        let currentLines: string[] = [];
        let currentStartLine = startLine;

        for (let i = 0; i < lines.length; i++) {
          currentLines.push(lines[i]);
          if (this.estimateTokens(currentLines.join("\n")) >= this.config.maxTokens) {
            chunks.push(this.createChunkFromText(
              filePath,
              currentLines.join("\n"),
              language,
              currentStartLine,
              currentStartLine + currentLines.length - 1
            ));
            currentStartLine = startLine + i + 1;
            currentLines = [];
          }
        }

        if (currentLines.length > 0) {
          chunks.push(this.createChunkFromText(
            filePath,
            currentLines.join("\n"),
            language,
            currentStartLine,
            currentStartLine + currentLines.length - 1
          ));
        }
        return;
      }

      const splitter = splitters[splitterIndex];
      const parts = text.split(splitter);

      let lineOffset = startLine;
      for (const part of parts) {
        if (!part.trim()) {
          lineOffset += (part.match(/\n/g) || []).length + 1;
          continue;
        }

        const tokens = this.estimateTokens(part);
        if (tokens <= this.config.maxTokens) {
          const lineCount = (part.match(/\n/g) || []).length + 1;
          chunks.push(this.createChunkFromText(
            filePath,
            splitterIndex > 0 ? splitter.trim() + part : part,
            language,
            lineOffset,
            lineOffset + lineCount - 1
          ));
          lineOffset += lineCount;
        } else {
          splitRecursive(part, splitterIndex + 1, lineOffset);
          lineOffset += (part.match(/\n/g) || []).length + 1;
        }
      }
    };

    splitRecursive(content, 0, 1);
    return chunks;
  }

  /**
   * Fixed-size chunking with overlap
   */
  private fixedChunk(filePath: string, content: string, language: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split("\n");
    const maxLines = Math.floor((this.config.maxTokens * CHARS_PER_TOKEN) / 80); // Assume 80 chars/line
    const overlapLines = Math.floor((this.config.overlap * CHARS_PER_TOKEN) / 80);

    for (let i = 0; i < lines.length; i += maxLines - overlapLines) {
      const chunkLines = lines.slice(i, i + maxLines);
      if (chunkLines.length > 0) {
        chunks.push(this.createChunkFromText(
          filePath,
          chunkLines.join("\n"),
          language,
          i + 1,
          i + chunkLines.length
        ));
      }
    }

    return chunks;
  }

  /**
   * Create a chunk from parsed content
   */
  private createChunk(
    filePath: string,
    data: {
      startLine: number;
      endLine: number;
      type: ChunkType;
      symbols: CodeSymbol[];
      content: string[];
    },
    language: string
  ): CodeChunk {
    const content = data.content.join("\n");
    const id = `chunk_${this.chunkCounter++}_${crypto.createHash("md5").update(content).digest("hex").slice(0, 8)}`;

    return {
      id,
      filePath,
      content,
      lines: [data.startLine, data.endLine],
      type: data.type,
      language,
      symbols: data.symbols,
      imports: this.extractImports(content),
      exports: this.extractExports(content),
      hash: crypto.createHash("sha256").update(content).digest("hex"),
      tokens: this.estimateTokens(content),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Create a chunk from raw text
   */
  private createChunkFromText(
    filePath: string,
    content: string,
    language: string,
    startLine: number,
    endLine: number
  ): CodeChunk {
    const id = `chunk_${this.chunkCounter++}_${crypto.createHash("md5").update(content).digest("hex").slice(0, 8)}`;

    return {
      id,
      filePath,
      content,
      lines: [startLine, endLine],
      type: this.detectChunkType(content),
      language,
      symbols: this.extractSymbols(content),
      imports: this.extractImports(content),
      exports: this.extractExports(content),
      hash: crypto.createHash("sha256").update(content).digest("hex"),
      tokens: this.estimateTokens(content),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Merge chunks that are too small
   */
  private mergeSmallChunks(chunks: CodeChunk[]): CodeChunk[] {
    const merged: CodeChunk[] = [];
    let buffer: CodeChunk | null = null;

    for (const chunk of chunks) {
      if (chunk.tokens < this.config.minTokens) {
        if (buffer) {
          // Merge with buffer
          buffer = {
            ...buffer,
            content: buffer.content + "\n\n" + chunk.content,
            lines: [buffer.lines[0], chunk.lines[1]],
            symbols: [...buffer.symbols, ...chunk.symbols],
            imports: [...(buffer.imports || []), ...(chunk.imports || [])],
            exports: [...(buffer.exports || []), ...(chunk.exports || [])],
            hash: crypto.createHash("sha256").update(buffer.content + "\n\n" + chunk.content).digest("hex"),
            tokens: this.estimateTokens(buffer.content + "\n\n" + chunk.content),
            updatedAt: new Date().toISOString(),
          };
        } else {
          buffer = chunk;
        }
      } else {
        if (buffer) {
          merged.push(buffer);
          buffer = null;
        }
        merged.push(chunk);
      }

      // Flush buffer if it's large enough
      if (buffer && buffer.tokens >= this.config.minTokens) {
        merged.push(buffer);
        buffer = null;
      }
    }

    if (buffer) {
      merged.push(buffer);
    }

    return merged;
  }

  // =============================================================================
  // Helper Methods
  // =============================================================================

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".js": "javascript",
      ".jsx": "javascript",
      ".py": "python",
      ".java": "java",
      ".go": "go",
      ".rs": "rust",
      ".md": "markdown",
      ".json": "json",
      ".yaml": "yaml",
      ".yml": "yaml",
    };
    return langMap[ext] || "plaintext";
  }

  private supportsAST(language: string): boolean {
    return ["typescript", "javascript"].includes(language);
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  private getLanguagePatterns(language: string): { regex: RegExp; type: ChunkType; symbolKind: CodeSymbol["kind"] }[] {
    if (language === "typescript" || language === "javascript") {
      return [
        { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, type: "function", symbolKind: "function" },
        { regex: /^(?:export\s+)?class\s+(\w+)/, type: "class", symbolKind: "class" },
        { regex: /^(?:export\s+)?interface\s+(\w+)/, type: "interface", symbolKind: "interface" },
        { regex: /^(?:export\s+)?type\s+(\w+)/, type: "type", symbolKind: "type" },
        { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/, type: "function", symbolKind: "function" },
        { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function/, type: "function", symbolKind: "function" },
      ];
    }
    return [];
  }

  private detectChunkType(content: string): ChunkType {
    const trimmed = content.trim();
    if (trimmed.match(/^(?:export\s+)?(?:async\s+)?function/)) return "function";
    if (trimmed.match(/^(?:export\s+)?class/)) return "class";
    if (trimmed.match(/^(?:export\s+)?interface/)) return "interface";
    if (trimmed.match(/^(?:export\s+)?type/)) return "type";
    if (trimmed.match(/^import/)) return "module";
    if (trimmed.startsWith("#") || trimmed.startsWith("/**")) return "doc";
    if (trimmed.startsWith("//") || trimmed.startsWith("/*")) return "comment";
    return "other";
  }

  private extractSymbols(content: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Function
      const funcMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      if (funcMatch) {
        symbols.push({ name: funcMatch[1], kind: "function", exported: trimmed.startsWith("export") });
      }

      // Class
      const classMatch = trimmed.match(/^(?:export\s+)?class\s+(\w+)/);
      if (classMatch) {
        symbols.push({ name: classMatch[1], kind: "class", exported: trimmed.startsWith("export") });
      }

      // Interface
      const interfaceMatch = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/);
      if (interfaceMatch) {
        symbols.push({ name: interfaceMatch[1], kind: "interface", exported: trimmed.startsWith("export") });
      }

      // Type
      const typeMatch = trimmed.match(/^(?:export\s+)?type\s+(\w+)/);
      if (typeMatch) {
        symbols.push({ name: typeMatch[1], kind: "type", exported: trimmed.startsWith("export") });
      }

      // Const function
      const constFuncMatch = trimmed.match(/^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/);
      if (constFuncMatch) {
        symbols.push({ name: constFuncMatch[1], kind: "function", exported: trimmed.startsWith("export") });
      }
    }

    return symbols;
  }

  private extractImports(content: string): string[] {
    const imports: string[] = [];
    const importRegex = /import\s+(?:{[^}]+}|[\w\s,*]+)\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
    return imports;
  }

  private extractExports(content: string): string[] {
    const exports: string[] = [];
    const exportRegex = /export\s+(?:default\s+)?(?:const|function|class|interface|type)\s+(\w+)/g;
    let match;
    while ((match = exportRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }
    return exports;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createChunker(config?: Partial<ChunkerConfig>): Chunker {
  return new Chunker(config);
}
