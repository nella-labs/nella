/**
 * Fixture Manager
 *
 * Handles cloning fixtures, applying changes, and generating diffs
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync, spawnSync } from "child_process";
import { FileChange } from "../types";

export interface FixtureManagerOptions {
  fixturesDir: string;
  fixtureName: string;
}

export interface InstallResult {
  success: boolean;
  output: string;
  duration: number;
}

export interface BaselineCheckResult {
  success: boolean;
  compile: { passed: boolean; output: string } | null;
  lint: { passed: boolean; output: string } | null;
  test: { passed: boolean; output: string } | null;
  errors: string[];
}

export class FixtureManager {
  private fixturesDir: string;
  private fixtureName: string;
  private workDir: string | null = null;
  private dependenciesInstalled = false;

  constructor(options: FixtureManagerOptions) {
    this.fixturesDir = options.fixturesDir;
    this.fixtureName = options.fixtureName;
  }

  /**
   * Get the working directory (clone of fixture)
   */
  getWorkDir(): string {
    if (!this.workDir) {
      throw new Error("Fixture not initialized. Call setup() first.");
    }
    return this.workDir;
  }

  /**
   * Clone fixture to a temporary directory and initialize git
   */
  async setup(): Promise<string> {
    const sourcePath = path.join(this.fixturesDir, this.fixtureName);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Fixture not found: ${sourcePath}`);
    }

    // Create temp directory
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nella-benchmark-"));
    this.workDir = tempDir;

    // Copy fixture to temp directory (excluding .git folder)
    this.copyDirSync(sourcePath, tempDir);

    // Initialize a fresh git repo for tracking changes
    // Create a clean env without git-related vars to avoid interference from parent repo
    const cleanGitEnv = { ...process.env };
    delete cleanGitEnv.GIT_DIR;
    delete cleanGitEnv.GIT_WORK_TREE;
    delete cleanGitEnv.GIT_INDEX_FILE;
    delete cleanGitEnv.GIT_OBJECT_DIRECTORY;
    delete cleanGitEnv.GIT_ALTERNATE_OBJECT_DIRECTORIES;
    delete cleanGitEnv.GIT_CEILING_DIRECTORIES;

    execSync("git init --initial-branch=main", { cwd: tempDir, stdio: "pipe", env: cleanGitEnv });
    execSync("git add .", { cwd: tempDir, stdio: "pipe", env: cleanGitEnv });
    execSync('git commit -m "Initial state"', { cwd: tempDir, stdio: "pipe", env: cleanGitEnv });

    return tempDir;
  }

  /**
   * Install npm dependencies in the fixture
   */
  async installDependencies(): Promise<InstallResult> {
    if (!this.workDir) {
      throw new Error("Fixture not initialized. Call setup() first.");
    }

    const startTime = Date.now();

    // Check if package.json exists
    const packageJsonPath = path.join(this.workDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      return {
        success: true,
        output: "No package.json found, skipping install",
        duration: 0,
      };
    }

    try {
      // Use npm ci for faster, more reliable installs if lock file exists
      const lockPath = path.join(this.workDir, "package-lock.json");
      const command = fs.existsSync(lockPath) ? "npm ci" : "npm install";

      const result = spawnSync(command.split(" ")[0], command.split(" ").slice(1), {
        cwd: this.workDir,
        encoding: "utf-8",
        timeout: 300000, // 5 minute timeout for install
        shell: true,
        env: { ...process.env, CI: "true" },
      });

      const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
      const success = result.status === 0;

      if (success) {
        this.dependenciesInstalled = true;

        // Create .env file with reasonable defaults for testing
        const envPath = path.join(this.workDir, ".env");
        if (!fs.existsSync(envPath)) {
          try {
            // Default environment for testing
            const envContent = [
              "NODE_ENV=development",
              "PORT=3000",
              "APP_BASE_URL=http://localhost:3000",
              "DATABASE_URL=postgresql://test:test@localhost:5432/test?schema=public",
            ].join("\n");
            fs.writeFileSync(envPath, envContent);
          } catch {
            // .env creation is optional
          }
        }

        // Also run prisma generate if prisma is present
        const prismaSchemaPath = path.join(this.workDir, "prisma", "schema.prisma");
        if (fs.existsSync(prismaSchemaPath)) {
          try {
            spawnSync("npx", ["prisma", "generate"], {
              cwd: this.workDir,
              encoding: "utf-8",
              timeout: 60000,
              shell: true,
              env: { ...process.env, CI: "true" },
            });
          } catch {
            // Prisma generate is optional
          }
        }
      }

      return {
        success,
        output,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Run baseline validation to ensure fixture works before agent changes
   */
  async runBaselineCheck(validation: { test?: string; lint?: string; compile?: string }): Promise<BaselineCheckResult> {
    if (!this.workDir) {
      throw new Error("Fixture not initialized. Call setup() first.");
    }

    const result: BaselineCheckResult = {
      success: true,
      compile: null,
      lint: null,
      test: null,
      errors: [],
    };

    // Run compile check first (fastest, most likely to catch setup issues)
    if (validation.compile) {
      const compileResult = this.runBaselineCommand(validation.compile);
      result.compile = compileResult;
      if (!compileResult.passed) {
        result.success = false;
        result.errors.push(`Compile failed: ${this.categorizeError(compileResult.output)}`);
      }
    }

    // Run lint check
    if (validation.lint) {
      const lintResult = this.runBaselineCommand(validation.lint);
      result.lint = lintResult;
      if (!lintResult.passed) {
        result.success = false;
        result.errors.push(`Lint failed: ${this.categorizeError(lintResult.output)}`);
      }
    }

    // Run test check (slowest, skip if earlier checks failed)
    if (validation.test && result.success) {
      const testResult = this.runBaselineCommand(validation.test);
      result.test = testResult;
      if (!testResult.passed) {
        result.success = false;
        result.errors.push(`Test failed: ${this.categorizeError(testResult.output)}`);
      }
    }

    return result;
  }

  /**
   * Run a single baseline command
   */
  private runBaselineCommand(command: string): { passed: boolean; output: string } {
    if (!this.workDir) {
      return { passed: false, output: "Fixture not initialized" };
    }

    try {
      const result = spawnSync(command, [], {
        cwd: this.workDir,
        encoding: "utf-8",
        timeout: 120000,
        shell: true,
        env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
      });

      return {
        passed: result.status === 0,
        output: `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
      };
    } catch (error) {
      return {
        passed: false,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Categorize an error as environment or code issue
   */
  categorizeError(output: string): string {
    const lowerOutput = output.toLowerCase();

    // Environment/setup issues
    if (lowerOutput.includes("enoent") || lowerOutput.includes("command not found")) {
      return "ENVIRONMENT: Command not found or path issue";
    }
    if (lowerOutput.includes("cannot find module") || lowerOutput.includes("module not found")) {
      return "ENVIRONMENT: Missing dependencies (run npm install)";
    }
    if (lowerOutput.includes("econnrefused") || lowerOutput.includes("connection refused")) {
      return "ENVIRONMENT: Database/service connection failed";
    }
    if (lowerOutput.includes("prisma") && lowerOutput.includes("generate")) {
      return "ENVIRONMENT: Prisma client not generated";
    }
    if (lowerOutput.includes("no such file or directory")) {
      return "ENVIRONMENT: Missing file or directory";
    }
    if (lowerOutput.includes("permission denied") || lowerOutput.includes("eacces")) {
      return "ENVIRONMENT: Permission denied";
    }

    // Code/logic issues
    if (lowerOutput.includes("typeerror") || lowerOutput.includes("syntaxerror")) {
      return "CODE: JavaScript/TypeScript runtime error";
    }
    if (lowerOutput.includes("ts") && lowerOutput.includes("error")) {
      return "CODE: TypeScript compilation error";
    }
    if (lowerOutput.includes("expected") || lowerOutput.includes("assertion")) {
      return "CODE: Test assertion failed";
    }
    if (lowerOutput.includes("eslint") || lowerOutput.includes("lint")) {
      return "CODE: Linting error";
    }

    return "UNKNOWN: Check output for details";
  }

  /**
   * Check if dependencies have been installed
   */
  areDependenciesInstalled(): boolean {
    return this.dependenciesInstalled;
  }

  /**
   * Apply file changes from agent response
   */
  applyChanges(changes: FileChange[]): void {
    if (!this.workDir) {
      throw new Error("Fixture not initialized. Call setup() first.");
    }

    for (const change of changes) {
      const filePath = path.join(this.workDir, change.path);
      const dirPath = path.dirname(filePath);

      switch (change.operation) {
        case "create":
        case "modify":
          // Ensure directory exists
          if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
          }
          fs.writeFileSync(filePath, change.content, "utf-8");
          break;

        case "delete":
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          break;
      }
    }
  }

  /**
   * Get list of modified files (compared to initial state)
   */
  getModifiedFiles(): string[] {
    if (!this.workDir) {
      throw new Error("Fixture not initialized. Call setup() first.");
    }

    try {
      const output = execSync("git diff --name-only HEAD", {
        cwd: this.workDir,
        encoding: "utf-8",
      });

      const untrackedOutput = execSync("git ls-files --others --exclude-standard", {
        cwd: this.workDir,
        encoding: "utf-8",
      });

      const modified = output.trim().split("\n").filter(Boolean);
      const untracked = untrackedOutput.trim().split("\n").filter(Boolean);

      return [...modified, ...untracked];
    } catch {
      return [];
    }
  }

  /**
   * Generate git diff of all changes
   */
  getDiff(): string {
    if (!this.workDir) {
      throw new Error("Fixture not initialized. Call setup() first.");
    }

    try {
      // Stage all changes to include new files in diff
      execSync("git add .", { cwd: this.workDir, stdio: "pipe" });

      const output = execSync("git diff --cached", {
        cwd: this.workDir,
        encoding: "utf-8",
      });

      return output;
    } catch {
      return "";
    }
  }

  /**
   * Reset fixture to initial state
   */
  reset(): void {
    if (!this.workDir) {
      return;
    }

    try {
      execSync("git checkout .", { cwd: this.workDir, stdio: "pipe" });
      execSync("git clean -fd", { cwd: this.workDir, stdio: "pipe" });
    } catch {
      // Ignore errors during reset
    }
  }

  /**
   * Clean up temporary directory
   */
  cleanup(): void {
    if (this.workDir && fs.existsSync(this.workDir)) {
      fs.rmSync(this.workDir, { recursive: true, force: true });
      this.workDir = null;
    }
  }

  /**
   * Read a file from the fixture
   */
  readFile(relativePath: string): string {
    if (!this.workDir) {
      throw new Error("Fixture not initialized. Call setup() first.");
    }

    const filePath = path.join(this.workDir, relativePath);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${relativePath}`);
    }

    return fs.readFileSync(filePath, "utf-8");
  }

  /**
   * Get the file tree of the fixture
   */
  getFileTree(dir?: string, prefix = ""): string[] {
    if (!this.workDir) {
      throw new Error("Fixture not initialized. Call setup() first.");
    }

    const targetDir = dir ?? this.workDir;
    const files: string[] = [];

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip node_modules, .git, and other common excludes
      if (["node_modules", ".git", "dist", "coverage"].includes(entry.name)) {
        continue;
      }

      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        files.push(`${relativePath}/`);
        const subFiles = this.getFileTree(path.join(targetDir, entry.name), relativePath);
        files.push(...subFiles);
      } else {
        files.push(relativePath);
      }
    }

    return files;
  }

  /**
   * Copy directory recursively
   */
  private copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      // Skip .git (file or folder) and node_modules for clean copy
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }

      if (entry.isDirectory()) {
        this.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
