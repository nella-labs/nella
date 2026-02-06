/**
 * Context Sharing Errors
 *
 * Custom error types for context operations.
 */

// =============================================================================
// Conflict Error
// =============================================================================

/**
 * Thrown when an optimistic concurrency conflict is detected.
 * The caller provided an expectedEtag that doesn't match the stored etag.
 */
export class ContextConflictError extends Error {
  readonly code = "CONTEXT_CONFLICT";
  readonly storedEtag: string;
  readonly expectedEtag: string;

  constructor(key: string, storedEtag: string, expectedEtag: string) {
    super(
      `Conflict on key "${key}": expected etag "${expectedEtag}" but stored is "${storedEtag}". ` +
        `Re-read the entry and retry.`
    );
    this.name = "ContextConflictError";
    this.storedEtag = storedEtag;
    this.expectedEtag = expectedEtag;
  }
}

// =============================================================================
// Validation Error
// =============================================================================

/**
 * Thrown when a context value fails schema validation.
 */
export class ContextValidationError extends Error {
  readonly code = "CONTEXT_VALIDATION_FAILED";
  readonly key: string;
  readonly issues: string[];

  constructor(key: string, issues: string[]) {
    super(
      `Validation failed for key "${key}": ${issues.join("; ")}`
    );
    this.name = "ContextValidationError";
    this.key = key;
    this.issues = issues;
  }
}
