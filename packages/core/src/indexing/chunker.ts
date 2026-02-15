/**
 * Code Chunker
 *
 * Real AST-aware chunking for TypeScript/JavaScript using @typescript-eslint/parser.
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
  includeComments: boolean;
  includeJSDoc: boolean;
}

const DEFAULT_CONFIG: ChunkerConfig = {
  maxTokens: 512,
  minTokens: 50,
  overlap: 50,
  strategy: "ast",
  includeComments: true,
  includeJSDoc: true,
};

// Rough token estimate: ~4 chars per token
const CHARS_PER_TOKEN = 4;

// =============================================================================
// AST Node Types we care about
// =============================================================================

type ASTNode = {
  type: string;
  loc?: { start: { line: number }; end: { line: number } };
  range?: [number, number];
  id?: { name: string } | null;
  key?: { name?: string; value?: string };
  name?: string;
  body?: ASTNode | ASTNode[];
  declaration?: ASTNode;
  declarations?: ASTNode[];
  init?: ASTNode;
  exported?: boolean;
  async?: boolean;
  params?: ASTNode[];
  leadingComments?: ASTComment[];
  comments?: ASTComment[];
};

type ASTComment = {
  type: string;
  value: string;
  loc?: { start: { line: number }; end: { line: number } };
};

// =============================================================================
// TypeScript AST Parser Wrapper
// =============================================================================

class TypeScriptASTParser {
  private parser: any = null;
  private available: boolean = false;

  constructor() {
    try {
      this.parser = require("@typescript-eslint/typescript-estree");
      this.available = true;
    } catch {
      // Parser not available, will use fallback
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  parse(code: string, isTypeScript: boolean): { ast: ASTNode; comments: ASTComment[] } | null {
    if (!this.available || !this.parser) {
      return null;
    }

    try {
      const ast = this.parser.parse(code, {
        loc: true,
        range: true,
        comment: true,
        jsx: true,
        errorOnUnknownASTType: false,
        useJSXTextNode: true,
      });

      return {
        ast: ast as ASTNode,
        comments: (ast.comments || []) as ASTComment[],
      };
    } catch (error) {
      // Parse error - return null to trigger fallback
      return null;
    }
  }
}

// =============================================================================
// Chunker Class
// =============================================================================

export class Chunker {
  private config: ChunkerConfig;
  private chunkCounter: number = 0;
  private astParser: TypeScriptASTParser;

  constructor(config: Partial<ChunkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.astParser = new TypeScriptASTParser();
  }

  /**
   * Chunk a file into code chunks
   */
  async chunkFile(filePath: string, content?: string): Promise<CodeChunk[]> {
    const fileContent = content ?? fs.readFileSync(filePath, "utf-8");
    const language = this.detectLanguage(filePath);

    // Choose strategy based on language and config
    if (this.config.strategy === "ast" && this.supportsAST(language)) {
      const astChunks = this.astChunk(filePath, fileContent, language);
      if (astChunks.length > 0) {
        return astChunks;
      }
      // Fallback if AST parsing fails
      return this.recursiveChunk(filePath, fileContent, language);
    } else if (this.config.strategy === "recursive" || language === "markdown") {
      return this.recursiveChunk(filePath, fileContent, language);
    } else {
      return this.fixedChunk(filePath, fileContent, language);
    }
  }

  /**
   * Real AST-based chunking for TypeScript/JavaScript
   */
  private astChunk(filePath: string, content: string, language: string): CodeChunk[] {
    const isTypeScript = language === "typescript";
    const parseResult = this.astParser.parse(content, isTypeScript);

    if (!parseResult) {
      // Parser not available or parse error - use fallback
      return this.regexAstChunk(filePath, content, language);
    }

    const { ast, comments } = parseResult;
    const lines = content.split("\n");
    const chunks: CodeChunk[] = [];

    // Build comment map (line -> comments)
    const commentsByLine = new Map<number, ASTComment[]>();
    for (const comment of comments) {
      if (comment.loc) {
        const line = comment.loc.start.line;
        if (!commentsByLine.has(line)) {
          commentsByLine.set(line, []);
        }
        commentsByLine.get(line)!.push(comment);
      }
    }

    // Extract top-level declarations
    const body = Array.isArray(ast.body) ? ast.body : [ast.body].filter(Boolean);

    for (const node of body) {
      if (!node) continue;

      const extracted = this.extractChunkFromNode(node, lines, commentsByLine, filePath, language);
      if (extracted) {
        chunks.push(...extracted);
      }
    }

    // Handle remaining code (imports grouped, etc.)
    const coveredLines = new Set<number>();
    for (const chunk of chunks) {
      for (let i = chunk.lines[0]; i <= chunk.lines[1]; i++) {
        coveredLines.add(i);
      }
    }

    // Extract uncovered imports as a single chunk
    const importLines: number[] = [];
    for (const node of body) {
      if (node && node.type === "ImportDeclaration" && node.loc) {
        for (let i = node.loc.start.line; i <= node.loc.end.line; i++) {
          if (!coveredLines.has(i)) {
            importLines.push(i);
          }
        }
      }
    }

    if (importLines.length > 0) {
      const startLine = Math.min(...importLines);
      const endLine = Math.max(...importLines);
      const importContent = lines.slice(startLine - 1, endLine).join("\n");
      chunks.unshift(this.createChunkFromText(filePath, importContent, language, startLine, endLine, "module", []));
    }

    // Merge small chunks and return
    return this.mergeSmallChunks(chunks);
  }

  /**
   * Extract chunk(s) from an AST node
   */
  private extractChunkFromNode(
    node: ASTNode,
    lines: string[],
    commentsByLine: Map<number, ASTComment[]>,
    filePath: string,
    language: string
  ): CodeChunk[] | null {
    if (!node.loc) return null;

    const startLine = node.loc.start.line;
    const endLine = node.loc.end.line;
    const chunks: CodeChunk[] = [];

    // Determine chunk type and extract symbols
    let chunkType: ChunkType = "other";
    const symbols: CodeSymbol[] = [];
    let isExported = false;

    switch (node.type) {
      case "FunctionDeclaration":
        chunkType = "function";
        if (node.id?.name) {
          symbols.push({
            name: node.id.name,
            kind: "function",
            signature: this.getFunctionSignature(node, lines),
            exported: false,
          });
        }
        break;

      case "ClassDeclaration":
        chunkType = "class";
        if (node.id?.name) {
          symbols.push({
            name: node.id.name,
            kind: "class",
            exported: false,
          });
        }
        // Extract class methods as separate chunks if class is large
        const classChunks = this.extractClassMembers(node, lines, commentsByLine, filePath, language);
        if (classChunks.length > 0) {
          chunks.push(...classChunks);
          return chunks;
        }
        break;

      case "TSInterfaceDeclaration":
        chunkType = "interface";
        if (node.id?.name) {
          symbols.push({
            name: node.id.name,
            kind: "interface",
            exported: false,
          });
        }
        break;

      case "TSTypeAliasDeclaration":
        chunkType = "type";
        if (node.id?.name) {
          symbols.push({
            name: node.id.name,
            kind: "type",
            exported: false,
          });
        }
        break;

      case "VariableDeclaration":
        // Check if it's an arrow function or object
        if (node.declarations && node.declarations.length > 0) {
          const decl = node.declarations[0];
          if (decl.init) {
            if (decl.init.type === "ArrowFunctionExpression" || decl.init.type === "FunctionExpression") {
              chunkType = "function";
              if (decl.id && "name" in decl.id) {
                symbols.push({
                  name: decl.id.name as string,
                  kind: "function",
                  signature: this.getArrowSignature(decl, lines),
                  exported: false,
                });
              }
            } else if (decl.init.type === "ObjectExpression") {
              chunkType = "other";
              if (decl.id && "name" in decl.id) {
                symbols.push({
                  name: decl.id.name as string,
                  kind: "variable",
                  exported: false,
                });
              }
            }
          }
        }
        break;

      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
        isExported = true;
        if (node.declaration) {
          const innerChunks = this.extractChunkFromNode(
            { ...node.declaration, exported: true } as ASTNode,
            lines,
            commentsByLine,
            filePath,
            language
          );
          if (innerChunks) {
            for (const chunk of innerChunks) {
              chunk.symbols = chunk.symbols.map((s) => ({ ...s, exported: true }));
            }
            return innerChunks;
          }
        }
        return null;

      case "ImportDeclaration":
        // Skip - handled separately
        return null;

      default:
        // Skip other node types
        return null;
    }

    // Get leading JSDoc comment
    let actualStartLine = startLine;
    if (this.config.includeJSDoc) {
      const leadingComments = commentsByLine.get(startLine - 1) || [];
      for (const comment of leadingComments) {
        if (comment.type === "Block" && comment.value.startsWith("*") && comment.loc) {
          actualStartLine = Math.min(actualStartLine, comment.loc.start.line);
        }
      }
      // Check a few lines above for JSDoc
      for (let i = startLine - 1; i >= Math.max(1, startLine - 10); i--) {
        const lineComments = commentsByLine.get(i);
        if (lineComments) {
          for (const comment of lineComments) {
            if (comment.type === "Block" && comment.value.startsWith("*") && comment.loc) {
              actualStartLine = Math.min(actualStartLine, comment.loc.start.line);
            }
          }
        }
      }
    }

    // Extract content
    const chunkContent = lines.slice(actualStartLine - 1, endLine).join("\n");

    // Check if too large - split if needed
    const tokens = this.estimateTokens(chunkContent);
    if (tokens > this.config.maxTokens && chunkType === "class") {
      // Split large classes
      return this.extractClassMembers(node, lines, commentsByLine, filePath, language);
    }

    chunks.push(this.createChunkFromText(
      filePath,
      chunkContent,
      language,
      actualStartLine,
      endLine,
      chunkType,
      symbols.map((s) => ({ ...s, exported: isExported || s.exported }))
    ));

    return chunks;
  }

  /**
   * Extract class members as separate chunks
   */
  private extractClassMembers(
    node: ASTNode,
    lines: string[],
    commentsByLine: Map<number, ASTComment[]>,
    filePath: string,
    language: string
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];

    if (!node.body || !("body" in node.body) || !Array.isArray((node.body as any).body)) {
      return chunks;
    }

    const classBody = (node.body as any).body as ASTNode[];
    const className = node.id?.name || "AnonymousClass";

    for (const member of classBody) {
      if (!member.loc) continue;

      let memberName = "";
      let memberKind: CodeSymbol["kind"] = "method";

      if (member.type === "MethodDefinition" || member.type === "TSMethodSignature") {
        memberKind = "method";
        if (member.key) {
          memberName = member.key.name || member.key.value || "";
        }
      } else if (member.type === "PropertyDefinition" || member.type === "TSPropertySignature") {
        memberKind = "property";
        if (member.key) {
          memberName = member.key.name || member.key.value || "";
        }
      } else {
        continue;
      }

      const startLine = member.loc.start.line;
      const endLine = member.loc.end.line;

      // Include leading JSDoc
      let actualStartLine = startLine;
      for (let i = startLine - 1; i >= Math.max(1, startLine - 10); i--) {
        const lineContent = lines[i - 1]?.trim();
        if (lineContent?.startsWith("/**") || lineContent?.startsWith("*") || lineContent?.endsWith("*/")) {
          actualStartLine = i;
        } else if (lineContent && !lineContent.startsWith("//")) {
          break;
        }
      }

      const memberContent = lines.slice(actualStartLine - 1, endLine).join("\n");

      chunks.push(this.createChunkFromText(
        filePath,
        memberContent,
        language,
        actualStartLine,
        endLine,
        memberKind === "method" ? "function" : "other",
        [{
          name: `${className}.${memberName}`,
          kind: memberKind,
          exported: false,
        }]
      ));
    }

    // Annotate each member chunk with the class-level symbol so the
    // verifier and symbol index can resolve the class name.
    for (const chunk of chunks) {
      chunk.symbols.push({
        name: className,
        kind: "class",
        exported: false,
      });
    }

    // Prepend the class declaration line to the first member chunk
    // so that extractExports() regex can detect the export.
    if (chunks.length > 0 && node.loc) {
      const classLine = lines[node.loc.start.line - 1];
      if (classLine && classLine.match(/\bclass\b/)) {
        const first = chunks[0];
        // Use the actual declaration line (e.g. "export class Foo {")
        // so regex-based export detection picks it up
        first.content = classLine.trimEnd() + "\n" + first.content;
        // Re-extract exports from the updated content
        first.exports = this.extractExports(first.content);
      }
    }

    // If no members extracted, return class as single chunk
    if (chunks.length === 0 && node.loc) {
      const content = lines.slice(node.loc.start.line - 1, node.loc.end.line).join("\n");
      chunks.push(this.createChunkFromText(
        filePath,
        content,
        language,
        node.loc.start.line,
        node.loc.end.line,
        "class",
        [{ name: className, kind: "class", exported: false }]
      ));
    }

    return chunks;
  }

  /**
   * Get function signature from AST node
   */
  private getFunctionSignature(node: ASTNode, lines: string[]): string {
    if (!node.loc) return "";
    const firstLine = lines[node.loc.start.line - 1];
    const match = firstLine.match(/^.*?function\s+\w+\s*\([^)]*\)/);
    return match ? match[0].trim() : firstLine.trim();
  }

  /**
   * Get arrow function signature
   */
  private getArrowSignature(decl: ASTNode, lines: string[]): string {
    if (!decl || !("id" in decl) || !decl.id || !("loc" in decl) || !decl.loc) return "";
    const firstLine = lines[(decl.loc as any).start.line - 1];
    const match = firstLine.match(/^.*?(?:const|let|var)\s+\w+\s*(?::\s*[^=]+)?\s*=\s*(?:async\s*)?\([^)]*\)/);
    return match ? match[0].trim() : firstLine.trim();
  }

  /**
   * Fallback regex-based AST-like parsing (original implementation)
   */
  private regexAstChunk(filePath: string, content: string, language: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split("\n");
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
          if (currentChunk && currentChunk.content.length > 0) {
            chunks.push(this.createChunk(filePath, currentChunk, language));
          }

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
        currentChunk.content.push(line);
        currentChunk.endLine = i + 1;
        braceDepth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

        if (braceDepth <= 0 && currentChunk.content.length > 1) {
          chunks.push(this.createChunk(filePath, currentChunk, language));
          currentChunk = null;
          braceDepth = 0;
        }
      } else if (!matched && !currentChunk) {
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

      if (currentChunk) {
        const tokens = this.estimateTokens(currentChunk.content.join("\n"));
        if (tokens > this.config.maxTokens) {
          chunks.push(this.createChunk(filePath, currentChunk, language));
          currentChunk = null;
          braceDepth = 0;
        }
      }
    }

    if (currentChunk && currentChunk.content.length > 0) {
      chunks.push(this.createChunk(filePath, currentChunk, language));
    }

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
    const maxLines = Math.floor((this.config.maxTokens * CHARS_PER_TOKEN) / 80);
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
    endLine: number,
    type?: ChunkType,
    symbols?: CodeSymbol[]
  ): CodeChunk {
    const id = `chunk_${this.chunkCounter++}_${crypto.createHash("md5").update(content).digest("hex").slice(0, 8)}`;

    return {
      id,
      filePath,
      content,
      lines: [startLine, endLine],
      type: type || this.detectChunkType(content),
      language,
      symbols: symbols || this.extractSymbols(content),
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
          const mergedContent: string = buffer.content + "\n\n" + chunk.content;
          buffer = {
            id: buffer.id,
            filePath: buffer.filePath,
            content: mergedContent,
            lines: [buffer.lines[0], chunk.lines[1]],
            type: buffer.type,
            language: buffer.language,
            symbols: [...buffer.symbols, ...chunk.symbols],
            imports: [...(buffer.imports || []), ...(chunk.imports || [])],
            exports: [...(buffer.exports || []), ...(chunk.exports || [])],
            hash: crypto.createHash("sha256").update(mergedContent).digest("hex"),
            tokens: this.estimateTokens(mergedContent),
            createdAt: buffer.createdAt,
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
      ".mjs": "javascript",
      ".cjs": "javascript",
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
        { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/, type: "function", symbolKind: "function" },
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

      const funcMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      if (funcMatch) {
        symbols.push({ name: funcMatch[1], kind: "function", exported: trimmed.startsWith("export") });
      }

      const classMatch = trimmed.match(/^(?:export\s+)?class\s+(\w+)/);
      if (classMatch) {
        symbols.push({ name: classMatch[1], kind: "class", exported: trimmed.startsWith("export") });
      }

      const interfaceMatch = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/);
      if (interfaceMatch) {
        symbols.push({ name: interfaceMatch[1], kind: "interface", exported: trimmed.startsWith("export") });
      }

      const typeMatch = trimmed.match(/^(?:export\s+)?type\s+(\w+)/);
      if (typeMatch) {
        symbols.push({ name: typeMatch[1], kind: "type", exported: trimmed.startsWith("export") });
      }

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
