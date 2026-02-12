import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createSessionStore } from "../session-store";
import type { PlaygroundSession, SessionState } from "../types";

function makeSession(id: string, workspaceId: string): PlaygroundSession {
  const state: SessionState = {
    activeAgent: null,
    chainOfThought: [],
    recentToolCalls: [],
    recentSearches: [],
    indexStatus: "none",
    rateLimitStatus: {
      minute: { used: 0, limit: 60 },
      hour: { used: 0, limit: 1000 },
    },
  };
  return {
    id,
    workspaceId,
    clients: [],
    state,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    metadata: { totalToolCalls: 0, totalTokens: 0, estimatedCost: 0 },
  };
}

test("session store save and load round-trip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nella-sess-test-"));
  const store = createSessionStore(dir);
  const session = makeSession("s1", "ws1");

  store.save(session);
  const loaded = store.load("s1");

  assert.ok(loaded);
  assert.equal(loaded!.id, "s1");
  assert.equal(loaded!.workspaceId, "ws1");
  assert.equal(loaded!.clients.length, 0); // clients are transient
  assert.deepEqual(loaded!.metadata, session.metadata);

  store.close();
});

test("session store loadByWorkspace returns correct sessions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nella-sess-test-"));
  const store = createSessionStore(dir);

  store.save(makeSession("s1", "ws1"));
  store.save(makeSession("s2", "ws1"));
  store.save(makeSession("s3", "ws2"));

  const ws1Sessions = store.loadByWorkspace("ws1");
  assert.equal(ws1Sessions.length, 2);
  assert.ok(ws1Sessions.every((s) => s.workspaceId === "ws1"));

  store.close();
});

test("session store delete removes a session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nella-sess-test-"));
  const store = createSessionStore(dir);

  store.save(makeSession("s1", "ws1"));
  store.delete("s1");
  const loaded = store.load("s1");
  assert.equal(loaded, null);

  store.close();
});

test("session store cleanup removes old sessions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nella-sess-test-"));
  const store = createSessionStore(dir);

  const old = makeSession("s_old", "ws1");
  old.lastActivity = new Date(Date.now() - 100_000).toISOString();
  const recent = makeSession("s_new", "ws1");

  store.save(old);
  store.save(recent);

  const removed = store.cleanup(50_000); // 50s max age
  assert.equal(removed, 1);
  assert.equal(store.load("s_old"), null);
  assert.ok(store.load("s_new"));

  store.close();
});
