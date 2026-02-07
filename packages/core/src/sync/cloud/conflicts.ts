import { randomUUID } from "crypto";
import type { CloudSyncConflict } from "../types";

const PREVIEW_LIMIT = 1200;

function toPreview(buffer?: Buffer): string | undefined {
  if (!buffer || buffer.length === 0) {
    return undefined;
  }
  const text = buffer.toString("utf-8");
  if (text.length <= PREVIEW_LIMIT) {
    return text;
  }
  return `${text.slice(0, PREVIEW_LIMIT)}\n...`;
}

function createUnifiedDiff(local: string, remote: string, path: string): string {
  const oldLines = local.split(/\r?\n/);
  const newLines = remote.split(/\r?\n/);
  const max = Math.max(oldLines.length, newLines.length);

  const diffLines: string[] = [];
  diffLines.push(`--- a/${path}`);
  diffLines.push(`+++ b/${path}`);
  diffLines.push("@@");

  for (let i = 0; i < max; i++) {
    const left = oldLines[i];
    const right = newLines[i];

    if (left === right) {
      if (left !== undefined) {
        diffLines.push(` ${left}`);
      }
      continue;
    }

    if (left !== undefined) {
      diffLines.push(`-${left}`);
    }
    if (right !== undefined) {
      diffLines.push(`+${right}`);
    }
  }

  return diffLines.join("\n");
}

function maybeTextDiff(
  localBuffer: Buffer | undefined,
  remoteBuffer: Buffer | undefined,
  path: string,
  maxBytes: number
): string | undefined {
  if (!localBuffer || !remoteBuffer) {
    return undefined;
  }
  if (localBuffer.length > maxBytes || remoteBuffer.length > maxBytes) {
    return undefined;
  }

  const local = localBuffer.toString("utf-8");
  const remote = remoteBuffer.toString("utf-8");
  return createUnifiedDiff(local, remote, path);
}

export interface BuildConflictInput {
  path: string;
  localHash?: string;
  remoteHash?: string;
  localModified?: string;
  remoteModified?: string;
  localBuffer?: Buffer;
  remoteBuffer?: Buffer;
  textDiffMaxBytes: number;
}

export function buildConflict(input: BuildConflictInput): CloudSyncConflict {
  return {
    id: randomUUID(),
    path: input.path,
    localHash: input.localHash,
    remoteHash: input.remoteHash,
    localModified: input.localModified,
    remoteModified: input.remoteModified,
    localPreview: toPreview(input.localBuffer),
    remotePreview: toPreview(input.remoteBuffer),
    unifiedDiff: maybeTextDiff(
      input.localBuffer,
      input.remoteBuffer,
      input.path,
      input.textDiffMaxBytes
    ),
    createdAt: new Date().toISOString(),
  };
}

