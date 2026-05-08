/**
 * Load environment variables from .env files.
 *
 * Loads (in order, later does NOT override earlier values):
 *   1. cwd/.env
 *   2. workspace/.env (if different from cwd)
 *
 * Existing process.env values always win.
 *
 * Called at the entry of the CLI and stdio MCP server so users can put
 * VOYAGE_API_KEY (or AZURE_*) in a workspace .env without exporting it.
 */

import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

const loadedPaths = new Set<string>();

export function loadEnvFiles(workspacePath?: string): void {
  const candidates: string[] = [];
  const cwdEnv = path.resolve(process.cwd(), ".env");
  candidates.push(cwdEnv);

  if (workspacePath) {
    const wsEnv = path.resolve(workspacePath, ".env");
    if (wsEnv !== cwdEnv) candidates.push(wsEnv);
  }

  for (const file of candidates) {
    if (loadedPaths.has(file)) continue;
    loadedPaths.add(file);
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, override: false });
    }
  }
}
