/**
 * Benchmark package for evaluating coding agents
 * Tests different agents (Claude Code, Copilot, Nella, etc.) against standardized scenarios
 */

export * from "./types";
export * from "./scenarios";
export * from "./adapters";
export * from "./runner";
export * from "./validators";
export * from "./metrics";
export * from "./reports";

import { allScenarios, initializeScenarios } from "./scenarios";
import { Task, TaskCategory, TaskDifficulty } from "./types";

export function getBenchmarkInfo() {
  return {
    name: "Nella Benchmark Suite",
    version: "0.1.0",
    totalScenarios: allScenarios.length,
    categories: [
      "feature",
      "bug-fix",
      "refactor",
      "edge-case",
      "refusal",
    ] as TaskCategory[],
    difficulties: [
      "easy",
      "medium",
      "hard",
    ] as TaskDifficulty[],
  };
}

export function getSummary() {
  const summary = {
    totalScenarios: allScenarios.length,
    byCategory: {} as Record<string, number>,
    byDifficulty: {} as Record<string, number>,
  };

  for (const scenario of allScenarios) {
    summary.byCategory[scenario.category] =
      (summary.byCategory[scenario.category] ?? 0) + 1;
    summary.byDifficulty[scenario.difficulty] =
      (summary.byDifficulty[scenario.difficulty] ?? 0) + 1;
  }

  return summary;
}

/**
 * Initialize the benchmark suite by loading all tasks
 */
export function initialize(tasksDir?: string) {
  return initializeScenarios(tasksDir);
}

/**
 * Get all loaded tasks
 */
export function getAllTasks(): Task[] {
  return allScenarios;
}

