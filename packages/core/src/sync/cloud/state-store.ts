import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import type {
  CloudSyncState,
  CloudSyncOptions,
  CloudSyncStats,
  CloudSyncHistoryEntry,
} from "../types";

function emptyStats(): CloudSyncStats {
  return {
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    queued: 0,
    conflicts: 0,
    errors: 0,
    bytesUploaded: 0,
    bytesDownloaded: 0,
    duration: 0,
  };
}

function defaultState(workspaceId: string, workspacePath: string): CloudSyncState {
  return {
    workspaceId,
    workspacePath,
    status: "idle",
    lastSync: null,
    files: [],
    pending: [],
    conflicts: [],
    history: [],
    errors: [],
  };
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

function normalizeState(
  state: CloudSyncState,
  workspaceId: string,
  workspacePath: string
): CloudSyncState {
  return {
    workspaceId,
    workspacePath,
    status: state.status || "idle",
    lastSync: state.lastSync || null,
    files: state.files || [],
    pending: state.pending || [],
    conflicts: state.conflicts || [],
    history: state.history || [],
    errors: state.errors || [],
  };
}

/**
 * Persistent state store for cloud sync.
 */
export class CloudSyncStateStore {
  readonly canonicalPath: string;
  readonly legacyPath: string;

  constructor(
    private readonly workspaceId: string,
    private readonly workspacePath: string,
    private readonly options: Pick<CloudSyncOptions, "maxHistoryEntries">
  ) {
    this.canonicalPath = join(
      workspacePath,
      ".nella",
      "sync",
      workspaceId,
      "state.json"
    );
    this.legacyPath = join(workspacePath, ".sync-state.json");
  }

  async load(): Promise<CloudSyncState> {
    if (existsSync(this.canonicalPath)) {
      try {
        const raw = await readFile(this.canonicalPath, "utf-8");
        const parsed = JSON.parse(raw) as CloudSyncState;
        return normalizeState(parsed, this.workspaceId, this.workspacePath);
      } catch {
        return defaultState(this.workspaceId, this.workspacePath);
      }
    }

    // Legacy migration path.
    if (existsSync(this.legacyPath)) {
      try {
        const raw = await readFile(this.legacyPath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<CloudSyncState> & {
          workspaceId?: string;
          lastSync?: string | null;
          status?: "idle" | "syncing" | "conflict" | "error";
          files?: CloudSyncState["files"];
          pending?: CloudSyncState["pending"];
          history?: CloudSyncState["history"];
          errors?: CloudSyncState["errors"];
        };

        const migrated = normalizeState(
          {
            workspaceId: parsed.workspaceId || this.workspaceId,
            workspacePath: this.workspacePath,
            status: parsed.status || "idle",
            lastSync: parsed.lastSync || null,
            files: parsed.files || [],
            pending: parsed.pending || [],
            conflicts: parsed.conflicts || [],
            history: parsed.history || [],
            errors: parsed.errors || [],
          },
          this.workspaceId,
          this.workspacePath
        );
        await this.save(migrated);
        return migrated;
      } catch {
        return defaultState(this.workspaceId, this.workspacePath);
      }
    }

    return defaultState(this.workspaceId, this.workspacePath);
  }

  async save(state: CloudSyncState): Promise<void> {
    await ensureDir(this.canonicalPath);
    const trimmed = this.trimHistory(state);
    await writeFile(this.canonicalPath, JSON.stringify(trimmed, null, 2), "utf-8");
  }

  addHistoryEntry(state: CloudSyncState, entry: CloudSyncHistoryEntry): CloudSyncState {
    const max = this.options.maxHistoryEntries ?? 100;
    const history = [...state.history, entry];
    return {
      ...state,
      history: history.slice(-max),
    };
  }

  addError(state: CloudSyncState, path: string, message: string): CloudSyncState {
    const errors = [...state.errors, { path, message, timestamp: new Date().toISOString() }];
    return {
      ...state,
      errors: errors.slice(-100),
    };
  }

  createFailedHistoryEntry(mode: "sync" | "push" | "pull", error: string): CloudSyncHistoryEntry {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      mode,
      startedAt: now,
      completedAt: now,
      status: "error",
      stats: emptyStats(),
      error,
    };
  }

  private trimHistory(state: CloudSyncState): CloudSyncState {
    const max = this.options.maxHistoryEntries ?? 100;
    return {
      ...state,
      history: state.history.slice(-max),
    };
  }
}
