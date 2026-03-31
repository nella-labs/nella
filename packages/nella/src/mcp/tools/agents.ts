/**
 * Agent Coordination MCP Tools
 *
 * Tools for multi-agent presence tracking, task management,
 * decision logging, and conflict detection.
 */

import * as crypto from "crypto";
import * as path from "path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  AgentRegistry,
} from "@usenella/core";
import type {
  AgentPresence,
  AgentTask,
  TaskStatus,
} from "@usenella/core";
import type { ServerContext } from "../server";

// =============================================================================
// Tool Definitions
// =============================================================================

export function registerAgentTools(): Tool[] {
  return [
    {
      name: "nella_agent_register",
      description: "Register this agent as present in the workspace. Call once at session start.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Agent display name" },
          type: { type: "string", enum: ["claude", "cursor", "windsurf", "copilot", "custom"], description: "Agent type" },
          capabilities: { type: "array", items: { type: "string" }, description: "Agent capabilities" },
        },
        required: ["name"],
      },
    },
    {
      name: "nella_agent_heartbeat",
      description: "Send heartbeat with current state. Call periodically to stay active.",
      inputSchema: {
        type: "object",
        properties: {
          currentTask: { type: "string", description: "What you're currently working on" },
          activeFiles: { type: "array", items: { type: "string" }, description: "Files you're actively editing" },
          status: { type: "string", enum: ["active", "idle", "busy"], description: "Current status" },
        },
      },
    },
    {
      name: "nella_agent_discover",
      description: "List all active agents in the workspace. Use to see who else is working.",
      inputSchema: {
        type: "object",
        properties: {
          branch: { type: "string", description: "Filter by branch" },
        },
      },
    },
    {
      name: "nella_agent_create_task",
      description: "Create a task for yourself or others. Tasks track units of work across agents.",
      inputSchema: {
        type: "object",
        properties: {
          description: { type: "string", description: "What needs to be done" },
          files: { type: "array", items: { type: "string" }, description: "Files involved" },
          branch: { type: "string", description: "Branch for this task" },
          priority: { type: "number", description: "Priority (0=highest, default: 5)" },
          dependencies: { type: "array", items: { type: "string" }, description: "Task IDs that must complete first" },
          assignToSelf: { type: "boolean", description: "Assign to this agent (default: false)" },
        },
        required: ["description"],
      },
    },
    {
      name: "nella_agent_claim_task",
      description: "Claim an unassigned task. Returns success/failure.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task ID to claim" },
        },
        required: ["taskId"],
      },
    },
    {
      name: "nella_agent_update_task",
      description: "Update a task's status or result.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task ID" },
          status: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "blocked"] },
          result: { type: "string", description: "Task result or output" },
        },
        required: ["taskId"],
      },
    },
    {
      name: "nella_agent_list_tasks",
      description: "List tasks in the workspace with optional filters.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "blocked"] },
          branch: { type: "string", description: "Filter by branch" },
          mine: { type: "boolean", description: "Only show tasks assigned to this agent" },
        },
      },
    },
    {
      name: "nella_agent_record_decision",
      description: "Record a design or code decision for other agents to see.",
      inputSchema: {
        type: "object",
        properties: {
          decision: { type: "string", description: "What was decided" },
          rationale: { type: "string", description: "Why this approach" },
          alternatives: { type: "array", items: { type: "string" }, description: "Other options considered" },
          affectedFiles: { type: "array", items: { type: "string" }, description: "Files affected" },
          branch: { type: "string", description: "Branch this applies to" },
        },
        required: ["decision", "rationale"],
      },
    },
    {
      name: "nella_agent_get_decisions",
      description: "Get recent decisions made by agents in this workspace.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results (default: 20)" },
          branch: { type: "string", description: "Filter by branch" },
        },
      },
    },
    {
      name: "nella_agent_check_conflicts",
      description: "Check if files you're editing overlap with other agents.",
      inputSchema: {
        type: "object",
        properties: {
          files: { type: "array", items: { type: "string" }, description: "Files to check" },
        },
        required: ["files"],
      },
    },
  ];
}

// =============================================================================
// Cached Registry
// =============================================================================

let cachedRegistry: AgentRegistry | null = null;
let cachedAgentId: string | null = null;

function getRegistry(context: ServerContext): AgentRegistry {
  if (!cachedRegistry) {
    const storagePath = path.join(context.workspacePath, ".nella", "agents");
    cachedRegistry = new AgentRegistry({ storagePath });
  }
  return cachedRegistry;
}

function getAgentId(): string {
  if (!cachedAgentId) {
    cachedAgentId = `agent_${crypto.randomBytes(6).toString("hex")}`;
  }
  return cachedAgentId;
}

// =============================================================================
// Tool Handler
// =============================================================================

