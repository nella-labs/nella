/**
 * Agent Coordination Types
 *
 * Types for multi-agent presence tracking, task management,
 * decision logging, and conflict detection.
 */

// =============================================================================
// Agent Presence
// =============================================================================

export interface AgentPresence {
  /** Unique agent instance ID */
  agentId: string;
  /** Human-readable agent name (e.g., "claude-code-1") */
  name: string;
  /** Agent type/provider */
  type: AgentType;
  /** Workspace ID */
  workspaceId: string;
  /** Current git branch */
  branch?: string;
  /** What the agent is currently working on */
  currentTask?: string;
  /** Files the agent is actively editing */
  activeFiles: string[];
  /** Agent status */
  status: AgentStatus;
  /** Last heartbeat timestamp (ISO 8601) */
  lastHeartbeat: string;
  /** Session start time (ISO 8601) */
  connectedAt: string;
  /** Capabilities this agent exposes */
  capabilities: string[];
}

export type AgentType = "claude" | "cursor" | "windsurf" | "copilot" | "custom";
export type AgentStatus = "active" | "idle" | "busy" | "disconnected";

// =============================================================================
// Agent Tasks
// =============================================================================

export interface AgentTask {
  /** Task ID */
  id: string;
  /** Task description */
  description: string;
  /** Assigned agent ID (null = unassigned) */
  assignedAgentId: string | null;
  /** Task status */
  status: TaskStatus;
  /** Parent task (for subtask decomposition) */
  parentTaskId?: string;
  /** Files involved */
  files: string[];
  /** Branch this task operates on */
  branch?: string;
  /** Priority (0 = highest) */
  priority: number;
  /** Dependencies (other task IDs that must complete first) */
  dependencies: string[];
  /** Workspace ID */
  workspaceId: string;
  /** When this was created */
  createdAt: string;
  /** When this was last updated */
  updatedAt: string;
  /** When this was completed */
  completedAt?: string;
  /** Result/output of the task */
  result?: unknown;
}

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "blocked";

// =============================================================================
// Agent Decisions
// =============================================================================

export interface AgentDecision {
  /** Decision ID */
  id: string;
  /** Which agent made this decision */
  agentId: string;
  /** What was decided */
  decision: string;
  /** Why it was decided */
  rationale: string;
  /** Alternatives considered */
  alternatives: string[];
  /** Files affected */
  affectedFiles: string[];
  /** Workspace ID */
  workspaceId: string;
  /** Branch */
  branch?: string;
  /** Whether other agents have acknowledged this */
  acknowledged: boolean;
  /** Timestamp */
  createdAt: string;
}

// =============================================================================
// Events
// =============================================================================

export type AgentRegistryEvent =
  | { type: "agent:joined"; agent: AgentPresence }
  | { type: "agent:left"; agentId: string }
  | { type: "agent:updated"; agent: AgentPresence }
  | { type: "task:created"; task: AgentTask }
  | { type: "task:claimed"; taskId: string; agentId: string }
  | { type: "task:completed"; taskId: string; result?: unknown }
  | { type: "decision:made"; decision: AgentDecision }
  | { type: "conflict:detected"; file: string; agents: string[] };

// =============================================================================
// File Conflict
// =============================================================================

export interface FileConflict {
  file: string;
  otherAgent: AgentPresence;
}
