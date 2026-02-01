/**
 * Context Manager
 *
 * Cross-agent context sharing with channels.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type {
  ContextEntry,
  ContextType,
  ContextVisibility,
  ContextChannel,
  ContextQuery,
  ContextQueryResult,
  ContextEvent,
  ContextStore,
  CodeSnippetContext,
  DecisionContext,
  DependencyContext,
} from "./types";
import { DEFAULT_CHANNEL_SETTINGS, DEFAULT_CONTEXT_TTL } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface SetContextOptions {
  key: string;
  value: unknown;
  type?: ContextType;
  sourceAgentId: string;
  workspaceId: string;
  tags?: string[];
  visibility?: ContextVisibility;
  ttl?: number;
  channelId?: string;
}

export type ContextEventHandler = (event: ContextEvent) => void;

// =============================================================================
// Context Manager Class
// =============================================================================

export class ContextManager {
  private store: ContextStore;
  private storePath: string;
  private eventHandlers: ContextEventHandler[] = [];
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(storagePath: string) {
    this.storePath = path.join(storagePath, "context.json");
    
    // Ensure directory exists
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.store = this.loadStore();

    // Start cleanup interval (every 5 minutes)
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  onEvent(handler: ContextEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: ContextEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Context event handler error:", error);
      }
    }
  }

  // =============================================================================
  // Context Operations
  // =============================================================================

  /**
   * Set context entry
   */
  set(options: SetContextOptions): ContextEntry {
    const now = new Date().toISOString();
    const ttl = options.ttl ?? DEFAULT_CONTEXT_TTL;

    // Check if entry with same key exists
    const existingIndex = this.store.entries.findIndex(
      (e) => e.key === options.key && e.workspaceId === options.workspaceId
    );

    const entry: ContextEntry = {
      id: existingIndex >= 0 ? this.store.entries[existingIndex].id : `ctx_${crypto.randomBytes(8).toString("hex")}`,
      key: options.key,
      value: options.value,
      type: options.type || this.inferType(options.value),
      sourceAgentId: options.sourceAgentId,
      workspaceId: options.workspaceId,
      tags: options.tags || [],
      visibility: options.visibility || "workspace",
      ttl,
      metadata: {
        createdAt: existingIndex >= 0 ? this.store.entries[existingIndex].metadata.createdAt : now,
        updatedAt: now,
        expiresAt: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null,
        accessCount: existingIndex >= 0 ? this.store.entries[existingIndex].metadata.accessCount : 0,
        lastAccessedBy: null,
      },
    };

    if (existingIndex >= 0) {
      this.store.entries[existingIndex] = entry;
    } else {
      this.store.entries.push(entry);
    }

    this.save();
    this.emit({ type: "context:set", entry });

    return entry;
  }

  /**
   * Get context by key
   */
  get(key: string, workspaceId: string, agentId?: string): ContextEntry | null {
    const entry = this.store.entries.find(
      (e) => e.key === key && e.workspaceId === workspaceId && !this.isExpired(e)
    );

    if (!entry) return null;

    // Check visibility
    if (!this.canAccess(entry, agentId)) return null;

    // Update access metadata
    entry.metadata.accessCount++;
    entry.metadata.lastAccessedBy = agentId || null;
    this.save();

    this.emit({ type: "context:get", entryId: entry.id, agentId: agentId || "unknown" });

    return entry;
  }

  /**
   * Get context by ID
   */
  getById(id: string, agentId?: string): ContextEntry | null {
    const entry = this.store.entries.find((e) => e.id === id && !this.isExpired(e));
    if (!entry || !this.canAccess(entry, agentId)) return null;

    entry.metadata.accessCount++;
    entry.metadata.lastAccessedBy = agentId || null;
    this.save();

    return entry;
  }

  /**
   * Query context
   */
  query(workspaceId: string, query: ContextQuery, agentId?: string): ContextQueryResult {
    let entries = this.store.entries.filter((e) => e.workspaceId === workspaceId);

    // Filter expired
    if (!query.includeExpired) {
      entries = entries.filter((e) => !this.isExpired(e));
    }

    // Filter by visibility
    entries = entries.filter((e) => this.canAccess(e, agentId));

    // Filter by key pattern
    if (query.keyPattern) {
      const regex = new RegExp(query.keyPattern.replace(/\*/g, ".*"), "i");
      entries = entries.filter((e) => regex.test(e.key));
    }

    // Filter by tags
    if (query.tags && query.tags.length > 0) {
      entries = entries.filter((e) => query.tags!.some((t) => e.tags.includes(t)));
    }

    // Filter by types
    if (query.types && query.types.length > 0) {
      entries = entries.filter((e) => query.types!.includes(e.type));
    }

    // Filter by source agent
    if (query.sourceAgentId) {
      entries = entries.filter((e) => e.sourceAgentId === query.sourceAgentId);
    }

    // Filter by visibility
    if (query.visibility) {
      entries = entries.filter((e) => e.visibility === query.visibility);
    }

    // Sort
    const orderBy = query.orderBy || "updatedAt";
    const order = query.order || "desc";
    entries.sort((a, b) => {
      let aVal: number, bVal: number;

      if (orderBy === "accessCount") {
        aVal = a.metadata.accessCount;
        bVal = b.metadata.accessCount;
      } else {
        aVal = new Date(a.metadata[orderBy]).getTime();
        bVal = new Date(b.metadata[orderBy]).getTime();
      }

      return order === "asc" ? aVal - bVal : bVal - aVal;
    });

    const total = entries.length;
    const limit = query.limit || 100;
    const hasMore = total > limit;

    return {
      entries: entries.slice(0, limit),
      total,
      hasMore,
    };
  }

  /**
   * Delete context
   */
  delete(id: string): boolean {
    const index = this.store.entries.findIndex((e) => e.id === id);
    if (index === -1) return false;

    this.store.entries.splice(index, 1);
    this.save();

    this.emit({ type: "context:delete", entryId: id });

    return true;
  }

  /**
   * Delete by key
   */
  deleteByKey(key: string, workspaceId: string): boolean {
    const entry = this.store.entries.find(
      (e) => e.key === key && e.workspaceId === workspaceId
    );
    if (!entry) return false;

    return this.delete(entry.id);
  }

  /**
   * Clear all context for workspace
   */
  clearWorkspace(workspaceId: string): number {
    const before = this.store.entries.length;
    this.store.entries = this.store.entries.filter((e) => e.workspaceId !== workspaceId);
    const removed = before - this.store.entries.length;

    if (removed > 0) {
      this.save();
    }

    return removed;
  }

  // =============================================================================
  // Convenience Methods
  // =============================================================================

  /**
   * Set code snippet
   */
  setSnippet(
    agentId: string,
    workspaceId: string,
    key: string,
    snippet: CodeSnippetContext,
    tags?: string[]
  ): ContextEntry {
    return this.set({
      key,
      value: snippet,
      type: "snippet",
      sourceAgentId: agentId,
      workspaceId,
      tags: tags || ["code", snippet.language],
      visibility: "workspace",
    });
  }

  /**
   * Set decision
   */
  setDecision(
    agentId: string,
    workspaceId: string,
    key: string,
    decision: DecisionContext,
    tags?: string[]
  ): ContextEntry {
    return this.set({
      key,
      value: decision,
      type: "decision",
      sourceAgentId: agentId,
      workspaceId,
      tags: tags || ["decision"],
      visibility: "workspace",
    });
  }

  /**
   * Set dependency
   */
  setDependency(
    agentId: string,
    workspaceId: string,
    dep: DependencyContext,
    tags?: string[]
  ): ContextEntry {
    return this.set({
      key: `dep:${dep.name}`,
      value: dep,
      type: "dependency",
      sourceAgentId: agentId,
      workspaceId,
      tags: tags || ["dependency", dep.type],
      visibility: "workspace",
    });
  }

  /**
   * Set preference
   */
  setPreference(
    agentId: string,
    workspaceId: string,
    key: string,
    value: unknown
  ): ContextEntry {
    return this.set({
      key: `pref:${key}`,
      value,
      type: "preference",
      sourceAgentId: agentId,
      workspaceId,
      tags: ["preference"],
      visibility: "workspace",
      ttl: 0, // Preferences don't expire
    });
  }

  /**
   * Get all snippets
   */
  getSnippets(workspaceId: string, agentId?: string, language?: string): ContextEntry[] {
    const query: ContextQuery = {
      types: ["snippet"],
      tags: language ? [language] : undefined,
    };

    return this.query(workspaceId, query, agentId).entries;
  }

  /**
   * Get all decisions
   */
  getDecisions(workspaceId: string, agentId?: string): ContextEntry[] {
    const query: ContextQuery = {
      types: ["decision"],
      orderBy: "createdAt",
      order: "desc",
    };

    return this.query(workspaceId, query, agentId).entries;
  }

  /**
   * Get all dependencies
   */
  getDependencies(workspaceId: string, agentId?: string): ContextEntry[] {
    const query: ContextQuery = {
      types: ["dependency"],
    };

    return this.query(workspaceId, query, agentId).entries;
  }

  // =============================================================================
  // Channel Operations
  // =============================================================================

  /**
   * Create channel
   */
  createChannel(
    name: string,
    workspaceId: string,
    description?: string,
    allowedAgents?: string[]
  ): ContextChannel {
    const channel: ContextChannel = {
      id: `ch_${crypto.randomBytes(8).toString("hex")}`,
      name,
      description: description || "",
      workspaceId,
      allowedAgents: allowedAgents || [],
      settings: { ...DEFAULT_CHANNEL_SETTINGS },
      metadata: {
        createdAt: new Date().toISOString(),
        entryCount: 0,
      },
    };

    this.store.channels.push(channel);
    this.save();

    this.emit({ type: "channel:created", channel });

    return channel;
  }

  /**
   * Get channel
   */
  getChannel(channelId: string): ContextChannel | null {
    return this.store.channels.find((c) => c.id === channelId) || null;
  }

  /**
   * List channels
   */
  listChannels(workspaceId: string): ContextChannel[] {
    return this.store.channels.filter((c) => c.workspaceId === workspaceId);
  }

  /**
   * Delete channel
   */
  deleteChannel(channelId: string): boolean {
    const index = this.store.channels.findIndex((c) => c.id === channelId);
    if (index === -1) return false;

    this.store.channels.splice(index, 1);
    this.save();

    this.emit({ type: "channel:deleted", channelId });

    return true;
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private loadStore(): ContextStore {
    if (fs.existsSync(this.storePath)) {
      try {
        const content = fs.readFileSync(this.storePath, "utf-8");
        return JSON.parse(content) as ContextStore;
      } catch {
        // Corrupted file, start fresh
      }
    }

    return {
      entries: [],
      channels: [],
      version: "1.0.0",
      updatedAt: new Date().toISOString(),
    };
  }

  private save(): void {
    this.store.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.storePath, JSON.stringify(this.store, null, 2));
  }

  private inferType(value: unknown): ContextType {
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (Array.isArray(value)) return "array";
    if (typeof value === "object") return "object";
    return "string";
  }

  private isExpired(entry: ContextEntry): boolean {
    if (!entry.metadata.expiresAt) return false;
    return new Date(entry.metadata.expiresAt) < new Date();
  }

  private canAccess(entry: ContextEntry, agentId?: string): boolean {
    if (entry.visibility === "global") return true;
    if (entry.visibility === "workspace") return true;
    if (entry.visibility === "private") {
      return entry.sourceAgentId === agentId;
    }
    return false;
  }

  private cleanup(): void {
    const now = new Date();
    const expired = this.store.entries.filter((e) => this.isExpired(e));

    for (const entry of expired) {
      this.emit({ type: "context:expired", entryId: entry.id });
    }

    this.store.entries = this.store.entries.filter((e) => !this.isExpired(e));

    if (expired.length > 0) {
      this.save();
    }
  }

  /**
   * Stop cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createContextManager(storagePath: string): ContextManager {
  return new ContextManager(storagePath);
}
