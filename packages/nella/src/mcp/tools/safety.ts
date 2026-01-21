/**
 * Safety Tools
 *
 * MCP tools for risk detection, refusal checking, and prerequisite verification.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  shouldRefuse,
  detectRiskPatterns,
  checkPrerequisites,
  type Task,
  type PrerequisiteCheck,
} from "@nella-labs/core";
import type { ServerContext } from "../server";

// =============================================================================
// Tool Definitions
// =============================================================================

export function registerSafetyTools(): Tool[] {
  return [
    {
      name: "nella_detect_risks",
      description: `Analyze text for risky patterns.
      
Detects potentially dangerous patterns like:
- Credential/secret logging
- Security bypass attempts
- Dangerous operations (drop table, rm -rf)
- Data exposure patterns
- Backdoor indicators

Returns list of matched risk patterns.`,
      inputSchema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Text content to analyze for risk patterns (prompt or code)",
          },
        },
        required: ["content"],
      },
    },
    {
      name: "nella_should_refuse",
      description: `Determine if a task should be refused.
      
Evaluates whether a task should be declined based on:
- Risk patterns in the prompt
- Missing prerequisites
- Dangerous operations

Use this before starting potentially risky work.`,
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Task identifier",
          },
          prompt: {
            type: "string",
            description: "The task prompt to evaluate",
          },
          skipPrerequisites: {
            type: "boolean",
            description: "Skip prerequisite checks (default: false)",
          },
        },
        required: ["taskId", "prompt"],
      },
    },
    {
      name: "nella_check_prerequisites",
      description: `Verify that required prerequisites are met.
      
Checks that necessary conditions exist:
- package.json present
- Dependencies installed (node_modules)

Use this before starting work that depends on specific setup.`,
      inputSchema: {
        type: "object",
        properties: {},
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

export async function handleSafetyTool(
  name: string,
  args: Record<string, unknown>,
  context: ServerContext
): Promise<ToolCallResult | null> {
  switch (name) {
    case "nella_detect_risks":
      return handleDetectRisks(args, context);
    case "nella_should_refuse":
      return handleShouldRefuse(args, context);
    case "nella_check_prerequisites":
      return handleCheckPrerequisites(args, context);
    default:
      return null;
  }
}

async function handleDetectRisks(
  args: Record<string, unknown>,
  _context: ServerContext
): Promise<ToolCallResult> {
  const content = args.content as string;

  // detectRiskPatterns returns array of matched pattern strings
  const risks = detectRiskPatterns(content);

  const lines: string[] = [];
  lines.push(`## Risk Analysis`);
  lines.push("");

  if (risks.length === 0) {
    lines.push("✅ No risky patterns detected.");
  } else {
    lines.push(`⚠️ Found ${risks.length} potential risk pattern(s):`);
    lines.push("");

    for (const pattern of risks) {
      lines.push(`- 🔴 \`${pattern}\``);
    }

    lines.push("");
    lines.push("**Recommendation**: Review these patterns carefully before proceeding.");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: risks.length > 0,
  };
}

async function handleShouldRefuse(
  args: Record<string, unknown>,
  context: ServerContext
): Promise<ToolCallResult> {
  const taskId = args.taskId as string;
  const prompt = args.prompt as string;
  const skipPrerequisites = args.skipPrerequisites === true;

  // Build minimal task for refusal check
  const task: Task = {
    id: taskId,
    name: taskId,
    prompt,
    category: "feature",
    difficulty: "medium",
    fixture: context.workspacePath,
    constraints: [],
    validation: {},
    expected: { filesToModify: [], filesToIgnore: [] },
  };

  const result = shouldRefuse(task, context.workspacePath, {
    skipPrerequisites,
  });

  const lines: string[] = [];
  lines.push(`## Refusal Decision`);
  lines.push("");

  if (result.shouldRefuse) {
    lines.push(`🛑 **REFUSE**: This request should be refused.`);
    lines.push("");
    lines.push("### Reason");
    lines.push(result.reason);
    lines.push("");
    if (result.patternsMatched.length > 0) {
      lines.push("### Risk Patterns Matched");
      for (const pattern of result.patternsMatched) {
        lines.push(`- \`${pattern}\``);
      }
      lines.push("");
    }
    lines.push(`**Confidence**: ${(result.confidence * 100).toFixed(0)}%`);
  } else {
    lines.push(`✅ **PROCEED**: No refusal reasons detected.`);
    lines.push("");
    lines.push("The task appears safe to execute.");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: result.shouldRefuse,
  };
}

async function handleCheckPrerequisites(
  _args: Record<string, unknown>,
  context: ServerContext
): Promise<ToolCallResult> {
  const results: PrerequisiteCheck[] = checkPrerequisites(context.workspacePath);

  const lines: string[] = [];
  lines.push(`## Prerequisite Check`);
  lines.push("");

  const allPassed = results.every((r) => r.passed);

  if (allPassed) {
    lines.push(`✅ All ${results.length} prerequisites met.`);
  } else {
    const failed = results.filter((r) => !r.passed);
    lines.push(`❌ ${failed.length} of ${results.length} prerequisites failed.`);
  }

  lines.push("");
  lines.push("### Details");

  for (const r of results) {
    const status = r.passed ? "✅" : "❌";
    lines.push(`- ${status} **${r.name}**: ${r.message}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: !allPassed,
  };
}
