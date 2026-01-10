/**
 * Command Runner
 *
 * Executes validation commands (test, lint, compile) and captures results.
 */

import { execSync, ExecSyncOptionsWithStringEncoding } from "child_process";
import { ValidationConfig, ValidationResult, CommandResult } from "../types";

/**
 * Default timeout for commands (2 minutes)
 */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Run a single command and capture output
 *
 * @param command - Shell command to execute
 * @param workDir - Working directory
 * @param timeoutMs - Timeout in milliseconds
 * @returns Command result with exit code and output
 */
export function runCommand(
  command: string,
  workDir: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): CommandResult {
  const startTime = Date.now();

  const options: ExecSyncOptionsWithStringEncoding = {
    cwd: workDir,
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: "pipe",
    shell: true as unknown as string,
    env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
  };

  try {
    const output = execSync(command, options);
    const durationMs = Date.now() - startTime;

    return {
      command,
      success: true,
      output: output.toString(),
      exitCode: 0,
      durationMs,
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;
    const execError = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    const stdout = execError.stdout ?? "";
    const stderr = execError.stderr ?? "";
    const message = execError.message ?? "";

    return {
      command,
      success: false,
      output: `${stdout}\n${stderr}\n${message}`.trim(),
      exitCode: execError.status ?? 1,
      durationMs,
    };
  }
}

/**
 * Run all validation commands
 *
 * @param config - Validation commands to run
 * @param workDir - Working directory
 * @param timeoutMs - Timeout per command
 * @returns Validation results with pass/fail status
 */
export function runValidation(
  config: ValidationConfig,
  workDir: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): ValidationResult {
  let testResult: CommandResult | null = null;
  let lintResult: CommandResult | null = null;
  let compileResult: CommandResult | null = null;

  // Run test command
  if (config.test) {
    testResult = runCommand(config.test, workDir, timeoutMs);
  }

  // Run lint command
  if (config.lint) {
    lintResult = runCommand(config.lint, workDir, timeoutMs);
  }

  // Run compile/typecheck command
  if (config.compile) {
    compileResult = runCommand(config.compile, workDir, timeoutMs);
  }

  // Check if all configured validations passed
  const allPassed =
    (testResult === null || testResult.success) &&
    (lintResult === null || lintResult.success) &&
    (compileResult === null || compileResult.success);

  return {
    test: testResult,
    lint: lintResult,
    compile: compileResult,
    allPassed,
  };
}

/**
 * Get combined error output from validation results
 */
export function getValidationErrors(result: ValidationResult): string {
  const errors: string[] = [];

  if (result.test && !result.test.success) {
    errors.push(`Test failed:\n${result.test.output}`);
  }

  if (result.lint && !result.lint.success) {
    errors.push(`Lint failed:\n${result.lint.output}`);
  }

  if (result.compile && !result.compile.success) {
    errors.push(`Compile failed:\n${result.compile.output}`);
  }

  return errors.join("\n\n");
}

/**
 * Calculate validation integrity (ratio of passed checks)
 */
export function calculateValidationIntegrity(result: ValidationResult): number {
  let passed = 0;
  let total = 0;

  if (result.test !== null) {
    total++;
    if (result.test.success) passed++;
  }

  if (result.lint !== null) {
    total++;
    if (result.lint.success) passed++;
  }

  if (result.compile !== null) {
    total++;
    if (result.compile.success) passed++;
  }

  return total > 0 ? passed / total : 1;
}
