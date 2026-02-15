/**
 * Chunker Tests
 *
 * Tests for AST-based code chunking with focus on class splitting
 * and symbol/export preservation.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Chunker } from "../chunker";

// =============================================================================
// Helpers
// =============================================================================

function makeChunker(overrides: Record<string, unknown> = {}) {
  return new Chunker({
    maxTokens: 512,
    minTokens: 10,
    overlap: 0,
    strategy: "ast",
    ...overrides,
  });
}

// =============================================================================
// Class Splitting & Symbol Preservation
// =============================================================================

describe("Chunker", () => {
  let chunker: Chunker;

  beforeEach(() => {
    chunker = makeChunker();
  });

  describe("class splitting", () => {
    it("splits a large class into member chunks", async () => {
      const code = `
class MyService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async getUser(id: string): Promise<User> {
    const result = await this.db.query("SELECT * FROM users WHERE id = $1", [id]);
    if (!result.rows[0]) {
      throw new Error("User not found");
    }
    return result.rows[0];
  }

  async createUser(data: CreateUserInput): Promise<User> {
    const result = await this.db.query(
      "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *",
      [data.name, data.email]
    );
    return result.rows[0];
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.query("DELETE FROM users WHERE id = $1", [id]);
  }
}
`;
      const chunks = await chunker.chunkFile("test.ts", code);

      // Should produce multiple member chunks (not a single class chunk)
      assert.ok(chunks.length > 1, `Expected multiple chunks, got ${chunks.length}`);

      // Every member chunk should carry the class-level symbol
      for (const chunk of chunks) {
        const classSymbol = chunk.symbols.find(
          (s) => s.name === "MyService" && s.kind === "class"
        );
        assert.ok(
          classSymbol,
          `Chunk at lines ${chunk.lines} should have 'MyService' class symbol, ` +
          `but only has: ${chunk.symbols.map(s => s.name).join(", ")}`
        );
      }
    });

    it("preserves exported flag on class symbols in member chunks", async () => {
      const code = `
export class IndexManager {
  private chunks: Map<string, any> = new Map();

  constructor(config: any) {
    this.chunks = new Map();
  }

  async index(): Promise<void> {
    // Index all the files in the workspace
    const files = this.getFiles();
    for (const file of files) {
      await this.processFile(file);
    }
  }

  getChunk(id: string): any {
    return this.chunks.get(id) || null;
  }

  clear(): void {
    this.chunks.clear();
  }
}
`;
      const chunks = await chunker.chunkFile("index.ts", code);
      assert.ok(chunks.length > 1, `Expected multiple chunks, got ${chunks.length}`);

      // The class symbol in each member chunk should be marked as exported
      for (const chunk of chunks) {
        const classSymbol = chunk.symbols.find(
          (s) => s.name === "IndexManager" && s.kind === "class"
        );
        assert.ok(classSymbol, `Missing 'IndexManager' class symbol in chunk`);
        assert.equal(
          classSymbol!.exported,
          true,
          `'IndexManager' should be exported in chunk at lines ${chunk.lines}`
        );
      }
    });

    it("includes the class declaration line in first member chunk exports", async () => {
      const code = `
export class VectorStore {
  private data: number[] = [];

  add(value: number): void {
    this.data.push(value);
  }

  search(query: number): number[] {
    return this.data.filter(d => Math.abs(d - query) < 0.1);
  }

  clear(): void {
    this.data = [];
  }
}
`;
      const chunks = await chunker.chunkFile("vector-store.ts", code);
      assert.ok(chunks.length >= 1, "Expected at least one chunk");

      // At least one chunk should have 'VectorStore' in its exports
      const hasExport = chunks.some(
        (c) => c.exports && c.exports.includes("VectorStore")
      );
      assert.ok(
        hasExport,
        `Expected some chunk to have 'VectorStore' in exports, ` +
        `but found: ${chunks.map(c => JSON.stringify(c.exports)).join(", ")}`
      );
    });

    it("keeps a small class as a single chunk", async () => {
      const code = `
class Tiny {
  value: number = 0;
}
`;
      const chunks = await chunker.chunkFile("tiny.ts", code);
      // Small class should not be split
      assert.equal(chunks.length, 1, "Small class should be a single chunk");
      const sym = chunks[0].symbols.find((s) => s.name === "Tiny");
      assert.ok(sym, "Single chunk should have the class symbol");
    });

    it("includes method-level symbols alongside class symbol", async () => {
      const code = `
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }
}
`;
      const chunks = await chunker.chunkFile("calc.ts", code);

      if (chunks.length > 1) {
        // Member chunks should have both ClassName.method and ClassName symbols
        for (const chunk of chunks) {
          const methodSymbol = chunk.symbols.find((s) => s.kind === "method");
          const classSymbol = chunk.symbols.find(
            (s) => s.name === "Calculator" && s.kind === "class"
          );
          if (methodSymbol) {
            assert.ok(
              classSymbol,
              `Method chunk with ${methodSymbol.name} should also have Calculator class symbol`
            );
          }
        }
      }
    });
  });

  describe("function chunking", () => {
    it("extracts function symbols", async () => {
      const code = `
export function greet(name: string): string {
  return "Hello, " + name;
}

function helper(): void {
  // internal
}
`;
      const chunks = await chunker.chunkFile("funcs.ts", code);
      const greetChunk = chunks.find((c) =>
        c.symbols.some((s) => s.name === "greet")
      );
      assert.ok(greetChunk, "Should have a chunk with 'greet' symbol");

      const greetSym = greetChunk!.symbols.find((s) => s.name === "greet");
      assert.equal(greetSym!.exported, true, "greet should be exported");
    });
  });

  describe("interface/type chunking", () => {
    it("extracts interface symbols", async () => {
      const code = `
export interface UserConfig {
  name: string;
  email: string;
  role: "admin" | "user";
}
`;
      const chunks = await chunker.chunkFile("types.ts", code);
      const ifaceChunk = chunks.find((c) =>
        c.symbols.some((s) => s.name === "UserConfig")
      );
      assert.ok(ifaceChunk, "Should have chunk with UserConfig symbol");
      const sym = ifaceChunk!.symbols.find((s) => s.name === "UserConfig");
      assert.equal(sym!.kind, "interface");
      assert.equal(sym!.exported, true);
    });
  });
});
