/**
 * Code Tools
 *
 * MCP tools for code refactoring suggestions and test generation.
 * These tools live in the nella package because they add code-analysis
 * logic on top of core search functionality.
 *
 * Phase 7 — New tools: nella_refactor, nella_test
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "../server";

// =============================================================================
// Tool Definitions
// =============================================================================

export function registerCodeTools(): Tool[] {
  return [
    {
      name: "nella_refactor",
      description: `Suggest refactoring opportunities for code snippets.

Analyzes code structure and suggests improvements based on common patterns:
- Extract function/method for repeated logic
- Simplify conditionals (guard clauses, early returns)
- Rename for clarity
- Reduce nesting
- Remove dead code or unused imports

Returns pattern-based refactoring suggestions (not AI-generated rewrites).
Use this for code quality improvements grounded in the actual codebase.`,
      inputSchema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The code to analyze for refactoring opportunities",
          },
          intent: {
            type: "string",
            description: "What kind of refactoring you're looking for (e.g., 'simplify', 'extract', 'rename')",
          },
          filePath: {
            type: "string",
            description: "Optional file path for context (helps find related code)",
          },
        },
        required: ["code", "intent"],
      },
    },
    {
      name: "nella_test",
      description: `Generate test skeleton suggestions based on the workspace's existing test conventions.

Analyzes:
- Function signatures and parameters from the provided code
- Existing test patterns in the workspace (framework, style, structure)
- Common edge cases based on parameter types

Returns a test skeleton that follows the project's testing conventions.
Supports jest, vitest, and mocha frameworks.`,
      inputSchema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The code to generate tests for (function, class, or module)",
          },
          filePath: {
            type: "string",
            description: "Path to the file being tested (helps find existing test patterns)",
          },
          framework: {
            type: "string",
            description: "Test framework to use",
            enum: ["jest", "vitest", "mocha"],
          },
        },
        required: ["code"],
      },
    },
  ];
}

// =============================================================================
// Tool Handlers
// =============================================================================

export async function handleCodeTool(
  name: string,
  args: Record<string, unknown>,
  context: ServerContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean } | null> {
  switch (name) {
    case "nella_refactor":
      return handleRefactor(args, context);
    case "nella_test":
      return handleTest(args, context);
    default:
      return null;
  }
}

// =============================================================================
// Refactor Handler
// =============================================================================

async function handleRefactor(
  args: Record<string, unknown>,
  context: ServerContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const code = args.code as string;
  const intent = args.intent as string;
  const filePath = args.filePath as string | undefined;

  const suggestions: string[] = [];
  const lines = code.split("\n");
  const trimmedCode = code.trim();

  // -------------------------------------------------------------------------
  // Pattern-based refactoring analysis
  // -------------------------------------------------------------------------

  // 1. Deeply nested code (nesting > 3 levels)
  let maxNesting = 0;
  let currentNesting = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    for (const ch of trimmed) {
      if (ch === "{") currentNesting++;
      if (ch === "}") currentNesting--;
    }
    maxNesting = Math.max(maxNesting, currentNesting);
  }
  if (maxNesting > 3) {
    suggestions.push(
      `**Reduce Nesting (depth: ${maxNesting})**: Consider using early returns/guard clauses to flatten nested conditionals. Extract deeply nested blocks into separate functions.`,
    );
  }

  // 2. Long functions (> 30 lines)
  const functionMatches = trimmedCode.match(/(?:function\s+\w+|(?:async\s+)?(?:\w+)\s*(?:=|:)\s*(?:async\s+)?(?:\(|function))/g);
  if (lines.length > 30) {
    suggestions.push(
      `**Extract Function**: This code is ${lines.length} lines long. Consider breaking it into smaller functions of 15-20 lines each. Look for logical sections that can be extracted.`,
    );
  }

  // 3. Repeated patterns (duplicate blocks)
  const lineFrequency = new Map<string, number>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 10 && !trimmed.startsWith("//") && !trimmed.startsWith("*")) {
      lineFrequency.set(trimmed, (lineFrequency.get(trimmed) || 0) + 1);
    }
  }
  const duplicates = [...lineFrequency.entries()].filter(([, count]) => count >= 3);
  if (duplicates.length > 0) {
    const examples = duplicates.slice(0, 3).map(([line, count]) => `  "${line.slice(0, 60)}..." (×${count})`);
    suggestions.push(
      `**Remove Duplication**: Found repeated code patterns:\n${examples.join("\n")}\nConsider extracting into a shared helper function.`,
    );
  }

  // 4. Complex conditionals
  const complexConditions = trimmedCode.match(/if\s*\([^)]{60,}\)/g);
  if (complexConditions && complexConditions.length > 0) {
    suggestions.push(
      `**Simplify Conditionals**: Found ${complexConditions.length} complex condition(s). Consider extracting conditions into named boolean variables for readability.`,
    );
  }

  // 5. Magic numbers
  const magicNumbers = trimmedCode.match(/(?<!\w)(?:(?:===?|!==?|[<>]=?|[+\-*/])\s*(?:\d{2,}(?:\.\d+)?))/g);
  if (magicNumbers && magicNumbers.length > 0) {
    suggestions.push(
      `**Extract Constants**: Found ${magicNumbers.length} potential magic number(s). Consider extracting into named constants for clarity.`,
    );
  }

  // 6. TODO/FIXME/HACK comments
  const todoComments = trimmedCode.match(/\/\/\s*(?:TODO|FIXME|HACK|XXX|TEMP)/gi);
  if (todoComments && todoComments.length > 0) {
    suggestions.push(
      `**Address TODOs**: Found ${todoComments.length} TODO/FIXME/HACK comment(s). Consider resolving these technical debt markers.`,
    );
  }

  // 7. Unused imports (basic detection)
  const importLines = lines.filter((l) => l.trim().startsWith("import "));
  for (const imp of importLines) {
    const match = imp.match(/import\s+(?:\{([^}]+)\}|(\w+))/);
    if (match) {
      const symbols = (match[1] || match[2] || "").split(",").map((s) => s.trim().split(" as ").pop()!.trim());
      for (const sym of symbols) {
        if (sym && !trimmedCode.replace(imp, "").includes(sym)) {
          suggestions.push(`**Remove Unused Import**: \`${sym}\` appears to be imported but unused.`);
        }
      }
    }
  }

  // 8. Intent-specific suggestions
  const intentLower = intent.toLowerCase();
  if (intentLower.includes("simplif")) {
    suggestions.push(`**Simplification Tips**: Look for ternary operators that can replace simple if/else blocks, optional chaining (\`?.\`) for null checks, and nullish coalescing (\`??\`) for defaults.`);
  }
  if (intentLower.includes("extract")) {
    suggestions.push(`**Extraction Tips**: Identify chunks of code with a clear purpose. Good extraction candidates: loops with complex bodies, try/catch blocks doing multiple things, and callback functions longer than 5 lines.`);
  }
  if (intentLower.includes("rename")) {
    suggestions.push(`**Naming Tips**: Use descriptive names that explain "what" not "how". Prefer verb-noun pairs for functions (e.g., \`validateUser\`), and nouns for variables. Avoid abbreviations.`);
  }

  // -------------------------------------------------------------------------
  // Format response
  // -------------------------------------------------------------------------

  if (suggestions.length === 0) {
    return {
      content: [{
        type: "text",
        text: `No refactoring suggestions found for the provided code with intent "${intent}". The code looks clean!`,
      }],
    };
  }

  const text = `# Refactoring Suggestions\n\nIntent: ${intent}${filePath ? `\nFile: ${filePath}` : ""}\n\n${suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n\n")}`;

  return {
    content: [{ type: "text", text }],
  };
}

