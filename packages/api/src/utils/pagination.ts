/**
 * Cursor-Based Pagination
 *
 * Utilities for consistent cursor pagination across all list endpoints.
 * Uses opaque base64-encoded cursors wrapping an offset.
 */

export interface PaginationParams {
  cursor?: string;
  limit: number;
}

export interface PaginationMeta {
  cursor?: string;   // next cursor, absent on last page
  hasMore: boolean;
  total?: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Parse pagination query params from request.
 */
export function parsePagination(query: Record<string, unknown>): PaginationParams {
  const rawLimit = Number(query.limit) || DEFAULT_LIMIT;
  const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT);
  const cursor = typeof query.cursor === "string" ? query.cursor : undefined;
  return { cursor, limit };
}

/**
 * Decode cursor to numeric offset.
 */
export function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
    const offset = parseInt(decoded, 10);
    return Number.isNaN(offset) ? 0 : offset;
  } catch {
    return 0;
  }
}

/**
 * Encode numeric offset as opaque cursor.
 */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf-8").toString("base64url");
}

/**
 * Build pagination meta from results.
 */
export function buildPaginationMeta(
  offset: number,
  limit: number,
  returnedCount: number,
  total?: number
): PaginationMeta {
  const hasMore = returnedCount === limit;
  return {
    hasMore,
    ...(hasMore && { cursor: encodeCursor(offset + limit) }),
    ...(total !== undefined && { total }),
  };
}
