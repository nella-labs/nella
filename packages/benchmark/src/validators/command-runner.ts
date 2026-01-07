/**
 * Command Runner
 *
 * Executes validation commands (test, lint, compile) and captures output
 */

import { execSync, ExecSyncOptionsWithStringEncoding } from "child_process";
import { ValidationConfig, ValidationResults } from "../types";

export interface CommandRunnerOptions {
  workDir: string;
  validation: ValidationConfig;
  timeout?: number;
}

export interface CommandResult {
  success: boolean;
  output: string;
  exitCode: number;
}

/**
 * Run a single command and capture output
 */
export function runCommand(
  command: string,
  workDir: string,
  timeout = 120000
): CommandResult {
  const options: ExecSyncOptionsWithStringEncoding = {
    cwd: workDir,
    encoding: "utf-8",
    timeout,
    stdio: "pipe",
    shell: true as unknown as string, // Let Node.js use default shell
    env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
  };

  try {
    const output = execSync(command, options);
    return {
      success: true,
      output: output.toString(),
      exitCode: 0,
    };
  } catch (error: unknown) {
    const execError = error as { status?: number; stdout?: string; stderr?: string; message?: string };
    const stdout = execError.stdout ?? "";
    const stderr = execError.stderr ?? "";
    const message = execError.message ?? "";

    return {
      success: false,
      output: `${stdout}\n${stderr}\n${message}`.trim(),
      exitCode: execError.status ?? 1,
    };
  }
}

/**
 * Run all validation commands and collect results
 */
export function runValidation(options: CommandRunnerOptions): ValidationResults {
  const { workDir, validation, timeout } = options;

  const results: ValidationResults = {
    testPassed: null,
    testOutput: "",
    lintPassed: null,
    lintOutput: "",
    compilePassed: null,
    compileOutput: "",
  };

  // Run test command
  if (validation.test) {
    const testResult = runCommand(validation.test, workDir, timeout);
    results.testPassed = testResult.success;
    results.testOutput = testResult.output;
  }

  // Run lint command
  if (validation.lint) {
    const lintResult = runCommand(validation.lint, workDir, timeout);
    results.lintPassed = lintResult.success;
    results.lintOutput = lintResult.output;
  }

  // Run compile/typecheck command
  if (validation.compile) {
    const compileResult = runCommand(validation.compile, workDir, timeout);
    results.compilePassed = compileResult.success;
    results.compileOutput = compileResult.output;
  }

  return results;
}

/**
 * Check if all validations passed
 */
export function allValidationsPassed(results: ValidationResults): boolean {
  const checks = [results.testPassed, results.lintPassed, results.compilePassed];

  // Only check non-null results (commands that were actually run)
  const runChecks = checks.filter((c) => c !== null);

  if (runChecks.length === 0) {
    return true; // No validations configured
  }

  return runChecks.every((c) => c === true);
}

/**
 * Get combined error output for retry prompt
 */
export function getErrorOutput(results: ValidationResults): string {
  const errors: string[] = [];

  if (results.testPassed === false) {
    errors.push(`=== TEST ERRORS ===\n${results.testOutput}`);
  }

  if (results.lintPassed === false) {
    errors.push(`=== LINT ERRORS ===\n${results.lintOutput}`);
  }

  if (results.compilePassed === false) {
    errors.push(`=== COMPILE ERRORS ===\n${results.compileOutput}`);
  }

  return errors.join("\n\n");
}
