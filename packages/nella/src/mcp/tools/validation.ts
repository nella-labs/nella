/**
 * Validation Tools
 *
 * MCP tools for checking constraints, running validations, and executing full runs.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  runTask,
  checkConstraints,
  runValidation,
  type Task,
  type Changes,
  type Constraint,
  type RunResult,
  type ValidationResult,
  type FileChange,
} from "@nella-labs/core";
import type { ServerContext } from "../server";

// =============================================================================
// Tool Definitions
// =============================================================================

export function registerValidationTools(): Tool[] {
  return [
    {
      name: "nella_check",
      description: `Check if proposed changes comply with task constraints.
      
Use this for quick constraint checking before making changes:
- Verify file modifications are within scope
- Check for forbidden pattern violations
- Ensure files-not-to-modify rules are respected

Returns constraint violations if any rules would be broken.`,
      inputSchema: {
        type: "object",
        properties: {
          constraints: {
            type: "array",
            description: "Constraints to check against",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Constraint ID" },
                description: { type: "string", description: "What the constraint checks" },
                rule: { type: "string", description: "The rule being enforced" },
                filesNotToModify: {
                  type: "array",
                  items: { type: "string" },
                  description: "Glob patterns for files that must not be modified",
                },
                forbiddenPatterns: {
                  type: "array",
                  items: { type: "string" },
                  description: "Regex patterns that must not appear in changes",
                },
              },
              required: ["id", "description", "rule"],
            },
          },
          modifiedFiles: {
            type: "array",
            items: { type: "string" },
            description: "List of files that were modified",
          },
          diff: {
            type: "string",
            description: "Unified diff of proposed changes",
          },
        },
        required: ["constraints", "modifiedFiles", "diff"],
      },
    },
    {
      name: "nella_validate",
      description: `Run validation commands to verify changes work correctly.
      
Use this after making changes to ensure they don't break anything:
- Run tests, linters, type checkers
- Execute build commands
- Verify custom validation scripts

Returns command outputs and success/failure status.`,
      inputSchema: {
        type: "object",
        properties: {
          test: {
            type: "string",
            description: "Test command to run (e.g., 'npm test')",
          },
          lint: {
            type: "string",
            description: "Lint command to run (e.g., 'npm run lint')",
          },
          compile: {
            type: "string",
            description: "Compile/typecheck command (e.g., 'npm run build')",
          },
        },
      },
    },
    {
      name: "nella_run",
      description: `Execute a complete Nella task validation.
      
This is the comprehensive validation that combines:
1. Refusal check (should this task be refused?)
2. Constraint checking (scope, forbidden patterns, etc.)
3. Validation execution (tests, lints, builds)
4. Scope creep detection
5. Metrics calculation

Use this for thorough validation of completed work.`,
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Unique identifier for this task",
          },
          taskName: {
            type: "string",
            description: "Human-readable task name",
          },
          prompt: {
            type: "string",
            description: "The task prompt/description",
          },
          constraints: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                description: { type: "string" },
                rule: { type: "string" },
                filesNotToModify: { type: "array", items: { type: "string" } },
                forbiddenPatterns: { type: "array", items: { type: "string" } },
              },
            },
          },
          validation: {
            type: "object",
            properties: {
              test: { type: "string" },
              lint: { type: "string" },
              compile: { type: "string" },
            },
          },
          expectedFiles: {
            type: "array",
            items: { type: "string" },
            description: "Files expected to be modified",
          },
          changes: {
            type: "object",
            properties: {
              diff: { type: "string", description: "Unified diff" },
              files: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    path: { type: "string" },
                    content: { type: "string" },
                  },
                },
              },
            },
          },
        },
        required: ["taskId", "taskName", "prompt", "changes"],
      },
    },
  ];
}

// =============================================================================
// Tool Handlers
// =============================================================================

interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export async function handleValidationTool(
  name: string,
  args: Record<string, unknown>,
  context: ServerContext
): Promise<ToolCallResult | null> {
  switch (name) {
    case "nella_check":
      return handleCheck(args, context);
    case "nella_validate":
      return handleValidate(args, context);
    case "nella_run":
      return handleRun(args, context);
    default:
      return null;
  }
}

async function handleCheck(
  args: Record<string, unknown>,
  _context: ServerContext
): Promise<ToolCallResult> {
  const constraints = args.constraints as Constraint[];
  const modifiedFiles = args.modifiedFiles as string[];
  const diff = args.diff as string;

  const results = checkConstraints(modifiedFiles, diff, constraints);

  const lines: string[] = [];
  const allPassed = results.every(r => r.passed);
  
  lines.push(`## Constraint Check: ${allPassed ? "✅ PASSED" : "❌ FAILED"}`);
  lines.push("");

  for (const result of results) {
    const status = result.passed ? "✅" : "❌";
    lines.push(`- ${status} **${result.id}**`);
    if (!result.passed && result.violationDetails) {
      lines.push(`  - ${result.violationDetails}`);
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: !allPassed,
  };
}

async function handleValidate(
  args: Record<string, unknown>,
  context: ServerContext
): Promise<ToolCallResult> {
  const validationConfig = {
    test: args.test as string | undefined,
    lint: args.lint as string | undefined,
    compile: args.compile as string | undefined,
  };

  const result: ValidationResult = runValidation(
    validationConfig,
    context.workspacePath
  );

  const lines: string[] = [];
  lines.push(`## Validation: ${result.allPassed ? "✅ PASSED" : "❌ FAILED"}`);
  lines.push("");

  if (result.test) {
    const status = result.test.success ? "✅" : "❌";
    lines.push(`### ${status} Tests`);
    lines.push(`- Duration: ${result.test.durationMs}ms`);
    if (!result.test.success) {
      lines.push("```");
      lines.push(result.test.output.slice(0, 1000));
      lines.push("```");
    }
  }

  if (result.lint) {
    const status = result.lint.success ? "✅" : "❌";
    lines.push(`### ${status} Lint`);
    lines.push(`- Duration: ${result.lint.durationMs}ms`);
    if (!result.lint.success) {
      lines.push("```");
      lines.push(result.lint.output.slice(0, 1000));
      lines.push("```");
    }
  }

  if (result.compile) {
    const status = result.compile.success ? "✅" : "❌";
    lines.push(`### ${status} Compile`);
    lines.push(`- Duration: ${result.compile.durationMs}ms`);
    if (!result.compile.success) {
      lines.push("```");
      lines.push(result.compile.output.slice(0, 1000));
      lines.push("```");
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: !result.allPassed,
  };
}

async function handleRun(
  args: Record<string, unknown>,
  context: ServerContext
): Promise<ToolCallResult> {
  const taskId = args.taskId as string;
  const taskName = args.taskName as string;
  const prompt = args.prompt as string;
  const constraints = (args.constraints as Constraint[]) || [];
  const validation = args.validation as { test?: string; lint?: string; compile?: string } | undefined;
  const expectedFiles = (args.expectedFiles as string[]) || [];
  const changesInput = args.changes as { diff?: string; files?: Array<{ path: string; content: string }> };

  // Build Task object
  const task: Task = {
    id: taskId,
    name: taskName,
    prompt,
    category: "feature",
    difficulty: "medium",
    fixture: context.workspacePath,
    constraints,
    validation: validation || {},
    expected: {
      filesToModify: expectedFiles,
      filesToIgnore: [],
    },
  };

  // Build Changes object - ensure files have operation field
  const inputFiles = (changesInput?.files || []) as Array<{ path: string; content?: string; operation?: string }>;
  const files: FileChange[] = inputFiles.map(f => ({
    path: f.path,
    content: f.content || "",
    operation: (f.operation as FileChange["operation"]) || "modify",
  }));
  
  const changes: Changes = {
    diff: changesInput?.diff || "",
    files,
  };

  // Run the full task
  const result: RunResult = await runTask(context.workspacePath, task, changes);

  // Format output
  const lines: string[] = [];
  const statusEmoji = result.passed ? "✅" : "❌";
  lines.push(`## Nella Run: ${statusEmoji} ${result.passed ? "PASSED" : "FAILED"}`);
  lines.push("");
  lines.push(`**Run ID**: ${result.runId}`);
  lines.push(`**Task**: ${result.taskId}`);
  lines.push("");

  // Refusal check
  if (result.refusal) {
    if (result.refusal.shouldRefuse) {
      lines.push("### ⚠️ Refusal Recommended");
      lines.push(`- Reason: ${result.refusal.reason}`);
      lines.push(`- Confidence: ${(result.refusal.confidence * 100).toFixed(0)}%`);
      if (result.refusal.patternsMatched.length > 0) {
        lines.push(`- Patterns: ${result.refusal.patternsMatched.join(", ")}`);
      }
      lines.push("");
    }
  }

  // Constraint results
  if (result.constraints.length > 0) {
    const allPassed = result.constraints.every(c => c.passed);
    lines.push(`### ${allPassed ? "✅" : "❌"} Constraints`);
    for (const c of result.constraints) {
      const status = c.passed ? "✅" : "❌";
      lines.push(`- ${status} ${c.id}`);
      if (!c.passed && c.violationDetails) {
        lines.push(`  - ${c.violationDetails}`);
      }
    }
    lines.push("");
  }

  // Validation results
  if (result.validation) {
    lines.push(`### ${result.validation.allPassed ? "✅" : "❌"} Validation`);
    if (result.validation.test) {
      lines.push(`- Test: ${result.validation.test.success ? "✅" : "❌"} (${result.validation.test.durationMs}ms)`);
    }
    if (result.validation.lint) {
      lines.push(`- Lint: ${result.validation.lint.success ? "✅" : "❌"} (${result.validation.lint.durationMs}ms)`);
    }
    if (result.validation.compile) {
      lines.push(`- Compile: ${result.validation.compile.success ? "✅" : "❌"} (${result.validation.compile.durationMs}ms)`);
    }
    lines.push("");
  }

  // Scope analysis
  if (result.scope) {
    lines.push("### Scope Analysis");
    lines.push(`- Expected files: ${result.scope.expectedFiles.length}`);
    lines.push(`- Actual files: ${result.scope.actualFiles.length}`);
    if (result.scope.extraFiles.length > 0) {
      lines.push(`- ⚠️ Extra files: ${result.scope.extraFiles.join(", ")}`);
    }
    if (result.scope.missingFiles.length > 0) {
      lines.push(`- ⚠️ Missing files: ${result.scope.missingFiles.join(", ")}`);
    }
    lines.push(`- Scope creep ratio: ${result.scope.scopeCreepRatio.toFixed(2)}`);
    lines.push("");
  }

  // Metrics
  lines.push("### Metrics");
  lines.push(`- Scope creep: ${result.metrics.scopeCreep.toFixed(2)}`);
  lines.push(`- Constraint violations: ${result.metrics.constraintViolations}`);
  lines.push(`- Validation integrity: ${(result.metrics.validationIntegrity * 100).toFixed(0)}%`);

  // Errors
  if (result.errors.length > 0) {
    lines.push("");
    lines.push("### Errors");
    for (const error of result.errors) {
      lines.push(`- ${error}`);
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: !result.passed,
  };
}
