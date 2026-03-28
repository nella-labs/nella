/**
 * Challenge-Response Heartbeat
 *
 * Lightweight challenge-response mechanism to verify trust chain continuity
 * between tool calls. If an injection hijacks the agent's behavior, the
 * challenge-response will fail on the next tool call.
 *
 * Flow:
 * 1. nella_get_context issues the first challenge
 * 2. Agent includes the challenge response in its next nella tool call
 * 3. System verifies and issues a new challenge
 * 4. If verification fails → warning (trust chain may be compromised)
 *
 * Part of the prompt injection defense system (Layer 4 upgrade).
 */

import * as crypto from "crypto";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// =============================================================================
// Types
// =============================================================================

export interface ChallengeState {
  /** Current active challenge the agent should respond to */
  currentChallenge: string;
  /** Number of successful verifications in this session */
  verifiedCount: number;
  /** Number of failed verifications */
  failedCount: number;
  /** Whether the last verification succeeded */
  lastVerified: boolean;
  /** Timestamp of last verification */
  lastVerifiedAt?: string;
}

// =============================================================================
// Challenge Management
// =============================================================================

/**
 * Generate a new challenge nonce (8-char hex).
 */
export function generateChallenge(): string {
  return crypto.randomBytes(4).toString("hex");
}

/**
 * Create initial challenge state for a new session.
 */
export function createChallengeState(): ChallengeState {
  return {
    currentChallenge: generateChallenge(),
    verifiedCount: 0,
    failedCount: 0,
    lastVerified: true, // assume initial state is trusted
  };
}

/**
 * Verify a challenge response and rotate to a new challenge.
 *
 * @returns Object with verification result and new challenge
 */
export function verifyChallenge(
  state: ChallengeState,
  response: string,
): { valid: boolean; nextChallenge: string; state: ChallengeState } {
  const valid = response === state.currentChallenge;
  const nextChallenge = generateChallenge();

  const newState: ChallengeState = {
    currentChallenge: nextChallenge,
    verifiedCount: valid ? state.verifiedCount + 1 : state.verifiedCount,
    failedCount: valid ? state.failedCount : state.failedCount + 1,
    lastVerified: valid,
    lastVerifiedAt: new Date().toISOString(),
  };

  return { valid, nextChallenge, state: newState };
}

// =============================================================================
// Tool Definition
// =============================================================================

export function registerHeartbeatTool(): Tool {
  return {
    name: "nella_heartbeat",
    description: `Verify trust chain continuity via challenge-response.

Call this tool with the challenge value from your last nella tool response.
Returns verification status and a new challenge for the next call.

This is a lightweight security check — if the response doesn't match,
it may indicate the agent's behavior was altered between tool calls.`,
    inputSchema: {
      type: "object",
      properties: {
        challenge_response: {
          type: "string",
          description: "The challenge value from the previous nella tool response",
        },
      },
      required: ["challenge_response"],
    },
  };
}

// =============================================================================
// Tool Handler
// =============================================================================

interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
}

export function handleHeartbeat(
  args: Record<string, unknown>,
  challengeState: ChallengeState,
): { result: ToolCallResult; newState: ChallengeState } {
  const response = args.challenge_response as string;

  if (!response) {
    const nextChallenge = generateChallenge();
    const newState: ChallengeState = {
      ...challengeState,
      currentChallenge: nextChallenge,
      failedCount: challengeState.failedCount + 1,
      lastVerified: false,
      lastVerifiedAt: new Date().toISOString(),
    };

    return {
      result: {
        content: [{
          type: "text",
          text: [
            "### Heartbeat: FAILED",
            "",
            "No challenge response provided.",
            `Next challenge: \`${nextChallenge}\``,
            "",
            "Include this challenge value in your next nella tool call.",
          ].join("\n"),
        }],
      },
      newState,
    };
  }

  const { valid, nextChallenge, state: newState } = verifyChallenge(challengeState, response);

  const lines: string[] = [];

  if (valid) {
    lines.push("### Heartbeat: OK");
    lines.push("");
    lines.push("Trust chain verified successfully.");
  } else {
    lines.push("### Heartbeat: FAILED");
    lines.push("");
    lines.push("Challenge response did not match. Trust chain may be compromised.");
    lines.push("This could indicate prompt injection altered agent behavior between tool calls.");
  }

  lines.push("");
  lines.push(`Next challenge: \`${nextChallenge}\``);
  lines.push(`Verified: ${newState.verifiedCount} | Failed: ${newState.failedCount}`);

  return {
    result: {
      content: [{ type: "text", text: lines.join("\n") }],
    },
    newState,
  };
}
