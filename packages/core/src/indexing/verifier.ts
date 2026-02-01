/**
 * Code Verifier
 *
 * Validates generated code against the indexed codebase.
 * Checks imports, symbols, and API usage for correctness.
 */

import type { CodeChunk, VerifyCodeRequest, VerifyCodeResult, VerifyIssue } from "./types";
import { LexicalIndex } from "./lexical-index";

// =============================================================================
// Verifier Class
// =============================================================================

export class CodeVerifier {
  private lexicalIndex: LexicalIndex;
  private chunks: Map<string, CodeChunk> = new Map();
  private symbolIndex: Map<string, { chunk: CodeChunk; symbol: CodeChunk["symbols"][0] }[]> = new Map();
  private importIndex: Map<string, CodeChunk[]> = new Map();

  constructor(lexicalIndex: LexicalIndex) {
    this.lexicalIndex = lexicalIndex;
  }

  /**
   * Register a chunk for verification
   */
  registerChunk(chunk: CodeChunk): void {
    this.chunks.set(chunk.id, chunk);

    // Index symbols
    for (const symbol of chunk.symbols) {
      const existing = this.symbolIndex.get(symbol.name) || [];
      existing.push({ chunk, symbol });
      this.symbolIndex.set(symbol.name, existing);
    }

    // Index exports as importable modules
    if (chunk.exports) {
      for (const exp of chunk.exports) {
        const existing = this.importIndex.get(exp) || [];
        existing.push(chunk);
        this.importIndex.set(exp, existing);
      }
    }
  }

  /**
   * Register multiple chunks
   */
  registerChunks(chunks: CodeChunk[]): void {
    for (const chunk of chunks) {
      this.registerChunk(chunk);
    }
  }

  /**
   * Verify generated code
   */
  verify(request: VerifyCodeRequest): VerifyCodeResult {
    const issues: VerifyIssue[] = [];
    const suggestions: string[] = [];

    const { code, checkImports = true, checkSymbols = true, checkAPIs = true } = request;

    // Extract code elements
    const extractedImports = this.extractImports(code);
    const extractedSymbols = this.extractUsedSymbols(code);
    const extractedAPICalls = this.extractAPICalls(code);

    // Check imports
    if (checkImports) {
      for (const imp of extractedImports) {
        const issue = this.verifyImport(imp);
        if (issue) {
          issues.push(issue);
          const suggestion = this.suggestImportFix(imp);
          if (suggestion) suggestions.push(suggestion);
        }
      }
    }

    // Check symbols
    if (checkSymbols) {
      for (const symbol of extractedSymbols) {
        const issue = this.verifySymbol(symbol);
        if (issue) {
          issues.push(issue);
          const suggestion = this.suggestSymbolFix(symbol);
          if (suggestion) suggestions.push(suggestion);
        }
      }
    }

    // Check API calls
    if (checkAPIs) {
      for (const apiCall of extractedAPICalls) {
        const issue = this.verifyAPICall(apiCall);
        if (issue) {
          issues.push(issue);
        }
      }
    }

    // Calculate confidence
    const totalChecks = extractedImports.length + extractedSymbols.length + extractedAPICalls.length;
    const errorCount = issues.filter((i) => i.severity === "error").length;
    const confidence = totalChecks > 0 ? 1 - (errorCount / totalChecks) : 1;

    return {
      valid: issues.filter((i) => i.severity === "error").length === 0,
      issues,
      suggestions,
      confidence,
    };
  }

  // =============================================================================
  // Extraction Methods
  // =============================================================================

  private extractImports(code: string): { module: string; names: string[]; line: number }[] {
    const imports: { module: string; names: string[]; line: number }[] = [];
    const lines = code.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // import { a, b } from 'module'
      const namedMatch = line.match(/import\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"]/);
      if (namedMatch) {
        const names = namedMatch[1].split(",").map((n) => n.trim().split(" as ")[0]);
        imports.push({ module: namedMatch[2], names, line: i + 1 });
        continue;
      }

      // import Default from 'module'
      const defaultMatch = line.match(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
      if (defaultMatch) {
        imports.push({ module: defaultMatch[2], names: [defaultMatch[1]], line: i + 1 });
        continue;
      }

      // import * as name from 'module'
      const namespaceMatch = line.match(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
      if (namespaceMatch) {
        imports.push({ module: namespaceMatch[2], names: [namespaceMatch[1]], line: i + 1 });
      }
    }

    return imports;
  }

  private extractUsedSymbols(code: string): { name: string; line: number; context: string }[] {
    const symbols: { name: string; line: number; context: string }[] = [];
    const lines = code.split("\n");

    // Common patterns for symbol usage
    const patterns = [
      /new\s+(\w+)\s*\(/g,           // new ClassName()
      /extends\s+(\w+)/g,            // extends ClassName
      /implements\s+(\w+)/g,         // implements InterfaceName
      /:\s*(\w+)(?:\s*[,;)\]=])/g,   // : TypeName
      /(\w+)\s*\.\s*\w+\s*\(/g,      // Instance.method()
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(line)) !== null) {
          const name = match[1];
          // Filter out common keywords and built-ins
          if (!this.isBuiltIn(name)) {
            symbols.push({ name, line: i + 1, context: line.trim() });
          }
        }
      }
    }

