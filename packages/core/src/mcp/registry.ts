/**
 * MCP Tool Registry
 *
 * Manages tool versions, metadata, and lookup.
 * Supports multiple versions of the same tool and deprecation.
 */

import type { McpTool, ToolCategory, ToolExample } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface ToolRegistryEntry {
  tool: McpTool;
  deprecated?: boolean;
  deprecatedMessage?: string;
  successor?: string; // name@version of the replacement tool
  registeredAt: number;
}

export interface ToolFilter {
  category?: ToolCategory;
  tags?: string[];
  includeDeprecated?: boolean;
  version?: string;
}

// =============================================================================
// Tool Registry Class
// =============================================================================

export class ToolRegistry {
  /** Map of "name@version" → entry */
  private entries: Map<string, ToolRegistryEntry> = new Map();
  /** Map of "name" → latest version */
  private latestVersions: Map<string, string> = new Map();

  /**
   * Register a tool.
   */
  register(tool: McpTool): void {
    const version = tool.version || "1.0.0";
    const key = `${tool.name}@${version}`;

    this.entries.set(key, {
      tool: { ...tool, version },
      registeredAt: Date.now(),
    });

    // Update latest version tracking
    const currentLatest = this.latestVersions.get(tool.name);
    if (!currentLatest || this.compareVersions(version, currentLatest) > 0) {
      this.latestVersions.set(tool.name, version);
    }
  }

  /**
   * Register multiple tools at once.
   */
  registerAll(tools: McpTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Get a tool by name and optional version.
   * Returns the latest version if no version is specified.
   */
  get(name: string, version?: string): McpTool | undefined {
    if (version) {
      return this.entries.get(`${name}@${version}`)?.tool;
    }

    // Get latest version
    const latestVersion = this.latestVersions.get(name);
    if (!latestVersion) return undefined;

    return this.entries.get(`${name}@${latestVersion}`)?.tool;
  }

  /**
   * Resolve a tool name that may include version (e.g., "nella_search@2.0.0").
   */
  resolve(nameOrVersioned: string): McpTool | undefined {
    if (nameOrVersioned.includes("@")) {
      const [name, version] = nameOrVersioned.split("@");
      return this.get(name, version);
    }
    return this.get(nameOrVersioned);
  }

  /**
   * List all tools, optionally filtered.
   */
  list(filter?: ToolFilter): McpTool[] {
    const tools: McpTool[] = [];
    const seen = new Set<string>();

    for (const [key, entry] of this.entries) {
      // Skip deprecated unless requested
      if (entry.deprecated && !filter?.includeDeprecated) continue;

      // If no version filter, only return latest versions
      if (!filter?.version) {
        const latestVersion = this.latestVersions.get(entry.tool.name);
        const entryVersion = entry.tool.version || "1.0.0";
        if (entryVersion !== latestVersion) continue;
      } else if (filter.version) {
        const entryVersion = entry.tool.version || "1.0.0";
        if (entryVersion !== filter.version) continue;
      }

      // Filter by category
      if (filter?.category && entry.tool.category !== filter.category) continue;

      // Filter by tags (all specified tags must be present)
      if (filter?.tags && filter.tags.length > 0) {
        const toolTags = entry.tool.tags || [];
        if (!filter.tags.every((t) => toolTags.includes(t))) continue;
      }

      // Dedup
      const dedupeKey = filter?.version ? key : entry.tool.name;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      tools.push(entry.tool);
    }

    return tools;
  }

  /**
   * Mark a tool version as deprecated.
   */
  deprecate(name: string, version: string, successor?: string): boolean {
    const key = `${name}@${version}`;
    const entry = this.entries.get(key);
    if (!entry) return false;

    entry.deprecated = true;
    entry.deprecatedMessage = successor
      ? `Deprecated. Use ${successor} instead.`
      : "Deprecated.";
    entry.successor = successor;
    return true;
  }

  /**
   * Check if a tool version is deprecated.
   */
  isDeprecated(name: string, version?: string): boolean {
    const v = version || this.latestVersions.get(name);
    if (!v) return false;
    return this.entries.get(`${name}@${v}`)?.deprecated || false;
  }

  /**
   * Get all versions of a tool.
   */
  getVersions(name: string): string[] {
    const versions: string[] = [];
    for (const [key] of this.entries) {
      if (key.startsWith(`${name}@`)) {
        versions.push(key.split("@")[1]);
      }
    }
    return versions.sort((a, b) => this.compareVersions(a, b));
  }

  /**
   * Get number of registered tools (unique names, latest versions only).
   */
  get size(): number {
    return this.latestVersions.size;
  }

  /**
   * Check if a tool exists.
   */
  has(name: string): boolean {
    return this.latestVersions.has(name);
  }

  // =============================================================================
  // Private
  // =============================================================================

  /**
   * Simple semver comparison. Returns positive if a > b, negative if a < b, 0 if equal.
   */
  private compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