export async function handleAgentTool(
  name: string,
  args: Record<string, unknown>,
  context: ServerContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean } | null> {
  const registry = getRegistry(context);
  const agentId = getAgentId();
  const workspaceId = path.basename(context.workspacePath);

  try {
    switch (name) {
      case "nella_agent_register": {
        const agent = registry.register({
          agentId,
          name: (args.name as string) || "agent",
          type: (args.type as any) || "claude",
          workspaceId,
          activeFiles: [],
          status: "active",
          capabilities: (args.capabilities as string[]) || [],
        });
        return text(`Registered as ${agent.name} (${agent.agentId})`);
      }

      case "nella_agent_heartbeat": {
        registry.heartbeat(agentId, {
          currentTask: args.currentTask as string | undefined,
          activeFiles: args.activeFiles as string[] | undefined,
          status: args.status as any | undefined,
        });
        return text("Heartbeat sent");
      }

      case "nella_agent_discover": {
        const agents = registry.discoverAgents(workspaceId, { branch: args.branch as string | undefined });
        if (agents.length === 0) return text("No active agents in workspace");

        const lines = agents.map((a) => {
          const current = a.agentId === agentId ? " (you)" : "";
          const task = a.currentTask ? ` — ${a.currentTask}` : "";
          const files = a.activeFiles.length > 0 ? ` [${a.activeFiles.join(", ")}]` : "";
          return `- ${a.name}${current} (${a.status})${task}${files}`;
        });
        return text(`Active agents (${agents.length}):\n${lines.join("\n")}`);
      }

      case "nella_agent_create_task": {
        const task = registry.createTask({
          description: args.description as string,
          assignedAgentId: (args.assignToSelf as boolean) ? agentId : null,
          status: (args.assignToSelf as boolean) ? "in_progress" : "pending",
          files: (args.files as string[]) || [],
          branch: args.branch as string | undefined,
          priority: (args.priority as number) ?? 5,
          dependencies: (args.dependencies as string[]) || [],
          workspaceId,
        });
        return text(`Task created: ${task.id}\n${task.description}`);
      }

      case "nella_agent_claim_task": {
        const claimed = registry.claimTask(args.taskId as string, agentId);
        return text(claimed ? `Claimed task ${args.taskId}` : `Failed to claim task ${args.taskId} (already assigned)`);
      }

      case "nella_agent_update_task": {
        registry.updateTask(args.taskId as string, {
          status: args.status as TaskStatus | undefined,
          result: args.result as string | undefined,
        });
        return text(`Task ${args.taskId} updated`);
      }

      case "nella_agent_list_tasks": {
        const filters: any = {};
        if (args.status) filters.status = args.status;
        if (args.branch) filters.branch = args.branch;
        if (args.mine) filters.agentId = agentId;

        const tasks = registry.listTasks(workspaceId, filters);
        if (tasks.length === 0) return text("No tasks found");

        const lines = tasks.map((t) => {
          const assigned = t.assignedAgentId ? ` [${t.assignedAgentId}]` : " [unassigned]";
          return `- ${t.id} (${t.status})${assigned}: ${t.description}`;
        });
        return text(`Tasks (${tasks.length}):\n${lines.join("\n")}`);
      }

      case "nella_agent_record_decision": {
        const decision = registry.recordDecision({
          agentId,
          decision: args.decision as string,
          rationale: args.rationale as string,
          alternatives: (args.alternatives as string[]) || [],
          affectedFiles: (args.affectedFiles as string[]) || [],
          workspaceId,
          branch: args.branch as string | undefined,
        });
        return text(`Decision recorded: ${decision.id}\n${decision.decision}`);
      }

      case "nella_agent_get_decisions": {
        const decisions = registry.getDecisions(workspaceId, {
          limit: (args.limit as number) || 20,
          branch: args.branch as string | undefined,
        });
        if (decisions.length === 0) return text("No decisions recorded");

        const lines = decisions.map((d) => {
          const files = d.affectedFiles.length > 0 ? ` [${d.affectedFiles.join(", ")}]` : "";
          return `- ${d.id} (${d.agentId}): ${d.decision}${files}\n  Rationale: ${d.rationale}`;
        });
        return text(`Decisions (${decisions.length}):\n${lines.join("\n")}`);
      }

      case "nella_agent_check_conflicts": {
        const files = args.files as string[];
        const conflicts = registry.checkFileConflicts(agentId, files, workspaceId);
        if (conflicts.length === 0) return text("No file conflicts detected");

        const lines = conflicts.map((c) =>
          `- ${c.file}: also being edited by ${c.otherAgent.name} (${c.otherAgent.agentId})`,
        );
        return text(`File conflicts (${conflicts.length}):\n${lines.join("\n")}`);
      }

      default:
        return null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Agent operation failed: ${message}` }], isError: true };
  }
}

function text(msg: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: msg }] };
}
