import { createHash } from "crypto";
import { readFile } from "fs/promises";

export interface DeltaChunk {
  index: number;
  hash: string;
  size: number;
  compressed?: boolean;
}

export interface FileManifest {
  path: string;
  fileHash: string;
  size: number;
  modifiedAt: string;
  isBinary: boolean;
  compression?: "gzip";
  encryption?: "aes-256-gcm";
  chunks: DeltaChunk[];
}

export interface LocalManifestWithChunks {
  manifest: FileManifest;
  chunks: Buffer[];
}

export function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function encodePathForObject(path: string): string {
  return encodeURIComponent(path);
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, 8192);
  for (let i = 0; i < length; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

export function splitBuffer(buffer: Buffer, chunkSizeBytes: number): Buffer[] {
  if (buffer.length === 0) {
    return [Buffer.alloc(0)];
  }

  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += chunkSizeBytes) {
    chunks.push(buffer.subarray(offset, Math.min(offset + chunkSizeBytes, buffer.length)));
  }
  return chunks;
}

export async function computeLocalManifest(
  absPath: string,
  relativePath: string,
  chunkSizeBytes: number,
  smallFileThresholdBytes: number
): Promise<LocalManifestWithChunks> {
  const buffer = await readFile(absPath);
  const fileHash = sha256(buffer);
  const isSmall = buffer.length <= smallFileThresholdBytes;
  const effectiveChunkSize = isSmall ? Math.max(1, buffer.length) : chunkSizeBytes;
  const rawChunks = splitBuffer(buffer, effectiveChunkSize);
  const chunks = rawChunks.map((chunk, index) => ({
    index,
    hash: sha256(chunk),
    size: chunk.length,
  }));

  return {
    manifest: {
      path: relativePath,
      fileHash,
      size: buffer.length,
      modifiedAt: new Date().toISOString(),
      isBinary: isBinaryBuffer(buffer),
      chunks,
    },
    chunks: rawChunks,
  };
}

export function rebuildFromChunks(chunks: Buffer[]): Buffer {
  if (chunks.length === 0) {
    return Buffer.alloc(0);
  }
  return Buffer.concat(chunks);
}
