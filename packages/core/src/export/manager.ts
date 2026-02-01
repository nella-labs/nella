/**
 * Export Manager
 *
 * Export data in multiple formats.
 */

import * as fs from "fs";
import * as path from "path";
import type {
  ExportFormat,
  ExportConfig,
  ExportBundle,
  ExportEvent,
  ExportInclude,
  ExportOptions,
  ToolCallExport,
  SearchExport,
  VerifyExport,
} from "./types";
import { DEFAULT_EXPORT_INCLUDE, DEFAULT_EXPORT_OPTIONS } from "./types";

// =============================================================================
// Types
// =============================================================================

export type ExportEventHandler = (event: ExportEvent) => void;

// =============================================================================
// Export Manager Class
// =============================================================================

export class ExportManager {
  private eventHandlers: ExportEventHandler[] = [];

  // =============================================================================
  // Event Handling
  // =============================================================================

  onEvent(handler: ExportEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: ExportEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Export event handler error:", error);
      }
    }
  }

  // =============================================================================
  // Export Methods
  // =============================================================================

  /**
   * Export data bundle to specified format
   */
  async export(bundle: ExportBundle, config: Partial<ExportConfig> & { format: ExportFormat; outputPath: string }): Promise<string> {
    const fullConfig: ExportConfig = {
      format: config.format,
      outputPath: config.outputPath,
      include: { ...DEFAULT_EXPORT_INCLUDE, ...config.include },
      options: { ...DEFAULT_EXPORT_OPTIONS, ...config.options },
      timeRange: config.timeRange,
    };

    this.emit({ type: "export:started", format: fullConfig.format });

    try {
      let content: string;
      let outputPath: string;

      switch (fullConfig.format) {
        case "json":
          content = this.toJson(bundle, fullConfig);
          outputPath = fullConfig.outputPath.endsWith(".json") ? fullConfig.outputPath : `${fullConfig.outputPath}.json`;
          break;
        case "csv":
          content = this.toCsv(bundle, fullConfig);
          outputPath = fullConfig.outputPath.endsWith(".csv") ? fullConfig.outputPath : `${fullConfig.outputPath}.csv`;
          break;
        case "html":
          content = this.toHtml(bundle, fullConfig);
          outputPath = fullConfig.outputPath.endsWith(".html") ? fullConfig.outputPath : `${fullConfig.outputPath}.html`;
          break;
        case "markdown":
          content = this.toMarkdown(bundle, fullConfig);
          outputPath = fullConfig.outputPath.endsWith(".md") ? fullConfig.outputPath : `${fullConfig.outputPath}.md`;
          break;
        case "opentelemetry":
          content = this.toOpenTelemetry(bundle, fullConfig);
          outputPath = fullConfig.outputPath.endsWith(".json") ? fullConfig.outputPath : `${fullConfig.outputPath}.otlp.json`;
          break;
        default:
          throw new Error(`Unsupported format: ${fullConfig.format}`);
      }

      // Ensure directory exists
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(outputPath, content);

      const size = Buffer.byteLength(content);
      this.emit({ type: "export:completed", outputPath, size });

      return outputPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: "export:error", error: message });
      throw error;
    }
  }

  // =============================================================================
  // Format Converters
  // =============================================================================

  private toJson(bundle: ExportBundle, config: ExportConfig): string {
    const data = this.filterBundle(bundle, config.include);
    return config.options.pretty
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
  }

  private toCsv(bundle: ExportBundle, config: ExportConfig): string {
    const delimiter = config.options.delimiter || ",";
    const lines: string[] = [];

    // Export tool calls as CSV
    if (bundle.toolCalls && bundle.toolCalls.length > 0) {
      if (config.options.headers) {
        lines.push(["id", "toolName", "success", "duration", "timestamp", "error"].join(delimiter));
      }

      for (const call of bundle.toolCalls) {
        lines.push([
          this.escapeCsv(call.id),
          this.escapeCsv(call.toolName),
          String(call.success),
          String(call.duration),
          this.escapeCsv(call.timestamp),
          this.escapeCsv(call.error || ""),
        ].join(delimiter));
      }
    }

    return lines.join("\n");
  }

  private toHtml(bundle: ExportBundle, config: ExportConfig): string {
    const styles = config.options.includeStyles ? this.getHtmlStyles() : "";
    const title = `Nella Export - ${bundle.metadata.workspaceName}`;

    let content = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${styles}
</head>
<body>
  <div class="container">
    <header>
      <h1>${title}</h1>
      <p class="meta">Exported: ${bundle.metadata.exportedAt}</p>
    </header>
`;

    // Index Stats
    if (bundle.indexStats) {
      content += `
    <section class="stats">
      <h2>Index Statistics</h2>
      <div class="stat-grid">
        <div class="stat">
          <span class="stat-value">${bundle.indexStats.filesIndexed}</span>
          <span class="stat-label">Files Indexed</span>
        </div>
        <div class="stat">
          <span class="stat-value">${bundle.indexStats.chunksCount}</span>
          <span class="stat-label">Code Chunks</span>
        </div>
        <div class="stat">
          <span class="stat-value">${(bundle.indexStats.totalTokens / 1000).toFixed(1)}k</span>
          <span class="stat-label">Tokens</span>
        </div>
      </div>
    </section>
`;
    }

    // Tool Calls
    if (bundle.toolCalls && bundle.toolCalls.length > 0) {
      content += `
    <section class="tool-calls">
      <h2>Tool Calls (${bundle.toolCalls.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
`;

      for (const call of bundle.toolCalls.slice(0, 100)) {
        const status = call.success ? '<span class="success">✓</span>' : '<span class="error">✗</span>';
        content += `
          <tr>
            <td>${call.toolName}</td>
            <td>${status}</td>
            <td>${call.duration}ms</td>
            <td>${new Date(call.timestamp).toLocaleString()}</td>
          </tr>
`;
      }

      content += `
        </tbody>
      </table>
    </section>
`;
    }

    // Errors
    if (bundle.errors && bundle.errors.length > 0) {
      content += `
    <section class="errors">
      <h2>Errors (${bundle.errors.length})</h2>
      <ul>
`;
      for (const error of bundle.errors) {
        content += `        <li><strong>${error.type}:</strong> ${error.message}</li>\n`;
      }
      content += `
      </ul>
    </section>
`;
    }

    content += `
  </div>
</body>
</html>`;

    return content;
  }

  private toMarkdown(bundle: ExportBundle, config: ExportConfig): string {
    const h1 = "#".repeat(config.options.headingLevel || 1);
    const h2 = "#".repeat((config.options.headingLevel || 1) + 1);
    const h3 = "#".repeat((config.options.headingLevel || 1) + 2);

    let content = `${h1} Nella Export Report\n\n`;
    content += `**Workspace:** ${bundle.metadata.workspaceName}\n`;
    content += `**Exported:** ${bundle.metadata.exportedAt}\n`;
    content += `**Version:** ${bundle.metadata.version}\n\n`;

    // Table of Contents
    if (config.options.includeTableOfContents) {
      content += `${h2} Table of Contents\n\n`;
      if (bundle.indexStats) content += `- [Index Statistics](#index-statistics)\n`;
      if (bundle.toolCalls?.length) content += `- [Tool Calls](#tool-calls)\n`;
      if (bundle.searches?.length) content += `- [Searches](#searches)\n`;
      if (bundle.verifications?.length) content += `- [Verifications](#verifications)\n`;
      if (bundle.errors?.length) content += `- [Errors](#errors)\n`;
      content += `\n`;
    }

    // Index Stats
    if (bundle.indexStats) {
      content += `${h2} Index Statistics\n\n`;
      content += `| Metric | Value |\n`;
      content += `|--------|-------|\n`;
      content += `| Files Indexed | ${bundle.indexStats.filesIndexed} |\n`;
      content += `| Code Chunks | ${bundle.indexStats.chunksCount} |\n`;
      content += `| Total Tokens | ${bundle.indexStats.totalTokens} |\n`;
      content += `| Last Indexed | ${bundle.indexStats.lastIndexed} |\n\n`;
    }

    // Tool Calls
    if (bundle.toolCalls && bundle.toolCalls.length > 0) {
      content += `${h2} Tool Calls\n\n`;
      content += `| Tool | Status | Duration | Time |\n`;
      content += `|------|--------|----------|------|\n`;
      
      for (const call of bundle.toolCalls.slice(0, 50)) {
        const status = call.success ? "✅" : "❌";
        content += `| ${call.toolName} | ${status} | ${call.duration}ms | ${call.timestamp} |\n`;
      }
      
      if (bundle.toolCalls.length > 50) {
        content += `\n*...and ${bundle.toolCalls.length - 50} more*\n`;
      }
      content += `\n`;
    }

    // Searches
    if (bundle.searches && bundle.searches.length > 0) {
      content += `${h2} Searches\n\n`;
      for (const search of bundle.searches.slice(0, 20)) {
        content += `${h3} "${search.query}"\n\n`;
        content += `- **Results:** ${search.resultsCount}\n`;
        content += `- **Confidence:** ${(search.confidence * 100).toFixed(0)}%\n`;
        content += `- **Duration:** ${search.duration}ms\n\n`;
      }
    }

    // Errors
    if (bundle.errors && bundle.errors.length > 0) {
      content += `${h2} Errors\n\n`;
      for (const error of bundle.errors) {
        content += `- **${error.type}:** ${error.message} (${error.timestamp})\n`;
      }
      content += `\n`;
    }

    return content;
  }

  private toOpenTelemetry(bundle: ExportBundle, config: ExportConfig): string {
    // OpenTelemetry Protocol (OTLP) JSON format
    const traces: any[] = [];

    if (bundle.toolCalls) {
      for (const call of bundle.toolCalls) {
        traces.push({
          traceId: this.generateTraceId(),
          spanId: this.generateSpanId(),
          name: call.toolName,
          kind: 1, // SPAN_KIND_SERVER
          startTimeUnixNano: new Date(call.timestamp).getTime() * 1000000,
          endTimeUnixNano: (new Date(call.timestamp).getTime() + call.duration) * 1000000,
          attributes: [
            { key: "tool.name", value: { stringValue: call.toolName } },
            { key: "tool.success", value: { boolValue: call.success } },
            { key: "workspace.id", value: { stringValue: call.workspaceId } },
          ],
          status: call.success
            ? { code: 1, message: "OK" }
            : { code: 2, message: call.error || "Error" },
        });
      }
    }

    const otlpData = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: config.options.serviceName || "nella" } },
              { key: "service.version", value: { stringValue: config.options.serviceVersion || "1.0.0" } },
            ],
          },
          scopeSpans: [
            {
              scope: {
                name: "nella.mcp",
                version: bundle.metadata.version,
              },
              spans: traces,
            },
          ],
        },
      ],
    };

    return JSON.stringify(otlpData, null, 2);
  }

  // =============================================================================
  // Helpers
  // =============================================================================

  private filterBundle(bundle: ExportBundle, include: ExportInclude): Partial<ExportBundle> {
    const result: Partial<ExportBundle> = {
      metadata: bundle.metadata,
    };

    if (include.toolCalls && bundle.toolCalls) result.toolCalls = bundle.toolCalls;
    if (include.searchResults && bundle.searches) result.searches = bundle.searches;
    if (include.verifyResults && bundle.verifications) result.verifications = bundle.verifications;
    if (include.context && bundle.context) result.context = bundle.context;
    if (include.indexStats && bundle.indexStats) result.indexStats = bundle.indexStats;
    if (include.rateLimits && bundle.rateLimits) result.rateLimits = bundle.rateLimits;
    if (include.errors && bundle.errors) result.errors = bundle.errors;

    return result;
  }

  private escapeCsv(value: string): string {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private getHtmlStyles(): string {
    return `
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    header { margin-bottom: 2rem; }
    h1 { color: #2563eb; }
    .meta { color: #666; font-size: 0.9rem; }
    section { background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h2 { color: #1e40af; margin-bottom: 1rem; font-size: 1.25rem; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; }
    .stat { text-align: center; padding: 1rem; background: #f8fafc; border-radius: 6px; }
    .stat-value { display: block; font-size: 2rem; font-weight: bold; color: #2563eb; }
    .stat-label { color: #64748b; font-size: 0.875rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f8fafc; font-weight: 600; }
    .success { color: #22c55e; }
    .error { color: #ef4444; }
    ul { list-style: none; }
    li { padding: 0.5rem 0; border-bottom: 1px solid #e2e8f0; }
    li:last-child { border-bottom: none; }
  </style>
`;
  }

  private generateTraceId(): string {
    const bytes = new Array(16).fill(0).map(() => Math.floor(Math.random() * 256));
    return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  private generateSpanId(): string {
    const bytes = new Array(8).fill(0).map(() => Math.floor(Math.random() * 256));
    return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createExportManager(): ExportManager {
  return new ExportManager();
}
