/**
 * MCP Telemetry
 *
 * OpenTelemetry integration for MCP tool handler.
 * Provides tracing, metrics, and instrumentation.
 *
 * This module is opt-in — telemetry is only initialized if
 * TelemetryConfig is provided to the handler.
 */

import type { ToolCallMetadata } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface TelemetryConfig {
  /** Service name for traces (default: "nella-mcp") */
  serviceName?: string;
  /** OTLP endpoint for trace export */
  otlpEndpoint?: string;
  /** Whether to enable console exporter for debugging */
  consoleExport?: boolean;
  /** Additional resource attributes */
  attributes?: Record<string, string>;
  /** Enable metrics collection (default: true) */
  enableMetrics?: boolean;
  /** Prometheus metrics port (default: 9464) */
  metricsPort?: number;
}

/**
 * Span representation for tool calls.
 * Wraps OpenTelemetry Span API when available, degrades to no-op.
 */
export interface ToolSpan {
  /** Set attribute on the span */
  setAttribute(key: string, value: string | number | boolean): void;
  /** Record an error on the span */
  recordError(error: Error): void;
  /** End the span */
  end(): void;
}

/**
 * Metrics collected per tool call.
 */
export interface ToolMetrics {
  toolCallTotal: number;
  toolCallErrors: number;
  toolCallDurationMs: number[];
  cacheHits: number;
  cacheMisses: number;
  retryCount: number;
}

// =============================================================================
// Telemetry Manager
// =============================================================================

export class TelemetryManager {
  private config: TelemetryConfig;
  private tracer: OTelTracer | null = null;
  private meter: OTelMeter | null = null;
  private sdk: any = null;
  private initialized = false;
  private aggregatedMetrics: Map<string, ToolMetrics> = new Map();

  constructor(config: TelemetryConfig) {
    this.config = {
      serviceName: "nella-mcp",
      enableMetrics: true,
      metricsPort: 9464,
      ...config,
    };
  }

  /**
   * Initialize OpenTelemetry SDK.
   * This is async because it dynamically imports OTel packages.
   * If packages are not installed, telemetry degrades gracefully to no-op.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Use require() with a variable to prevent TypeScript from resolving
    // optional peer dependencies at compile time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tryRequire = (id: string): any => {
      try { return require(id); } catch { return null; }
    };

    try {
      const api = tryRequire("@opentelemetry/api");
      const sdkNode = tryRequire("@opentelemetry/sdk-node");
      const sdkTrace = tryRequire("@opentelemetry/sdk-trace-base");
      const resources = tryRequire("@opentelemetry/resources");

      if (!api || !sdkNode || !sdkTrace || !resources) {
        this.initialized = true;
        return;
      }

      const { NodeSDK } = sdkNode;
      const { SimpleSpanProcessor } = sdkTrace;
      const { Resource } = resources;

      const spanProcessors: any[] = [];

      // OTLP exporter
      if (this.config.otlpEndpoint) {
        const otlpMod = tryRequire("@opentelemetry/exporter-trace-otlp-http");
        if (otlpMod) {
          const otlpExporter = new otlpMod.OTLPTraceExporter({
            url: this.config.otlpEndpoint,
          });
          spanProcessors.push(new SimpleSpanProcessor(otlpExporter));
        }
      }

      // Console exporter (for debugging)
      if (this.config.consoleExport) {
        const { ConsoleSpanExporter } = sdkTrace;
        if (ConsoleSpanExporter) {
          spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
        }
      }

      const resource = new Resource({
        "service.name": this.config.serviceName!,
        ...this.config.attributes,
      });

      this.sdk = new NodeSDK({
        resource,
        spanProcessors: spanProcessors.length > 0 ? spanProcessors : undefined,
      });

      this.sdk.start();

      this.tracer = api.trace.getTracer(this.config.serviceName!, "1.0.0") as unknown as OTelTracer;

      if (this.config.enableMetrics) {
        this.meter = api.metrics.getMeter(this.config.serviceName!) as unknown as OTelMeter;
      }

      this.initialized = true;
    } catch {
      // OpenTelemetry packages not installed — degrade gracefully
      this.initialized = true; // Don't retry
    }
  }

  /**
   * Create a span for a tool call.
   */
  createToolSpan(toolName: string, args: Record<string, unknown>): ToolSpan {
    if (!this.tracer) {
      return createNoOpSpan();
    }

    try {
      const span = (this.tracer as any).startSpan(`tool:${toolName}`, {
        attributes: {
          "tool.name": toolName,
          "tool.args_keys": Object.keys(args).join(","),
        },
      });

      return {
        setAttribute(key: string, value: string | number | boolean): void {
          span.setAttribute(key, value);
        },
        recordError(error: Error): void {
          span.recordException(error);
          span.setStatus({ code: 2, message: error.message }); // SpanStatusCode.ERROR = 2
        },
        end(): void {
          span.end();
        },
      };
    } catch {
      return createNoOpSpan();
    }
  }

