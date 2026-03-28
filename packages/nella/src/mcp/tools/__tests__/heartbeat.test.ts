import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateChallenge,
  createChallengeState,
  verifyChallenge,
  handleHeartbeat,
} from "../heartbeat";

describe("Challenge-Response Heartbeat", () => {
  describe("generateChallenge", () => {
    it("returns 8-char hex string", () => {
      const challenge = generateChallenge();
      assert.equal(challenge.length, 8);
      assert.match(challenge, /^[0-9a-f]{8}$/);
    });

    it("produces unique values", () => {
      const challenges = new Set(Array.from({ length: 50 }, () => generateChallenge()));
      assert.equal(challenges.size, 50);
    });
  });

  describe("createChallengeState", () => {
    it("initializes with a challenge and zero counts", () => {
      const state = createChallengeState();
      assert.equal(state.currentChallenge.length, 8);
      assert.equal(state.verifiedCount, 0);
      assert.equal(state.failedCount, 0);
      assert.equal(state.lastVerified, true);
    });
  });

  describe("verifyChallenge", () => {
    it("succeeds with correct response", () => {
      const state = createChallengeState();
      const { valid, nextChallenge, state: newState } = verifyChallenge(
        state,
        state.currentChallenge,
      );
      assert.ok(valid);
      assert.equal(newState.verifiedCount, 1);
      assert.equal(newState.failedCount, 0);
      assert.ok(newState.lastVerified);
      assert.notEqual(nextChallenge, state.currentChallenge);
    });

    it("fails with wrong response", () => {
      const state = createChallengeState();
      const { valid, state: newState } = verifyChallenge(state, "wrong");
      assert.ok(!valid);
      assert.equal(newState.verifiedCount, 0);
      assert.equal(newState.failedCount, 1);
      assert.ok(!newState.lastVerified);
    });

    it("rotates challenge on success", () => {
      const state = createChallengeState();
      const { nextChallenge, state: newState } = verifyChallenge(
        state,
        state.currentChallenge,
      );
      assert.equal(newState.currentChallenge, nextChallenge);
      assert.notEqual(newState.currentChallenge, state.currentChallenge);
    });

    it("rotates challenge on failure too", () => {
      const state = createChallengeState();
      const oldChallenge = state.currentChallenge;
      const { state: newState } = verifyChallenge(state, "wrong");
      assert.notEqual(newState.currentChallenge, oldChallenge);
    });

    it("tracks cumulative counts", () => {
      let state = createChallengeState();

      // Succeed twice
      let result = verifyChallenge(state, state.currentChallenge);
      state = result.state;
      result = verifyChallenge(state, state.currentChallenge);
      state = result.state;

      // Fail once
      result = verifyChallenge(state, "wrong");
      state = result.state;

      assert.equal(state.verifiedCount, 2);
      assert.equal(state.failedCount, 1);
    });
  });

  describe("handleHeartbeat", () => {
    it("returns OK for valid response", () => {
      const state = createChallengeState();
      const { result, newState } = handleHeartbeat(
        { challenge_response: state.currentChallenge },
        state,
      );
      const text = result.content[0].text;
      assert.ok(text.includes("Heartbeat: OK"));
      assert.ok(text.includes("Trust chain verified"));
      assert.ok(text.includes("Next challenge:"));
      assert.equal(newState.verifiedCount, 1);
    });

    it("returns FAILED for wrong response", () => {
      const state = createChallengeState();
      const { result, newState } = handleHeartbeat(
        { challenge_response: "wrong-value" },
        state,
      );
      const text = result.content[0].text;
      assert.ok(text.includes("Heartbeat: FAILED"));
      assert.ok(text.includes("Trust chain may be compromised"));
      assert.equal(newState.failedCount, 1);
    });

    it("returns FAILED for missing response", () => {
      const state = createChallengeState();
      const { result, newState } = handleHeartbeat({}, state);
      const text = result.content[0].text;
      assert.ok(text.includes("Heartbeat: FAILED"));
      assert.ok(text.includes("No challenge response"));
      assert.equal(newState.failedCount, 1);
    });

    it("includes next challenge in response", () => {
      const state = createChallengeState();
      const { result, newState } = handleHeartbeat(
        { challenge_response: state.currentChallenge },
        state,
      );
      const text = result.content[0].text;
      assert.ok(text.includes(newState.currentChallenge));
    });
  });
});
