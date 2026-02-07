import { readdir, readFile, lstat } from "fs/promises";
import { join, relative, resolve, sep } from "path";
import { minimatch } from "minimatch";
import type { CloudSyncOptions } from "../types";

const IGNORE_FILE = ".nella-syncignore";

export function toPosixPath(input: string): string {
  return input.split(sep).join("/");
}

export async function loadIgnorePatterns(workspacePath: string): Promise<string[]> {
  const path = join(workspacePath, IGNORE_FILE);
  try {
    const raw = await readFile(path, "utf-8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch {
    return [];
  }
}

export function shouldSyncPath(
  relativePath: string,
  options: Pick<CloudSyncOptions, "include" | "exclude">,
  ignorePatterns: string[] = []
): boolean {
  const normalized = toPosixPath(relativePath);

  const excluded =
    options.exclude.some((pattern) =>
      minimatch(normalized, pattern, { dot: true, nocase: false })
    ) ||
    ignorePatterns.some((pattern) =>
      minimatch(normalized, pattern, { dot: true, nocase: false })
    );
  if (excluded) {
    return false;
  }

  return options.include.some((pattern) =>
    minimatch(normalized, pattern, { dot: true, nocase: false })
  );
}

export async function collectWorkspaceFiles(
  workspacePath: string,
  options: Pick<CloudSyncOptions, "include" | "exclude">
): Promise<string[]> {
  const root = resolve(workspacePath);
  const ignore = await loadIgnorePatterns(root);
  const results: string[] = [];

  async function walk(absPath: string): Promise<void> {
    const dirents = await readdir(absPath, { withFileTypes: true });
    for (const dirent of dirents) {
      const child = join(absPath, dirent.name);

      if (dirent.isSymbolicLink()) {
        continue;
      }

      if (dirent.isDirectory()) {
        await walk(child);
        continue;
      }

      if (!dirent.isFile()) {
        continue;
      }

      const stats = await lstat(child);
      if (!stats.isFile()) {
        continue;
      }

      const rel = toPosixPath(relative(root, child));
      if (shouldSyncPath(rel, options, ignore)) {
        results.push(rel);
      }
    }
  }

  await walk(root);
  return results.sort();
}