    return symbols;
  }

  private extractAPICalls(code: string): { object: string; method: string; line: number }[] {
    const calls: { object: string; method: string; line: number }[] = [];
    const lines = code.split("\n");

    const pattern = /(\w+)\s*\.\s*(\w+)\s*\(/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(line)) !== null) {
        const [, object, method] = match;
        if (!this.isBuiltIn(object)) {
          calls.push({ object, method, line: i + 1 });
        }
      }
    }

    return calls;
  }

  // =============================================================================
  // Verification Methods
  // =============================================================================

  private verifyImport(imp: { module: string; names: string[]; line: number }): VerifyIssue | null {
    // Skip node_modules imports (assume they're valid)
    if (!imp.module.startsWith(".") && !imp.module.startsWith("@/")) {
      return null;
    }

    // Check if any chunk provides this export
    for (const name of imp.names) {
      const providers = this.importIndex.get(name);
      if (!providers || providers.length === 0) {
        // Check if the symbol exists anywhere
        const symbolExists = this.symbolIndex.has(name);
        if (!symbolExists) {
          return {
            type: "missing_import",
            severity: "error",
            message: `Import '${name}' from '${imp.module}' not found in codebase`,
            location: { line: imp.line, column: 0 },
            suggestion: `Check if '${name}' is exported from '${imp.module}'`,
          };
        }
      }
    }

    return null;
  }

  private verifySymbol(symbol: { name: string; line: number; context: string }): VerifyIssue | null {
    // Check if symbol exists in the codebase
    const definitions = this.symbolIndex.get(symbol.name);

    if (!definitions || definitions.length === 0) {
      // Symbol not found - might be hallucinated
      return {
        type: "unknown_symbol",
        severity: "warning",
        message: `Symbol '${symbol.name}' not found in indexed codebase`,
        location: { line: symbol.line, column: 0 },
        suggestion: `Verify that '${symbol.name}' exists or is imported correctly`,
      };
    }

    return null;
  }

  private verifyAPICall(call: { object: string; method: string; line: number }): VerifyIssue | null {
    // Check if the object type has this method
    // This is a simplified check - in production, would need type information

    const objectDefs = this.symbolIndex.get(call.object);
    if (objectDefs && objectDefs.length > 0) {
      // Check if any definition's chunk contains the method
      let methodFound = false;
      for (const def of objectDefs) {
        if (def.chunk.content.includes(call.method)) {
          methodFound = true;
          break;
        }
      }

      if (!methodFound) {
        return {
          type: "invalid_api",
          severity: "warning",
          message: `Method '${call.method}' not found on '${call.object}'`,
          location: { line: call.line, column: 0 },
        };
      }
    }

    return null;
  }

  // =============================================================================
  // Suggestion Methods
  // =============================================================================

  private suggestImportFix(imp: { module: string; names: string[] }): string | null {
    for (const name of imp.names) {
      // Find similar symbols
      const similar = this.findSimilarSymbols(name);
      if (similar.length > 0) {
        return `Did you mean to import '${similar[0]}'? Found in codebase.`;
      }
    }
    return null;
  }

  private suggestSymbolFix(symbol: { name: string }): string | null {
    const similar = this.findSimilarSymbols(symbol.name);
    if (similar.length > 0) {
      return `Did you mean '${similar.join("' or '")}'?`;
    }
    return null;
  }

  private findSimilarSymbols(name: string): string[] {
    const similar: string[] = [];
    const nameLower = name.toLowerCase();

    for (const symbolName of this.symbolIndex.keys()) {
      const symbolLower = symbolName.toLowerCase();

      // Levenshtein distance or simple substring check
      if (
        symbolLower.includes(nameLower) ||
        nameLower.includes(symbolLower) ||
        this.levenshteinDistance(nameLower, symbolLower) <= 2
      ) {
        similar.push(symbolName);
        if (similar.length >= 3) break;
      }
    }

    return similar;
  }

  private levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  private isBuiltIn(name: string): boolean {
    const builtIns = new Set([
      // JavaScript built-ins
      "Array", "Object", "String", "Number", "Boolean", "Function",
      "Symbol", "Map", "Set", "WeakMap", "WeakSet", "Promise",
      "Date", "RegExp", "Error", "JSON", "Math", "console",
      "setTimeout", "setInterval", "clearTimeout", "clearInterval",
      "parseInt", "parseFloat", "isNaN", "isFinite",
      // Common keywords
      "this", "super", "null", "undefined", "true", "false",
      // Node.js globals
      "process", "Buffer", "global", "require", "module", "exports",
      "__dirname", "__filename",
      // TypeScript
      "any", "unknown", "never", "void",
    ]);

    return builtIns.has(name);
  }

  /**
   * Get verification statistics
   */
  getStats(): {
    registeredChunks: number;
    indexedSymbols: number;
    indexedExports: number;
  } {
    return {
      registeredChunks: this.chunks.size,
      indexedSymbols: this.symbolIndex.size,
      indexedExports: this.importIndex.size,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createCodeVerifier(lexicalIndex: LexicalIndex): CodeVerifier {
  return new CodeVerifier(lexicalIndex);
}
