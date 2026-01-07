/**
 * Benchmark Runner
 *
 * Orchestrates the full benchmark workflow:
 * 1. Load tasks
 * 2. For each agent and task:
 *    a. Clone fixture to temp directory
 *    b. Build system/user prompt
 *    c. Call agent API
 *    d. Parse response, apply changes
 *    e. Run validation (test, lint, compile)
 *    f. Check constraints
 *    g. Retry if failed (up to maxIterations)
 *    h. Compute metrics
 *    i. Write artifacts and results
 * 3. Generate summary report
 */

import * as path from "path";
import {
  Task,
  BenchmarkConfig,
  TaskRun,
  ValidationResults,
  AgentResponse,
  RunArtifacts,
  LogEntry,
  TokenUsage,
} from "../types";
import { loadAllTasks } from "../scenarios";
import { createAgentAdapter, AgentAdapter } from "../adapters";
import { FixtureManager } from "./fixture-manager";
import { PromptBuilder } from "./prompt-builder";
import { runCommand } from "../validators/command-runner";
import { checkAllConstraints, ConstraintCheckResult } from "../validators/constraint-checker";
import { checkScopeCreep, ScopeCheckResult } from "../validators/scope-checker";
import { calculateMetrics, MetricsInput } from "../metrics/calculator";
import { appendResult, writeSummaryMarkdown, writeArtifacts, createLogEntry, readResults } from "../reports";

export interface BenchmarkRunnerOptions {
  config: BenchmarkConfig;
  tasks?: Task[];
  tasksDir?: string;
}

export interface RunOptions {
  tasks?: string[]; // Task IDs to run (default: all)
  agents?: string[]; // Agent names to use (default: all configured)
  skipCompleted?: boolean; // Skip tasks already in results.jsonl
}

export class BenchmarkRunner {
  private config: BenchmarkConfig;
  private tasks: Task[] = [];
  private adapters: Map<string, AgentAdapter> = new Map();

  constructor(options: BenchmarkRunnerOptions) {
    this.config = options.config;

    if (options.tasks) {
      this.tasks = options.tasks;
    } else if (options.tasksDir) {
      const result = loadAllTasks(options.tasksDir);
      this.tasks = result.tasks;
    }
  }