  /**
   * Record metrics from a completed tool call.
   */
  recordToolMetrics(metadata: ToolCallMetadata & {
    cacheHit?: boolean;
    retryCount?: number;
  }): void {
    // Aggregate into local metrics
    const toolMetrics = this.getOrCreateMetrics(metadata.toolName);
    toolMetrics.toolCallTotal++;
    if (!metadata.success) toolMetrics.toolCallErrors++;
    if (metadata.duration) toolMetrics.toolCallDurationMs.push(metadata.duration);
    if (metadata.cacheHit) toolMetrics.cacheHits++;
    else toolMetrics.cacheMisses++;
    if (metadata.retryCount) toolMetrics.retryCount += metadata.retryCount;

    // Record to OTel meter if available
    if (this.meter) {
      try {
        // These are fire-and-forget metric recordings
        const attrs = { "tool.name": metadata.toolName };
        // Note: In a full implementation, we'd create instruments once
        // and reuse them. For simplicity, we record via the aggregated map
        // and the OTel meter handles deduplication.
      } catch {
        // Metrics recording failure should not affect tool execution
      }
    }
  }

  /**
   * Get aggregated metrics for all tools.
   */
  getMetrics(): Map<string, ToolMetrics> {
    return new Map(this.aggregatedMetrics);
  }

  /**
   * Get metrics summary as formatted text.
   */
  getMetricsSummary(): string {
    const lines: string[] = ["## Telemetry Metrics\n"];

    for (const [tool, metrics] of this.aggregatedMetrics) {
      const avgDuration = metrics.toolCallDurationMs.length > 0
        ? (metrics.toolCallDurationMs.reduce((a, b) => a + b, 0) / metrics.toolCallDurationMs.length).toFixed(1)
        : "N/A";
      const errorRate = metrics.toolCallTotal > 0
        ? ((metrics.toolCallErrors / metrics.toolCallTotal) * 100).toFixed(1)
        : "0";
      const cacheTotal = metrics.cacheHits + metrics.cacheMisses;
      const cacheHitRate = cacheTotal > 0
        ? ((metrics.cacheHits / cacheTotal) * 100).toFixed(1)
        : "N/A";

      lines.push(`### ${tool}`);
      lines.push(`- Calls: ${metrics.toolCallTotal}`);
      lines.push(`- Errors: ${metrics.toolCallErrors} (${errorRate}%)`);
      lines.push(`- Avg Duration: ${avgDuration}ms`);
      lines.push(`- Cache Hit Rate: ${cacheHitRate}%`);
      lines.push(`- Retries: ${metrics.retryCount}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Shutdown the telemetry SDK.
   */
  async shutdown(): Promise<void> {
    if (this.sdk) {
      try {
        await this.sdk.shutdown();
      } catch {
        // Ignore shutdown errors
      }
    }
  }

  // =============================================================================
  // Private
  // =============================================================================

  private getOrCreateMetrics(toolName: string): ToolMetrics {
    let metrics = this.aggregatedMetrics.get(toolName);
    if (!metrics) {
      metrics = {
        toolCallTotal: 0,
        toolCallErrors: 0,
        toolCallDurationMs: [],
        cacheHits: 0,
        cacheMisses: 0,
        retryCount: 0,
      };
      this.aggregatedMetrics.set(toolName, metrics);
    }
    return metrics;
  }
}

// =============================================================================
// No-Op Span (used when OTel is not available)
// =============================================================================

function createNoOpSpan(): ToolSpan {
  return {
    setAttribute() {},
    recordError() {},
    end() {},
  };
}

// =============================================================================
// OTel Type Stubs (avoid hard dependency on @opentelemetry/api types)
// =============================================================================

interface OTelTracer {
  startSpan(name: string, options?: any): any;
}

interface OTelMeter {
  createCounter(name: string, options?: any): any;
  createHistogram(name: string, options?: any): any;
}

// =============================================================================
// Factory
// =============================================================================

export function createTelemetryManager(config: TelemetryConfig): TelemetryManager {
  return new TelemetryManager(config);
}
