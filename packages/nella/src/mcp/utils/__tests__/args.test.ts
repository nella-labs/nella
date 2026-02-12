import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkspaceArg } from "../args";

// =============================================================================
// Help Flag
// =============================================================================

test("parseWorkspaceArg: --help sets help=true", () => {
  assert.equal(parseWorkspaceArg(["--help"]).help, true);
});

test("parseWorkspaceArg: -h sets help=true", () => {
  assert.equal(parseWorkspaceArg(["-h"]).help, true);
});

test("parseWorkspaceArg: no args sets help=false", () => {
  assert.equal(parseWorkspaceArg([]).help, false);
});

// =============================================================================
// Workspace Argument
// =============================================================================

test("parseWorkspaceArg: -w value", () => {
  const result = parseWorkspaceArg(["-w", "/path/to/ws"]);
  assert.equal(result.workspace, "/path/to/ws");
});

test("parseWorkspaceArg: --workspace value", () => {
  const result = parseWorkspaceArg(["--workspace", "/my/ws"]);
  assert.equal(result.workspace, "/my/ws");
});

test("parseWorkspaceArg: --workspace=value", () => {
  const result = parseWorkspaceArg(["--workspace=/inline/ws"]);
  assert.equal(result.workspace, "/inline/ws");
});

test("parseWorkspaceArg: -w without value is ignored", () => {
  const result = parseWorkspaceArg(["-w"]);
  assert.equal(result.workspace, undefined);
});

test("parseWorkspaceArg: -w with flag as next arg is ignored", () => {
  const result = parseWorkspaceArg(["-w", "--help"]);
  assert.equal(result.workspace, undefined);
  assert.equal(result.help, true);
});

test("parseWorkspaceArg: combo -w and --help", () => {
  const result = parseWorkspaceArg(["-w", "/ws", "--help"]);
  assert.equal(result.workspace, "/ws");
  assert.equal(result.help, true);
});

test("parseWorkspaceArg: workspace undefined when not provided", () => {
  const result = parseWorkspaceArg(["--help"]);
  assert.equal(result.workspace, undefined);
});
