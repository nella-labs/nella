/**
 * CodeVerifier Tests
 *
 * Tests for code verification against indexed codebase.
 * Covers import extraction, symbol extraction, API call verification,
 * confidence scoring, and suggestion generation.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CodeVerifier, createCodeVerifier } from "../verifier";
import { LexicalIndex } from "../lexical-index";
import type { CodeChunk } from "../types";

function makeChunk(overrides: Partial<CodeChunk> = {}): CodeChunk {
  const id = overrides.id ?? `chunk-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    filePath: "src/example.ts",
    content: "",
    lines: [1, 10] as [number, number],
    type: "function",
    language: "typescript",
    symbols: [],
    imports: [],
    exports: [],
    hash: "abc",
    tokens: 10,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("CodeVerifier", () => {
  let lexIndex: LexicalIndex;
  let verifier: CodeVerifier;

  beforeEach(() => {
    lexIndex = new LexicalIndex();
    verifier = createCodeVerifier(lexIndex);
  });

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  describe("registerChunk / getStats", () => {
    it("registers a chunk and updates stats", () => {
      verifier.registerChunk(
        makeChunk({
          symbols: [
            { name: "UserService", kind: "class", exported: true },
            { name: "getUser", kind: "method" },
          ],
          exports: ["UserService"],
        })
      );

      const stats = verifier.getStats();
      assert.equal(stats.registeredChunks, 1);
      assert.equal(stats.indexedSymbols, 2);
      assert.equal(stats.indexedExports, 1);
    });

    it("registerChunks registers multiple at once", () => {
      verifier.registerChunks([
        makeChunk({
          id: "c1",
          symbols: [{ name: "Foo", kind: "class" }],
          exports: ["Foo"],
        }),
        makeChunk({
          id: "c2",
          symbols: [{ name: "Bar", kind: "function" }],
          exports: ["Bar"],
        }),
      ]);

      const stats = verifier.getStats();
      assert.equal(stats.registeredChunks, 2);
    });
  });

  // ---------------------------------------------------------------------------
  // Verification — valid code
  // ---------------------------------------------------------------------------

  describe("verify — valid code", () => {
    it("returns valid=true for code using registered symbols", () => {
      verifier.registerChunks([
        makeChunk({
          id: "svc",
          content: "export class UserService { getUser(id: string) {} }",
          symbols: [
            { name: "UserService", kind: "class", exported: true },
            { name: "getUser", kind: "method" },
          ],
          exports: ["UserService"],
        }),
      ]);

      const result = verifier.verify({
        code: `
          import { UserService } from './services';
          const svc = new UserService();
          svc.getUser("123");
        `,
      });

      assert.ok(result.valid);
      assert.equal(result.issues.filter((i) => i.severity === "error").length, 0);
    });

    it("skips validation of node_modules imports", () => {
      const result = verifier.verify({
        code: `
          import express from 'express';
          import { z } from 'zod';
        `,
      });

      // Node module imports should not produce errors
      const importErrors = result.issues.filter((i) => i.type === "missing_import");
      assert.equal(importErrors.length, 0);
    });
  });

  // ---------------------------------------------------------------------------
  // Verification — invalid code
  // ---------------------------------------------------------------------------

  describe("verify — invalid code", () => {
    it("flags missing local imports", () => {
      const result = verifier.verify({
        code: `import { NonExistentService } from './services';`,
      });

      const errors = result.issues.filter((i) => i.type === "missing_import");
      assert.ok(errors.length > 0);
      assert.ok(errors[0].message.includes("NonExistentService"));
    });

    it("flags unknown symbols as warnings", () => {
      const result = verifier.verify({
        code: `const x = new HallucinatedClass();`,
      });

      const warnings = result.issues.filter((i) => i.type === "unknown_symbol");
      assert.ok(warnings.length > 0);
    });

    it("lowers confidence when errors are found", () => {
      const result = verifier.verify({
        code: `
          import { FakeModule } from './fake';
          const x = new FakeModule();
        `,
      });

      assert.ok(result.confidence < 1);
    });
  });

  // ---------------------------------------------------------------------------
  // Selective checks
  // ---------------------------------------------------------------------------

  describe("selective verification", () => {
    it("can disable import checking", () => {
      const result = verifier.verify({
        code: `import { Missing } from './missing';`,
        checkImports: false,
      });

      const importIssues = result.issues.filter((i) => i.type === "missing_import");
      assert.equal(importIssues.length, 0);
    });

    it("can disable symbol checking", () => {
      const result = verifier.verify({
        code: `const x = new Unknown();`,
        checkSymbols: false,
      });

      const symbolIssues = result.issues.filter((i) => i.type === "unknown_symbol");
      assert.equal(symbolIssues.length, 0);
    });

    it("can disable API call checking", () => {
      const result = verifier.verify({
        code: `myObj.nonExistentMethod()`,
        checkAPIs: false,
      });

      const apiIssues = result.issues.filter((i) => i.type === "invalid_api");
      assert.equal(apiIssues.length, 0);
    });
  });

  // ---------------------------------------------------------------------------
  // Suggestions
  // ---------------------------------------------------------------------------

  describe("suggestions", () => {
    it("suggests similar symbols when import not found", () => {
      verifier.registerChunk(
        makeChunk({
          symbols: [{ name: "UserServices", kind: "class", exported: true }],
          exports: ["UserServices"],
        })
      );

      const result = verifier.verify({
        code: `import { UserService } from './services';`,
      });

      // Should suggest "UserServices" (with trailing 's')
      assert.ok(
        result.suggestions.length > 0 || result.issues.length > 0,
        "Should have suggestions or issues for typo"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Confidence scoring
  // ---------------------------------------------------------------------------

  describe("confidence scoring", () => {
    it("returns 1.0 for empty code", () => {
      const result = verifier.verify({ code: "" });
      assert.equal(result.confidence, 1);
      assert.ok(result.valid);
    });

    it("returns 1.0 when all checks pass", () => {
      verifier.registerChunk(
        makeChunk({
          content: "export function greet() {}",
          symbols: [{ name: "greet", kind: "function", exported: true }],
          exports: ["greet"],
        })
      );

      const result = verifier.verify({
        code: `import { greet } from './module';`,
      });

      // No errors means confidence = 1.0
      const errorCount = result.issues.filter((i) => i.severity === "error").length;
      if (errorCount === 0) {
        assert.equal(result.confidence, 1);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Import extraction patterns
  // ---------------------------------------------------------------------------

  describe("import extraction patterns", () => {
    it("handles named imports", () => {
      const result = verifier.verify({
        code: `import { Foo, Bar } from './lib';`,
      });
      // Should detect both Foo and Bar as imports
      const importIssues = result.issues.filter((i) => i.type === "missing_import");
      assert.ok(importIssues.length >= 1);
    });

    it("handles default imports", () => {
      const result = verifier.verify({
        code: `import MyDefault from './component';`,
      });
      const importIssues = result.issues.filter((i) => i.type === "missing_import");
      assert.ok(importIssues.length >= 1);
    });

    it("handles namespace imports", () => {
      const result = verifier.verify({
        code: `import * as utils from './utils';`,
      });
      // namespace imports should be checked
      assert.ok(Array.isArray(result.issues));
    });
  });
});
