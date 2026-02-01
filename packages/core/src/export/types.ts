/**
 * Export Module Types
 *
 * Types for exporting data in multiple formats.
 */

// =============================================================================
// Export Format Types
// =============================================================================

/**
 * Supported export formats
 */
export type ExportFormat = 
  | "json"
  | "csv"
  | "html"
  | "markdown"
  | "opentelemetry";

/**
 * Export configuration
 */
export interface ExportConfig {
  /** Output format */
  format: ExportFormat;
  
  /** Output path (file or directory) */
  outputPath: string;
  
  /** What to export */
  include: ExportInclude;
  
  /** Time range filter */
  timeRange?: {
    start: string;
    end: string;
  };
  
  /** Format-specific options */
  options: ExportOptions;
}

/**
 * What data to include in export
 */
export interface ExportInclude {
  /** Include tool call history */
  toolCalls?: boolean;
  
  /** Include search results */
  searchResults?: boolean;
  
  /** Include verification results */
  verifyResults?: boolean;
  
  /** Include shared context */
  context?: boolean;
  
  /** Include index statistics */
  indexStats?: boolean;
  
  /** Include rate limit data */
  rateLimits?: boolean;
  
  /** Include errors/issues */
  errors?: boolean;
}

/**
 * Format-specific export options
 */
export interface ExportOptions {
  // JSON options
  pretty?: boolean;
  
  // CSV options
  delimiter?: string;
  headers?: boolean;
  
  // HTML options
  template?: "default" | "minimal" | "detailed";
  includeStyles?: boolean;
  
  // Markdown options
  headingLevel?: 1 | 2 | 3;
  includeTableOfContents?: boolean;
  
  // OpenTelemetry options
  serviceName?: string;
  serviceVersion?: string;
  endpoint?: string;
}

// =============================================================================
// Export Data Types
// =============================================================================

/**
 * Tool call export record
 */
export interface ToolCallExport {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  success: boolean;
  error?: string;
  duration: number;
  timestamp: string;
  agentId?: string;
  workspaceId: string;
}

/**
 * Search result export record
 */
export interface SearchExport {
  id: string;
  query: string;
  mode: string;
  resultsCount: number;
  topResults: Array<{
    filePath: string;
    score: number;
    preview: string;
  }>;
  confidence: number;
  duration: number;
  timestamp: string;
}

/**
 * Verification export record
 */
export interface VerifyExport {
  id: string;
  code: string;
  valid: boolean;
  issues: Array<{
    type: string;
    message: string;
    severity: string;
  }>;
  confidence: number;
  timestamp: string;
}

/**
 * Complete export bundle
 */
export interface ExportBundle {
  metadata: {
    exportedAt: string;
    format: ExportFormat;
    workspaceId: string;
    workspaceName: string;
    version: string;
  };
  toolCalls?: ToolCallExport[];
  searches?: SearchExport[];
  verifications?: VerifyExport[];
  context?: Record<string, unknown>[];
  indexStats?: {
    filesIndexed: number;
    chunksCount: number;
    totalTokens: number;
    lastIndexed: string;
  };
  rateLimits?: Record<string, {
    used: number;
    limit: number;
    window: string;
  }>;
  errors?: Array<{
    type: string;
    message: string;
    timestamp: string;
  }>;
}

// =============================================================================
// Export Events
// =============================================================================

export type ExportEvent =
  | { type: "export:started"; format: ExportFormat }
  | { type: "export:progress"; percent: number }
  | { type: "export:completed"; outputPath: string; size: number }
  | { type: "export:error"; error: string };

// =============================================================================
// Defaults
// =============================================================================

export const DEFAULT_EXPORT_INCLUDE: ExportInclude = {
  toolCalls: true,
  searchResults: true,
  verifyResults: true,
  context: false,
  indexStats: true,
  rateLimits: false,
  errors: true,
};

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  pretty: true,
  delimiter: ",",
  headers: true,
  template: "default",
  includeStyles: true,
  headingLevel: 1,
  includeTableOfContents: true,
  serviceName: "nella",
  serviceVersion: "1.0.0",
};
