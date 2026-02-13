/**
 * VectorStore Tests
 *
 * Tests for the brute-force vector store backend.
 * Covers add, remove, search, dimension validation, persistence, and metrics.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { VectorStore } from "../vector-store";

// Small dimension for fast tests
const DIM = 4;

function makeStore(overrides: Record<string, unknown> = {}) {
  return new VectorStore({
    dimensions: DIM,
    backend: "brute-force",
    metric: "cosine",
    ...overrides,
  });
}

function randomVector(dim = DIM): number[] {
  return Array.from({ length: dim }, () => Math.random() - 0.5);
}

// =============================================================================
// Basic Operations
// =============================================================================

describe("VectorStore", () => {
  let store: VectorStore;

  beforeEach(() => {
    store = makeStore();
  });

  describe("add / has / size", () => {
    it("adds a vector and reports it exists", () => {
      store.add("chunk-1", randomVector());
      assert.equal(store.size, 1);
      assert.ok(store.has("chunk-1"));
    });

    it("adds multiple vectors", () => {
      store.add("a", randomVector());
      store.add("b", randomVector());
      store.add("c", randomVector());
      assert.equal(store.size, 3);
    });

    it("rejects vectors with wrong dimensions", () => {
      assert.throws(() => store.add("x", [1, 2]), /dimension mismatch/i);
    });
  });

  describe("addBatch", () => {
    it("adds multiple items at once", () => {
      const ids = store.addBatch([
        { chunkId: "c1", vector: randomVector() },
        { chunkId: "c2", vector: randomVector() },
      ]);
      assert.equal(ids.length, 2);
      assert.equal(store.size, 2);
    });
  });

  describe("remove", () => {
    it("removes an existing vector", () => {
      store.add("chunk-1", randomVector());
      assert.ok(store.remove("chunk-1"));
      assert.equal(store.size, 0);
      assert.ok(!store.has("chunk-1"));
    });

    it("returns false for non-existent chunk", () => {
      assert.ok(!store.remove("does-not-exist"));
    });
  });

  describe("getVector", () => {
    it("retrieves the stored vector", () => {
      const vec = [0.1, 0.2, 0.3, 0.4];
      store.add("chunk-1", vec);
      const retrieved = store.getVector("chunk-1");
      assert.ok(retrieved);
      assert.equal(retrieved.length, DIM);
      for (let i = 0; i < DIM; i++) {
        assert.ok(Math.abs(retrieved[i] - vec[i]) < 1e-6);
      }
    });

    it("returns null for missing chunk", () => {
      assert.equal(store.getVector("nope"), null);
    });
  });

  describe("clear", () => {
    it("removes all vectors", () => {
      store.add("a", randomVector());
      store.add("b", randomVector());
      store.clear();
      assert.equal(store.size, 0);
    });
  });

  // =============================================================================
  // Search
  // =============================================================================

  describe("search (cosine)", () => {
    it("returns empty array when store is empty", () => {
      const results = store.search(randomVector(), 5);
      assert.equal(results.length, 0);
    });

    it("finds the most similar vector", () => {
      const target = [1, 0, 0, 0];
      const similar = [0.9, 0.1, 0, 0]; // close to target
      const dissimilar = [0, 0, 0, 1];   // far from target

      store.add("similar", similar);
      store.add("dissimilar", dissimilar);

      const results = store.search(target, 2);
      assert.equal(results.length, 2);
      assert.equal(results[0].chunkId, "similar");
      assert.ok(results[0].score > results[1].score);
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        store.add(`chunk-${i}`, randomVector());
      }
      const results = store.search(randomVector(), 3);
      assert.equal(results.length, 3);
    });

    it("identical vectors have highest similarity", () => {
      const vec = [0.5, 0.5, 0.5, 0.5];
      store.add("identical", vec);
      store.add("other", [0, 0, 0, 1]);

      const results = store.search(vec, 2);
      assert.equal(results[0].chunkId, "identical");
      assert.ok(results[0].score > 0.99, `Expected score > 0.99, got ${results[0].score}`);
    });
  });

  describe("search (L2)", () => {
    it("finds nearest by L2 distance", () => {
      const l2Store = makeStore({ metric: "l2" });
      l2Store.add("near", [1, 0, 0, 0]);
      l2Store.add("far", [10, 10, 10, 10]);

      const results = l2Store.search([1, 0, 0, 0], 2);
      assert.equal(results[0].chunkId, "near");
      assert.ok(results[0].score > results[1].score);
    });
  });

  describe("search (inner product)", () => {
    it("ranks by inner product", () => {
      const ipStore = makeStore({ metric: "ip" });
      ipStore.add("high", [1, 1, 1, 1]);
      ipStore.add("low", [0.01, 0.01, 0.01, 0.01]);

      const results = ipStore.search([1, 1, 1, 1], 2);
      assert.equal(results[0].chunkId, "high");
    });
  });

  describe("search dimension validation", () => {
    it("rejects query with wrong dimensions", () => {
      store.add("a", randomVector());
      assert.throws(() => store.search([1, 2], 5), /dimension mismatch/i);
    });
  });

  // =============================================================================
  // Persistence
  // =============================================================================

  describe("persistence", () => {
    it("saves and loads vectors", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-test-"));
      const storePath = path.join(tmpDir, "vectors.json");

      try {
        const s1 = makeStore();
        s1.initPersistence(storePath);
        s1.add("c1", [1, 0, 0, 0]);
        s1.add("c2", [0, 1, 0, 0]);
        s1.save();

        const s2 = makeStore();
        s2.initPersistence(storePath);
        assert.equal(s2.size, 2);
        assert.ok(s2.has("c1"));
        assert.ok(s2.has("c2"));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // =============================================================================
  // Backend type
  // =============================================================================

  describe("getBackendType", () => {
    it("reports brute-force when explicitly set", () => {
      assert.equal(store.getBackendType(), "brute-force");
    });
  });
});