  /**
   * Run benchmark for all tasks and agents
   */
  async runAll(options: RunOptions = {}): Promise<TaskRun[]> {
    const allRuns: TaskRun[] = [];

    // Filter tasks
    let tasksToRun = this.tasks;
    if (options.tasks?.length) {
      tasksToRun = this.tasks.filter((t) => options.tasks!.includes(t.id));
    }

    // Filter agents - config.agents is Record<string, AgentConfig>
    const allAgentNames = Object.keys(this.config.agents);
    let agentNamesToUse = allAgentNames;
    if (options.agents?.length) {
      agentNamesToUse = allAgentNames.filter((name) => options.agents!.includes(name));
    }

    // Get existing results if skipping completed
    const existingResults = options.skipCompleted ? readResults(this.config.outputDir) : [];
    const completedKeys = new Set(existingResults.map((r) => `${r.agent}:${r.taskId}`));

    const maxIterations = this.config.maxIterations ?? 3;

    console.log(`\n🚀 Starting benchmark`);
    console.log(`   Tasks: ${tasksToRun.length}`);
    console.log(`   Agents: ${agentNamesToUse.join(", ")}`);
    console.log(`   Max iterations: ${maxIterations}`);
    console.log(`   Output: ${this.config.outputDir}\n`);

    for (const agentName of agentNamesToUse) {
      console.log(`\n📦 Agent: ${agentName}\n`);

      const agentConfig = this.config.agents[agentName];

      // Get or create adapter
      let adapter = this.adapters.get(agentName);
      if (!adapter) {
        adapter = createAgentAdapter(agentConfig);
        this.adapters.set(agentName, adapter);
      }

      for (const task of tasksToRun) {
        const key = `${agentName}:${task.id}`;

        if (completedKeys.has(key)) {
          console.log(`   ⏭️  ${task.id} (skipped - already completed)`);
          continue;
        }

        console.log(`   🔄 ${task.id}...`);

        try {
          const run = await this.runTask(task, adapter, agentName, maxIterations);
          allRuns.push(run);

          // Append to results.jsonl
          appendResult(this.config.outputDir, run);

          const status = run.passed ? "✅" : run.refused ? (run.metrics.rc ? "✅ RC" : "❌ RC") : "❌";
          console.log(`      ${status} TTG: ${run.metrics.ttg.toFixed(1)}s, Cost: $${run.metrics.estimatedCost.toFixed(4)}`);
        } catch (error) {
          console.error(`      ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Generate summary
    console.log(`\n📊 Generating summary...`);
    const allResults = [...existingResults, ...allRuns];
    writeSummaryMarkdown({
      outputDir: this.config.outputDir,
      runs: allResults,
      tasks: this.tasks,
    });

    console.log(`\n✅ Benchmark complete!`);
    console.log(`   Results: ${path.join(this.config.outputDir, "results.jsonl")}`);
    console.log(`   Summary: ${path.join(this.config.outputDir, "summary.md")}\n`);

    return allRuns;
  }

  /**
   * Run a single task with a specific agent
   */
  async runTask(
    task: Task,
    adapter: AgentAdapter,
    agentName: string,
    maxIterations: number
  ): Promise<TaskRun> {
    const startTime = Date.now();
    const logs: LogEntry[] = [];
    const commands: string[] = [];

    let iteration = 0;
    let passed = false;
    let refused = false;
    let lastResponse: AgentResponse | null = null;
    let lastValidation: ValidationResults | null = null;
    let lastDiff = "";
    let tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let scopeCheck: ScopeCheckResult | null = null;
    let constraintChecks: ConstraintCheckResult[] = [];
    let filesModified: string[] = [];

    // Create fixture manager
    const fixtureManager = new FixtureManager({
      fixturesDir: this.config.fixturesDir,
      fixtureName: task.fixture,
    });

    // Setup fixture
    const workDir = await fixtureManager.setup();
    logs.push(createLogEntry("command", `Cloned fixture to ${workDir}`));

    // Install dependencies
    logs.push(createLogEntry("command", "Installing dependencies..."));
    const installResult = await fixtureManager.installDependencies();
    if (!installResult.success) {
      logs.push(createLogEntry("command", `Dependency install failed: ${installResult.output}`));
      console.log(`      ⚠️  npm install failed (${installResult.duration}ms)`);
    } else {
      logs.push(createLogEntry("command", `Dependencies installed in ${installResult.duration}ms`));
    }

    // Run baseline check to ensure fixture works before agent changes
    if (installResult.success && task.validation) {
      logs.push(createLogEntry("command", "Running baseline validation..."));
      const baseline = await fixtureManager.runBaselineCheck(task.validation);
      if (!baseline.success) {
        logs.push(createLogEntry("command", `Baseline check failed: ${baseline.errors.join(", ")}`));
        console.log(`      ⚠️  Baseline failed: ${baseline.errors[0] || "unknown"}`);
        // Continue anyway - agent might fix baseline issues
      } else {
        logs.push(createLogEntry("command", "Baseline validation passed"));
      }
    }

    try {
      // Build prompts
      const promptBuilder = new PromptBuilder({ task, fixtureManager });
      const systemPrompt = promptBuilder.buildSystemPrompt();
      let userPrompt = promptBuilder.buildUserPrompt();

      // Iteration loop
      while (iteration < maxIterations && !passed && !refused) {
        iteration++;
        logs.push(createLogEntry("command", `Iteration ${iteration}`));

        // Call agent
        logs.push(createLogEntry("prompt", userPrompt));

        const result = await adapter.call({
          systemPrompt,
          userPrompt,
        });

        lastResponse = result.response;
        tokenUsage = {
          inputTokens: tokenUsage.inputTokens + result.tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens + result.tokenUsage.outputTokens,
          totalTokens: tokenUsage.totalTokens + result.tokenUsage.totalTokens,
        };

        logs.push(createLogEntry("response", JSON.stringify(result.response)));

        // Check for refusal
        if (result.response.action === "refuse") {
          refused = true;
          logs.push(createLogEntry("decision", `Agent refused: ${result.response.explanation}`));
          break;
        }

        // Apply file changes
        if (result.response.files?.length) {
          fixtureManager.applyChanges(result.response.files);
          logs.push(createLogEntry("command", `Applied ${result.response.files.length} file changes`));
        }

        // Get diff and modified files
        lastDiff = fixtureManager.getDiff();
        filesModified = fixtureManager.getModifiedFiles();

        // Run validation
        lastValidation = await this.runValidation(workDir, task, commands);
        logs.push(createLogEntry("validation", JSON.stringify(lastValidation)));

        // Check constraints
        constraintChecks = checkAllConstraints(filesModified, lastDiff, task.constraints);
        const constraintsPassed = constraintChecks.every((c) => !c.violated);

        // Check scope creep
        scopeCheck = checkScopeCreep(filesModified, task.expected);

        // Check if passed
        const testOk = lastValidation.testPassed !== false;
        const lintOk = lastValidation.lintPassed !== false;
        const compileOk = lastValidation.compilePassed !== false;

        if (testOk && lintOk && compileOk && constraintsPassed) {
          passed = true;
          logs.push(createLogEntry("decision", "All validations passed"));
          break;
        }

        // Build retry prompt with error feedback
        const errorFeedback = this.buildErrorFeedback(lastValidation, constraintChecks);
        userPrompt = promptBuilder.buildRetryPrompt(errorFeedback);
        logs.push(createLogEntry("command", `Retry with error: ${errorFeedback.substring(0, 200)}...`));
      }

      // Calculate metrics
      const endTime = Date.now();

      const metricsInput: MetricsInput = {
        task,
        validation: lastValidation ?? {
          testPassed: null,
          testOutput: "",
          lintPassed: null,
          lintOutput: "",
          compilePassed: null,
          compileOutput: "",
        },
        scopeCheck: scopeCheck ?? {
          expectedFiles: [],
          actualFiles: [],
          extraFiles: [],
          missingFiles: [],
          scopeCreepRatio: 0,
        },
        constraintChecks,
        tokenUsage,
        model: adapter.getModel(),
        startTime,
        endTime,
        iterations: iteration,
        agentResponse: lastResponse ?? { action: "edit", files: [], explanation: "" },
        actualDiff: lastDiff,
        expectedDiffPath: path.join(this.config.tasksDir, task.id, "expected.patch"),
      };

      const metrics = calculateMetrics(metricsInput);

      // Build artifacts
      const artifactDir = path.join(this.config.outputDir, agentName, task.id);
      const artifacts: RunArtifacts = {
        diffPatch: lastDiff,
        logs,
        commands,
        outputPath: artifactDir,
      };

      // Create run result
      const run: TaskRun = {
        taskId: task.id,
        agent: agentName,
        timestamp: new Date().toISOString(),
        passed,
        refused,
        metrics,
        validation: lastValidation ?? {
          testPassed: null,
          testOutput: "",
          lintPassed: null,
          lintOutput: "",
          compilePassed: null,
          compileOutput: "",
        },
        filesModified,
        constraintViolations: constraintChecks.filter((c) => c.violated).map((c) => c.reason ?? c.constraintId),
        explanation: lastResponse?.explanation ?? "",
      };

      // Write artifacts
      writeArtifacts(
        { outputDir: this.config.outputDir, agent: agentName, taskId: task.id },
        artifacts,
        run
      );

      return run;
    } finally {
      // Cleanup temp directory
      fixtureManager.cleanup();
    }
  }

  /**
   * Run all validation checks
   */
  private async runValidation(
    workDir: string,
    task: Task,
    commands: string[]
  ): Promise<ValidationResults> {
    const validation: ValidationResults = {
      testPassed: null,
      testOutput: "",
      lintPassed: null,
      lintOutput: "",
      compilePassed: null,
      compileOutput: "",
    };

    // Run test command
    if (task.validation?.test) {
      const cmd = task.validation.test;
      commands.push(cmd);
      const result = runCommand(cmd, workDir);
      validation.testPassed = result.success;
      validation.testOutput = result.output;
    }

    // Run lint command
    if (task.validation?.lint) {
      const cmd = task.validation.lint;
      commands.push(cmd);
      const result = runCommand(cmd, workDir);
      validation.lintPassed = result.success;
      validation.lintOutput = result.output;
    }

    // Run compile/typecheck command
    if (task.validation?.compile) {
      const cmd = task.validation.compile;
      commands.push(cmd);
      const result = runCommand(cmd, workDir);
      validation.compilePassed = result.success;
      validation.compileOutput = result.output;
    }

    return validation;
  }

  /**
   * Build error feedback string from validation results
   */
  private buildErrorFeedback(
    validation: ValidationResults,
    constraintChecks: ConstraintCheckResult[]
  ): string {
    const errors: string[] = [];

    if (validation.testPassed === false && validation.testOutput) {
      errors.push(`Test failures:\n${validation.testOutput}`);
    }

    if (validation.lintPassed === false && validation.lintOutput) {
      errors.push(`Lint errors:\n${validation.lintOutput}`);
    }

    if (validation.compilePassed === false && validation.compileOutput) {
      errors.push(`Type errors:\n${validation.compileOutput}`);
    }

    const violations = constraintChecks.filter((c) => c.violated);
    if (violations.length > 0) {
      errors.push(`Constraint violations:\n${violations.map((v) => v.reason ?? v.constraintId).join("\n")}`);
    }

    return errors.join("\n\n");
  }
}

/**
 * Create a benchmark runner with default configuration
 */
export function createBenchmarkRunner(options: BenchmarkRunnerOptions): BenchmarkRunner {
  return new BenchmarkRunner(options);
}
