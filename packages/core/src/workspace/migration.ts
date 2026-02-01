/**
 * Registry Migration Manager
 *
 * Handles schema migrations for workspace registry.
 * Ensures backward compatibility when upgrading.
 */

import type { WorkspaceRegistry, WorkspaceEntry, RegistrySettings } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface Migration {
  version: string;
  description: string;
  migrate: (registry: WorkspaceRegistry) => WorkspaceRegistry;
}

export interface MigrationResult {
  fromVersion: string;
  toVersion: string;
  migrationsApplied: string[];
  success: boolean;
  error?: string;
}

// =============================================================================
// Version Comparison
// =============================================================================

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;

    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }

  return 0;
}

// =============================================================================
// Migrations
// =============================================================================

const migrations: Migration[] = [
  {
    version: "1.1.0",
    description: "Add workspace validation fields",
    migrate: (registry) => {
      // Add 'validated' field to workspaces if missing
      for (const workspace of registry.workspaces) {
        if (!("validated" in workspace)) {
          (workspace as WorkspaceEntry & { validated?: boolean }).validated = false;
        }
        if (!("validationError" in workspace)) {
          (workspace as WorkspaceEntry & { validationError?: string }).validationError = undefined;
        }
      }
      return registry;
    },
  },
  {
    version: "1.2.0",
    description: "Add global settings for sync",
    migrate: (registry) => {
      // Add sync-related settings if missing
      const settings = registry.settings as RegistrySettings & {
        syncEnabled?: boolean;
        syncProvider?: string;
      };
      
      if (settings.syncEnabled === undefined) {
        settings.syncEnabled = false;
      }
      if (settings.syncProvider === undefined) {
        settings.syncProvider = "local";
      }
      
      return registry;
    },
  },
  {
    version: "1.3.0",
    description: "Add workspace tags and metadata",
    migrate: (registry) => {
      for (const workspace of registry.workspaces) {
        const ws = workspace as WorkspaceEntry & {
          tags?: string[];
          metadata?: Record<string, unknown>;
        };
        
        if (!ws.tags) {
          ws.tags = [];
        }
        if (!ws.metadata) {
          ws.metadata = {};
        }
      }
      return registry;
    },
  },
  {
    version: "2.0.0",
    description: "Restructure for sync adapter support",
    migrate: (registry) => {
      // Add syncTier and cloud-related fields
      const settings = registry.settings as RegistrySettings & {
        syncTier?: string;
        supabaseUrl?: string;
        gcpProjectId?: string;
      };
      
      if (settings.syncTier === undefined) {
        settings.syncTier = "local";
      }
      
      // Add syncId to workspaces for cloud sync
      for (const workspace of registry.workspaces) {
        const ws = workspace as WorkspaceEntry & {
          syncId?: string;
          lastSyncedAt?: string;
        };
        
        if (!ws.syncId) {
          ws.syncId = undefined;
        }
        if (!ws.lastSyncedAt) {
          ws.lastSyncedAt = undefined;
        }
      }
      
      return registry;
    },
  },
];

// =============================================================================
// Current Version
// =============================================================================

export const CURRENT_REGISTRY_VERSION = "2.0.0";

// =============================================================================
// Migration Manager Class
// =============================================================================

export class RegistryMigrationManager {
  private migrations: Migration[];

  constructor() {
    // Sort migrations by version
    this.migrations = [...migrations].sort((a, b) =>
      compareVersions(a.version, b.version)
    );
  }

  /**
   * Get pending migrations for a registry
   */
  getPendingMigrations(currentVersion: string): Migration[] {
    return this.migrations.filter(
      (m) => compareVersions(m.version, currentVersion) > 0
    );
  }

  /**
   * Check if migration is needed
   */
  needsMigration(registry: WorkspaceRegistry): boolean {
    const currentVersion = registry.version || "1.0.0";
    return compareVersions(currentVersion, CURRENT_REGISTRY_VERSION) < 0;
  }

  /**
   * Migrate registry to latest version
   */
  migrate(registry: WorkspaceRegistry): MigrationResult {
    const fromVersion = registry.version || "1.0.0";
    const migrationsApplied: string[] = [];

    try {
      let current = { ...registry };
      const pending = this.getPendingMigrations(fromVersion);

      for (const migration of pending) {
        current = migration.migrate(current);
        current.version = migration.version;
        migrationsApplied.push(migration.version);
      }

      // Update to current version
      current.version = CURRENT_REGISTRY_VERSION;
      current.updatedAt = new Date().toISOString();

      // Copy migrated data back
      Object.assign(registry, current);

      return {
        fromVersion,
        toVersion: CURRENT_REGISTRY_VERSION,
        migrationsApplied,
        success: true,
      };
    } catch (error) {
      return {
        fromVersion,
        toVersion: CURRENT_REGISTRY_VERSION,
        migrationsApplied,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Validate registry structure
   */
  validate(registry: WorkspaceRegistry): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    if (!registry.workspaces || !Array.isArray(registry.workspaces)) {
      errors.push("Missing or invalid 'workspaces' array");
    }

    if (!registry.settings) {
      errors.push("Missing 'settings' object");
    }

    if (!registry.version) {
      errors.push("Missing 'version' field");
    }

    // Validate each workspace
    if (registry.workspaces) {
      for (let i = 0; i < registry.workspaces.length; i++) {
        const ws = registry.workspaces[i];
        const prefix = `Workspace[${i}]`;

        if (!ws.id) {
          errors.push(`${prefix}: Missing 'id'`);
        }
        if (!ws.name) {
          errors.push(`${prefix}: Missing 'name'`);
        }
        if (!ws.path) {
          errors.push(`${prefix}: Missing 'path'`);
        }
        if (!ws.createdAt) {
          errors.push(`${prefix}: Missing 'createdAt'`);
        }
        if (!ws.lastAccessed) {
          errors.push(`${prefix}: Missing 'lastAccessed'`);
        }
        if (!ws.indexStatus) {
          errors.push(`${prefix}: Missing 'indexStatus'`);
        }
        if (!ws.stats) {
          errors.push(`${prefix}: Missing 'stats'`);
        }
      }
    }

    // Validate settings
    if (registry.settings) {
      if (typeof registry.settings.maxWorkspaces !== "number") {
        errors.push("Settings: Missing or invalid 'maxWorkspaces'");
      }
      if (typeof registry.settings.autoCleanup !== "boolean") {
        errors.push("Settings: Missing or invalid 'autoCleanup'");
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get current version
   */
  getCurrentVersion(): string {
    return CURRENT_REGISTRY_VERSION;
  }

  /**
   * Get all available migrations
   */
  getAllMigrations(): Migration[] {
    return [...this.migrations];
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createMigrationManager(): RegistryMigrationManager {
  return new RegistryMigrationManager();
}
