/**
 * Scenario/Task Loader
 *
 * Loads benchmark tasks from YAML files in the tasks/ directory
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  Task,
  RawTaskYaml,
  ScenarioLoadResult,
  Constraint,
  TaskCategory,
  TaskDifficulty,
} from "./types";

/**
 * Load all tasks from the tasks directory
 */
export function loadAllTasks(tasksDir: string): ScenarioLoadResult {
  const tasks: Task[] = [];
  const errors: Array<{ file: string; error: string }> = [];

  if (!fs.existsSync(tasksDir)) {
    return { tasks, errors: [{ file: tasksDir, error: "Tasks directory not found" }] };
  }

  const taskFolders = fs.readdirSync(tasksDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  for (const folder of taskFolders) {
    const taskFile = path.join(tasksDir, folder, "task.yaml");

    if (!fs.existsSync(taskFile)) {
      errors.push({ file: taskFile, error: "task.yaml not found" });
      continue;
    }

    try {
      const content = fs.readFileSync(taskFile, "utf-8");
      const raw = yaml.load(content) as RawTaskYaml;
      const task = parseTask(raw);
      tasks.push(task);
    } catch (err) {
      errors.push({
        file: taskFile,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { tasks, errors };
}

/**
 * Load a single task by ID
 */
export function loadTask(tasksDir: string, taskId: string): Task | null {
  const taskFile = path.join(tasksDir, taskId, "task.yaml");

  if (!fs.existsSync(taskFile)) {
    return null;
  }

  const content = fs.readFileSync(taskFile, "utf-8");
  const raw = yaml.load(content) as RawTaskYaml;
  return parseTask(raw);
}

/**
 * Parse raw YAML into a validated Task object
 */
function parseTask(raw: RawTaskYaml): Task {
  const constraints: Constraint[] = (raw.constraints ?? []).map((c) => ({
    id: c.id,
    description: c.description,
    rule: c.rule,
    filesNotToModify: c.files_not_to_modify,
    forbiddenPatterns: c.forbidden_patterns,
  }));

  return {
    id: raw.id,
    name: raw.name,
    prompt: raw.prompt,
    category: raw.category as TaskCategory,
    difficulty: raw.difficulty as TaskDifficulty,
    fixture: raw.fixture,
    constraints,
    validation: {
      test: raw.validation?.test,
      lint: raw.validation?.lint,
      compile: raw.validation?.compile,
    },
    expected: {
      filesToModify: raw.expected?.files_to_modify ?? [],
      filesToIgnore: raw.expected?.files_to_ignore ?? [],
      expectedLineCount: raw.expected?.expected_line_count,
    },
    refusalExpected: raw.refusal_expected,
    refusalPatterns: raw.refusal_patterns,
    timeoutSeconds: raw.timeout_seconds,
  };
}

/**
 * Get tasks filtered by category
 */
export function getTasksByCategory(tasks: Task[], category: TaskCategory): Task[] {
  return tasks.filter((t) => t.category === category);
}

/**
 * Get tasks filtered by difficulty
 */
export function getTasksByDifficulty(tasks: Task[], difficulty: TaskDifficulty): Task[] {
  return tasks.filter((t) => t.difficulty === difficulty);
}

/**
 * Get all task IDs
 */
export function getTaskIds(tasks: Task[]): string[] {
  return tasks.map((t) => t.id);
}

/**
 * Exported for backwards compatibility with old index.ts
 * Will be populated when loadAllTasks is called
 */
export let allScenarios: Task[] = [];

/**
 * Initialize scenarios from default location
 */
export function initializeScenarios(tasksDir?: string): ScenarioLoadResult {
  const dir = tasksDir ?? path.resolve(__dirname, "../../../tasks");
  const result = loadAllTasks(dir);
  allScenarios = result.tasks;
  return result;
}
