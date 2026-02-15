/**
 * Persistence Utilities
 *
 * Provides compressed serialization for index files using MessagePack + gzip.
 * Falls back to reading legacy JSON files for backward compatibility.
 */

import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";

// =============================================================================
// Types
// =============================================================================

/** Format version for compressed persistence files */
export const PERSISTENCE_FORMAT_VERSION = 2;

interface PersistenceEnvelope<T = unknown> {
  formatVersion: number;
  data: T;
}

// =============================================================================
// MessagePack Loader
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let msgpack: any = null;

function getMsgpack(): typeof import("@msgpack/msgpack") {
  if (!msgpack) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      msgpack = require("@msgpack/msgpack");
    } catch {
      throw new Error(
        "MessagePack is required for compressed persistence. Install @msgpack/msgpack."
      );
    }
  }
  return msgpack as typeof import("@msgpack/msgpack");
}

/**
 * Check if MessagePack is available at runtime
 */
export function isMsgpackAvailable(): boolean {
  try {
    require("@msgpack/msgpack");
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Save / Load Compressed (MessagePack + gzip)
// =============================================================================

/**
 * Get the compressed file path for a given base path.
 * e.g. "chunks.json" → "chunks.msgpack.gz"
 */
export function compressedPath(basePath: string): string {
  // Strip .json extension if present, then add .msgpack.gz
  const stripped = basePath.replace(/\.json$/, "");
  return stripped + ".msgpack.gz";
}

/**
 * Save data using MessagePack + gzip compression.
 *
 * File format: gzip(msgpack({ formatVersion, data }))
 */
export function saveCompressed<T>(filePath: string, data: T): void {
  const mp = getMsgpack();

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const envelope: PersistenceEnvelope<T> = {
    formatVersion: PERSISTENCE_FORMAT_VERSION,
    data,
  };

  const encoded = mp.encode(envelope);
  const compressed = zlib.gzipSync(Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength));
  fs.writeFileSync(filePath, compressed);
}

/**
 * Load data from a MessagePack + gzip compressed file.
 */
export function loadCompressed<T>(filePath: string): T {
  const mp = getMsgpack();

  const compressed = fs.readFileSync(filePath);
  const decompressed = zlib.gunzipSync(compressed);
  const envelope = mp.decode(decompressed) as PersistenceEnvelope<T>;

  return envelope.data;
}

// =============================================================================
// Load with Fallback (compressed → JSON)
// =============================================================================

/**
 * Load data from either compressed (.msgpack.gz) or legacy JSON format.
 *
 * Tries the compressed path first, then falls back to the JSON path.
 * Returns null if neither file exists.
 */
export function loadAny<T>(jsonPath: string): { data: T; format: "compressed" | "json" } | null {
  // Try compressed format first
  const compPath = compressedPath(jsonPath);
  if (fs.existsSync(compPath)) {
    try {
      const data = loadCompressed<T>(compPath);
      return { data, format: "compressed" };
    } catch (error) {
      console.warn(`Failed to load compressed file ${compPath}, trying JSON fallback:`, error);
    }
  }

  // Fall back to JSON
  if (fs.existsSync(jsonPath)) {
    try {
      const content = fs.readFileSync(jsonPath, "utf-8");
      const data = JSON.parse(content) as T;
      return { data, format: "json" };
    } catch (error) {
      console.warn(`Failed to load JSON file ${jsonPath}:`, error);
    }
  }

  return null;
}

// =============================================================================
// Save with Format Selection
// =============================================================================

/**
 * Save data using the best available format.
 * Uses MessagePack + gzip if available, otherwise falls back to JSON.
 *
 * @param jsonPath - The base path (e.g. "chunks.json"). Compressed files
 *                   will be written alongside with .msgpack.gz extension.
 * @param data - The data to serialize.
 * @param options - Options for saving.
 */
export function saveBest<T>(
  jsonPath: string,
  data: T,
  options: { prettyJson?: boolean; forceJson?: boolean } = {}
): void {
  const dir = path.dirname(jsonPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (options.forceJson) {
    const json = options.prettyJson
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
    fs.writeFileSync(jsonPath, json);
    return;
  }

  if (isMsgpackAvailable()) {
    const compPath = compressedPath(jsonPath);
    saveCompressed(compPath, data);

    // Clean up legacy JSON file if it exists
    if (fs.existsSync(jsonPath)) {
      try {
        fs.unlinkSync(jsonPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  } else {
    // Fallback to JSON
    const json = options.prettyJson
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
    fs.writeFileSync(jsonPath, json);
  }
}

// =============================================================================
// Cleanup Helpers
// =============================================================================

/**
 * Remove both compressed and JSON versions of a persistence file.
 */
export function removePersistedFile(jsonPath: string): void {
  const paths = [jsonPath, compressedPath(jsonPath)];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
