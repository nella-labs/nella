/**
 * Context Tools
 *
 * MCP tools for stateful context tracking across agent sessions:
 * - Dependency monitoring
 * - Assumption tracking
 * - Change history
 * - Session context
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { 
  AssumptionType,
  DependencyChange,
} from "@usenella/core";
import type { ServerContext } from "../server";

// =============================================================================
// Tool Definitions
// =============================================================================

export function registerContextTools(): Tool[] {
  return [
    {
      name: "nella_get_context",
      description: `Get current session context for the workspace.
      
Returns comprehensive context including:
- Session ID and duration
- Recent changes made in this session
- Active assumptions
- Dependency snapshot status
- Session statistics

Use this to understand what has happened in the current session.`,
      inputSchema: {
        type: "object",
        properties: {
          changesLimit: {
            type: "number",
            description: "Max number of recent changes to include (default: 20)",
          },
        },
      },
    },
    {
      name: "nella_add_assumption",
      description: `Record an assumption about the codebase.
      
Track assumptions so they can be validated later:
- Schema assumptions (database structure, API shapes)
- Interface assumptions (TypeScript types, contracts)
- Dependency assumptions (package versions, features)
- Behavior assumptions (how functions work)
- Config assumptions (environment, settings)
- Structure assumptions (file/folder organization)

Assumptions are automatically checked when changes are made.`,
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["schema", "interface", "dependency", "behavior", "config", "structure", "other"],
            description: "Type of assumption",
          },
          description: {
            type: "string",
            description: "Human-readable description of the assumption",
          },
          relatedFiles: {
            type: "array",
            items: { type: "string" },
            description: "Files this assumption relates to",
          },
          confidence: {
            type: "number",
            description: "Confidence level 0-1 (default: 0.8)",
          },
        },
        required: ["type", "description"],
      },
    },
    {
      name: "nella_check_assumptions",
      description: `Get the status of all assumptions.
      
Shows:
- All valid assumptions
- Recently invalidated assumptions
- Summary by type

Use this to review the current state of tracked assumptions.`,
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "nella_get_file_history",
      description: `Get change history for a specific file.
      
Shows what changes have been made to a file:
- Change timestamps
- Operations performed
- Reasons for changes
- Dependencies between files

Use this to understand the evolution of a file.`,
      inputSchema: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "Path to the file (relative to workspace)",
          },
        },
        required: ["filePath"],
      },
    },
    {
      name: "nella_check_dependencies",
      description: `Check for dependency changes since last snapshot.
      
Detects changes to:
- package.json dependencies
- Lock file updates
- Version changes (added, removed, updated)

Use this to ensure dependency assumptions are still valid.`,
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "nella_record_change",
      description: `Manually record file changes to the session context.
      
Use this when making changes outside of a full nella_run:
- Quick edits
- Manual modifications
- Changes made by other tools

Keeps the context accurate for assumption checking.`,
      inputSchema: {
        type: "object",
        properties: {
          files: {
            type: "array",
            items: { type: "string" },
            description: "List of files that were changed",
          },
          operation: {
            type: "string",
            enum: ["create", "modify", "delete"],
            description: "Type of operation (default: modify)",
          },
          reason: {
            type: "string",
            description: "Reason for the change",
          },
        },
        required: ["files", "reason"],
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

export async function handleContextTool(
  name: string,
  args: Record<string, unknown>,
  context: ServerContext
): Promise<ToolCallResult | null> {
  switch (name) {
    case "nella_get_context":
      return handleGetContext(args, context);
    case "nella_add_assumption":
      return handleAddAssumption(args, context);
    case "nella_check_assumptions":
      return handleCheckAssumptions(args, context);
    case "nella_get_file_history":
      return handleGetFileHistory(args, context);
    case "nella_check_dependencies":
      return handleCheckDependencies(args, context);
    case "nella_record_change":
      return handleRecordChange(args, context);
    default:
      return null;
  }
}

async function handleGetContext(
  args: Record<string, unknown>,
  context: ServerContext
): Promise<ToolCallResult> {
  const changesLimit = (args.changesLimit as number) || 20;

  const agentContext = context.contextManager.getContext(changesLimit);

  const lines: string[] = [];
  lines.push(`## Session Context`);
  lines.push("");
  lines.push(`**Session ID**: ${agentContext.session.id}`);
  lines.push(`**Workspace**: ${agentContext.session.repoPath}`);
  lines.push(`**Started**: ${new Date(agentContext.session.startedAt).toLocaleString()}`);
  lines.push(`**Duration**: ${agentContext.stats.sessionDurationMinutes} minutes`);
  lines.push("");

  // Stats
  lines.push("### Statistics");
  lines.push(`- Total changes: ${agentContext.stats.totalChanges}`);
  lines.push(`- Valid assumptions: ${agentContext.stats.validAssumptionCount}`);
  lines.push(`- Invalidated assumptions: ${agentContext.stats.invalidatedAssumptionCount}`);
  
  if (agentContext.stats.hotspotFiles.length > 0) {
    lines.push("");
    lines.push("### Hotspot Files (most frequently changed)");
    for (const hotspot of agentContext.stats.hotspotFiles.slice(0, 5)) {
      lines.push(`- \`${hotspot.file}\`: ${hotspot.changeCount} changes`);
    }
  }
  lines.push("");

  // Recent changes
  if (agentContext.recentChanges.length > 0) {
    lines.push("### Recent Changes");
    for (const change of agentContext.recentChanges.slice(0, changesLimit)) {
      const date = new Date(change.timestamp).toLocaleString();
      lines.push(`- **${date}**: [${change.operation}] \`${change.file}\``);
      if (change.reason) {
        lines.push(`  - ${change.reason}`);
      }
    }
    lines.push("");
  }

  // Active assumptions
  if (agentContext.validAssumptions.length > 0) {
    lines.push("### Active Assumptions");
    for (const assumption of agentContext.validAssumptions.slice(0, 10)) {
      lines.push(`- ✅ **[${assumption.type}]** ${assumption.description}`);
      if (assumption.relatedFiles.length > 0) {
        lines.push(`  - Files: ${assumption.relatedFiles.slice(0, 3).join(", ")}`);
      }
    }
    if (agentContext.validAssumptions.length > 10) {
      lines.push(`  - ... and ${agentContext.validAssumptions.length - 10} more`);
    }
    lines.push("");
  }

  // Recent invalidations
  if (agentContext.recentInvalidations.length > 0) {
    lines.push("### Recently Invalidated Assumptions");
    for (const assumption of agentContext.recentInvalidations.slice(0, 5)) {
      lines.push(`- ❌ **[${assumption.type}]** ${assumption.description}`);
      if (assumption.invalidationReason) {
        lines.push(`  - Reason: ${assumption.invalidationReason}`);
      }
    }
    lines.push("");
  }

  // Dependencies
  if (agentContext.dependencies) {
    lines.push("### Dependency Snapshot");
    const snap = agentContext.dependencies;
    lines.push(`- Snapshot from: ${new Date(snap.takenAt).toLocaleString()}`);
    lines.push(`- Package manager: ${snap.lockfileType}`);
    lines.push(`- Packages tracked: ${Object.keys(snap.packages).length}`);
    lines.push("");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

async function handleAddAssumption(
  args: Record<string, unknown>,
  context: ServerContext
): Promise<ToolCallResult> {
  const typeInput = args.type as string;
  const description = args.description as string;
  const relatedFiles = (args.relatedFiles as string[]) || [];
  const confidence = (args.confidence as number) || 0.8;
  
  const type = typeInput as AssumptionType;

  // Use the assumptions tracker via ContextManager
  const assumption = context.contextManager.assumptions.addAssumption(
    description,
    relatedFiles,
    type,
    confidence
  );

  // Save the session
  context.contextManager.save();

  const lines: string[] = [];
  lines.push(`## Assumption Recorded`);
  lines.push("");
  lines.push(`✅ Successfully recorded assumption:`);
  lines.push("");
  lines.push(`- **ID**: ${assumption.id}`);
  lines.push(`- **Type**: ${assumption.type}`);
  lines.push(`- **Description**: ${assumption.description}`);
  if (relatedFiles.length > 0) {
    lines.push(`- **Related files**: ${relatedFiles.join(", ")}`);
  }
  lines.push(`- **Confidence**: ${(assumption.confidence * 100).toFixed(0)}%`);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

async function handleCheckAssumptions(
  _args: Record<string, unknown>,
  context: ServerContext
): Promise<ToolCallResult> {
  const validAssumptions = context.contextManager.assumptions.getValidAssumptions();
  const invalidated = context.contextManager.assumptions.getRecentlyInvalidated(20);
  const summary = context.contextManager.assumptions.getSummary();

  const lines: string[] = [];
  lines.push(`## Assumption Status`);
  lines.push("");

  // Summary
  lines.push("### Summary");
  lines.push(`- Valid: ${summary.valid}`);
  lines.push(`- Invalidated: ${summary.invalidated}`);
  lines.push(`- Total: ${summary.total}`);
  lines.push("");

  lines.push("### By Type");
  for (const [type, count] of Object.entries(summary.byType) as Array<[string, number]>) {
    if (count > 0) {
      lines.push(`- ${type}: ${count}`);
    }
  }
  lines.push("");

  // Valid assumptions
  if (validAssumptions.length > 0) {
    lines.push("### ✅ Valid Assumptions");
    for (const assumption of validAssumptions) {
      lines.push(`- **[${assumption.type}]** ${assumption.description}`);
      lines.push(`  - Confidence: ${(assumption.confidence * 100).toFixed(0)}%`);
    }
    lines.push("");
  }

  // Invalidated
  if (invalidated.length > 0) {
    lines.push("### ❌ Invalidated Assumptions");
    for (const assumption of invalidated) {
      lines.push(`- **[${assumption.type}]** ${assumption.description}`);
      if (assumption.invalidationReason) {
        lines.push(`  - Reason: ${assumption.invalidationReason}`);
      }
      if (assumption.invalidatedAt) {
        lines.push(`  - When: ${new Date(assumption.invalidatedAt).toLocaleString()}`);
      }
    }
    lines.push("");
  }

  if (validAssumptions.length === 0 && invalidated.length === 0) {
    lines.push("No assumptions recorded yet.");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: invalidated.length > 0,
  };
}

async function handleGetFileHistory(
  args: Record<string, unknown>,
  context: ServerContext
): Promise<ToolCallResult> {
  const filePath = args.filePath as string;

  // Get file history from changes ledger
  const fileHistory = context.contextManager.changes.getFileHistory(filePath);

  const lines: string[] = [];
  lines.push(`## File History: \`${filePath}\``);
  lines.push("");

  if (!fileHistory || fileHistory.changes.length === 0) {
    lines.push(`No recorded changes for this file.`);
  } else {
    lines.push(`**Current state**: ${fileHistory.currentState}`);
    if (fileHistory.lastModifiedAt) {
      lines.push(`**Last modified**: ${new Date(fileHistory.lastModifiedAt).toLocaleString()}`);
    }
    lines.push(`**Total changes**: ${fileHistory.changes.length}`);
    lines.push("");

    lines.push("### Change History");
    for (const change of fileHistory.changes) {
      const date = new Date(change.timestamp).toLocaleString();
      lines.push(`#### ${date}`);
      lines.push(`- **Operation**: ${change.operation}`);
      lines.push(`- **Reason**: ${change.reason || "Not specified"}`);
      lines.push(`- **Run ID**: ${change.runId}`);
      if (change.dependsOn.length > 0) {
        lines.push(`- **Depends on**: ${change.dependsOn.join(", ")}`);
      }
      lines.push("");
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

async function handleCheckDependencies(
  _args: Record<string, unknown>,
  context: ServerContext
): Promise<ToolCallResult> {
  // Check dependencies using the workspace path
  const diff = context.contextManager.checkDependencies(context.workspacePath);

  const lines: string[] = [];
  lines.push(`## Dependency Check`);
  lines.push("");

  if (!diff || !diff.hasChanges) {
    lines.push(`✅ No dependency changes detected.`);
    
    // Show current snapshot info
    const snapshot = context.contextManager.session.getDependencySnapshot();
    if (snapshot) {
      lines.push("");
      lines.push(`Last snapshot: ${new Date(snapshot.takenAt).toLocaleString()}`);
      lines.push(`Package manager: ${snapshot.lockfileType}`);
      lines.push(`Packages tracked: ${Object.keys(snapshot.packages).length}`);
    } else {
      lines.push("");
      lines.push(`No previous snapshot. A new snapshot has been created.`);
    }
  } else {
    lines.push(`⚠️ Dependencies have changed:`);
    lines.push("");

    if (diff.packageJsonChanged) {
      lines.push("- 📦 package.json was modified");
    }
    if (diff.lockfileChanged) {
      lines.push("- 🔒 Lockfile was modified");
    }
    lines.push("");

    const added = diff.changes.filter((c: DependencyChange) => c.type === "added");
    const removed = diff.changes.filter((c: DependencyChange) => c.type === "removed");
    const updated = diff.changes.filter((c: DependencyChange) => c.type === "updated");

    if (added.length > 0) {
      lines.push("### Added");
      for (const dep of added) {
        const devTag = dep.isDev ? " (dev)" : "";
        lines.push(`- **${dep.package}**: ${dep.version}${devTag}`);
      }
      lines.push("");
    }

    if (removed.length > 0) {
      lines.push("### Removed");
      for (const dep of removed) {
        lines.push(`- **${dep.package}**: ${dep.previousVersion || "unknown"}`);
      }
      lines.push("");
    }

    if (updated.length > 0) {
      lines.push("### Updated");
      for (const dep of updated) {
        lines.push(`- **${dep.package}**: ${dep.previousVersion} → ${dep.version}`);
      }
      lines.push("");
    }

    if (diff.affectedAssumptions.length > 0) {
      lines.push("### ⚠️ Affected Assumptions");
      lines.push(`${diff.affectedAssumptions.length} assumption(s) may be affected by these changes:`);
      for (const assumption of diff.affectedAssumptions.slice(0, 5)) {
        lines.push(`- **[${assumption.type}]** ${assumption.description}`);
      }
      lines.push("");
    }

    lines.push("**Note**: Dependency changes may invalidate assumptions about available features or APIs.");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: diff?.hasChanges ?? false,
  };
}

async function handleRecordChange(
  args: Record<string, unknown>,
  context: ServerContext
): Promise<ToolCallResult> {
  const files = args.files as string[];
  const operation = (args.operation as "create" | "modify" | "delete") || "modify";
  const reason = args.reason as string;

  // Generate a run ID for this manual recording
  const runId = `manual-${Date.now()}`;

  // Record each file change via the changes ledger
  const changes = files.map(file => ({
    file,
    operation,
    reason,
  }));

  const recorded = context.contextManager.changes.recordChanges(runId, changes);
  
  // Check for invalidations
  const invalidated = context.contextManager.assumptions.checkInvalidations(files, runId);

  // Save
  context.contextManager.save();

  const lines: string[] = [];
  lines.push(`## Change Recorded`);
  lines.push("");
  lines.push(`✅ Successfully recorded ${recorded.length} change(s):`);
  lines.push("");
  lines.push(`- **Operation**: ${operation}`);
  lines.push(`- **Reason**: ${reason}`);
  lines.push(`- **Files**: ${files.join(", ")}`);
  lines.push(`- **Run ID**: ${runId}`);

  // Report if this invalidated any assumptions
  if (invalidated.length > 0) {
    lines.push("");
    lines.push(`### ⚠️ Invalidated Assumptions`);
    lines.push(`This change invalidated ${invalidated.length} assumption(s):`);
    for (const assumption of invalidated) {
      lines.push(`- **[${assumption.type}]** ${assumption.description}`);
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