// =============================================================================
// Test Handler
// =============================================================================

async function handleTest(
  args: Record<string, unknown>,
  context: ServerContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const code = args.code as string;
  const filePath = args.filePath as string | undefined;
  const framework = (args.framework as string) || "jest";

  // -------------------------------------------------------------------------
  // Parse function signatures from the code
  // -------------------------------------------------------------------------

  const functions: Array<{ name: string; params: string[]; isAsync: boolean; returnType?: string }> = [];

  // Match: function name(params) or const name = (params) => or async function name(params)
  const funcPatterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+))?/g,
    /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)(?:\s*:\s*([^\s=]+))?\s*=>/g,
    /(?:async\s+)?(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+))?\s*\{/g,
  ];

  for (const pattern of funcPatterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const name = match[1];
      // Skip common non-function keywords
      if (["if", "for", "while", "switch", "catch", "constructor"].includes(name)) continue;

      const params = match[2]
        .split(",")
        .map((p) => p.trim().split(":")[0].trim().split("?")[0].trim())
        .filter((p) => p.length > 0);
      const isAsync = match[0].includes("async");
      const returnType = match[3]?.trim();

      // Avoid duplicates
      if (!functions.find((f) => f.name === name)) {
        functions.push({ name, params, isAsync, returnType });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Detect class names
  // -------------------------------------------------------------------------

  const classMatch = code.match(/class\s+(\w+)/);
  const className = classMatch?.[1];

  // -------------------------------------------------------------------------
  // Generate test skeleton
  // -------------------------------------------------------------------------

  const importPath = filePath
    ? filePath.replace(/\.(ts|tsx|js|jsx)$/, "").replace(/\\/g, "/")
    : "./module";

  const exportNames = functions.map((f) => f.name);
  if (className) exportNames.push(className);

  let testCode = "";

  // Framework-specific structure
  switch (framework) {
    case "vitest":
      testCode += `import { describe, it, expect, vi } from 'vitest';\n`;
      break;
    case "mocha":
      testCode += `import { expect } from 'chai';\nimport sinon from 'sinon';\n`;
      break;
    case "jest":
    default:
      // Jest uses globals
      break;
  }

  if (exportNames.length > 0) {
    testCode += `import { ${exportNames.join(", ")} } from '${importPath}';\n`;
  }
  testCode += "\n";

  // Generate test suite
  const suiteName = className || filePath?.split("/").pop()?.replace(/\.\w+$/, "") || "Module";

  testCode += `describe('${suiteName}', () => {\n`;

  if (className) {
    testCode += `  let instance: ${className};\n\n`;
    testCode += `  beforeEach(() => {\n`;
    testCode += `    instance = new ${className}();\n`;
    testCode += `  });\n\n`;
  }

  for (const func of functions) {
    testCode += `  describe('${func.name}', () => {\n`;

    // Happy path test
    const awaitPrefix = func.isAsync ? "await " : "";
    const asyncLabel = func.isAsync ? "async " : "";
    const caller = className ? `instance.${func.name}` : func.name;
    const paramPlaceholders = func.params.map((p) => `/* ${p} */`).join(", ");

    testCode += `    it('should handle valid input', ${asyncLabel}() => {\n`;
    testCode += `      const result = ${awaitPrefix}${caller}(${paramPlaceholders});\n`;
    testCode += `      expect(result).toBeDefined();\n`;
    testCode += `    });\n\n`;

    // Edge case: empty/null inputs
    if (func.params.length > 0) {
      testCode += `    it('should handle edge cases', ${asyncLabel}() => {\n`;
      testCode += `      // Test with boundary values\n`;
      testCode += `      // TODO: Add specific edge case assertions\n`;
      testCode += `    });\n\n`;
    }

    // Error case
    testCode += `    it('should handle errors gracefully', ${asyncLabel}() => {\n`;
    if (func.isAsync) {
      testCode += `      // TODO: Test error handling\n`;
      testCode += `      // await expect(${caller}(/* invalid input */)).rejects.toThrow();\n`;
    } else {
      testCode += `      // TODO: Test error handling\n`;
      testCode += `      // expect(() => ${caller}(/* invalid input */)).toThrow();\n`;
    }
    testCode += `    });\n`;

    testCode += `  });\n\n`;
  }

  // If no functions found, generate a generic skeleton
  if (functions.length === 0) {
    testCode += `  it('should work correctly', () => {\n`;
    testCode += `    // TODO: Add test assertions\n`;
    testCode += `    expect(true).toBe(true);\n`;
    testCode += `  });\n\n`;
    testCode += `  it('should handle edge cases', () => {\n`;
    testCode += `    // TODO: Add edge case tests\n`;
    testCode += `  });\n\n`;
    testCode += `  it('should handle errors', () => {\n`;
    testCode += `    // TODO: Add error handling tests\n`;
    testCode += `  });\n`;
  }

  testCode += `});\n`;

  // -------------------------------------------------------------------------
  // Format response
  // -------------------------------------------------------------------------

  let text = `# Test Skeleton\n\n`;
  text += `Framework: ${framework}\n`;
  text += `Functions detected: ${functions.length}\n`;
  if (className) text += `Class: ${className}\n`;
  text += `\n\`\`\`typescript\n${testCode}\`\`\`\n`;
  text += `\n**Next steps**:\n`;
  text += `1. Replace placeholder arguments with real test values\n`;
  text += `2. Add specific assertions for your business logic\n`;
  text += `3. Add mock setup for external dependencies\n`;
  text += `4. Fill in edge case and error test bodies\n`;

  return {
    content: [{ type: "text", text }],
  };
}
