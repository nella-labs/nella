/**
 * WebSocket Channel Definitions
 *
 * Predefined channel patterns for real-time events.
 */

/**
 * Channel patterns:
 *   workspace:{id}:index    — Indexing progress events
 *   workspace:{id}:changes  — File change notifications
 *   workspace:{id}:context  — Context updates
 *   session:{id}:events     — Session lifecycle events
 */

export function workspaceIndexChannel(workspaceId: string): string {
  return `workspace:${workspaceId}:index`;
}

export function workspaceChangesChannel(workspaceId: string): string {
  return `workspace:${workspaceId}:changes`;
}

export function workspaceContextChannel(workspaceId: string): string {
  return `workspace:${workspaceId}:context`;
}

export function sessionEventsChannel(sessionId: string): string {
  return `session:${sessionId}:events`;
}

/**
 * Validate a channel name matches an expected pattern.
 */
export function isValidChannel(channel: string): boolean {
  const patterns = [
    /^workspace:[a-zA-Z0-9_-]+:(index|changes|context)$/,
    /^session:[a-zA-Z0-9_-]+:events$/,
  ];
  return patterns.some((p) => p.test(channel));
}
