/**
 * Playground Metrics
 *
 * Prometheus-compatible metrics collector. No external dependencies —
 * uses plain counters + histograms with text serialization.
 */

// =============================================================================
// Types
// =============================================================================

export interface Counter {
  inc(labels?: Record<string, string>, value?: number): void;
  get(labels?: Record<string, string>): number;
}

export interface Histogram {
  observe(value: number, labels?: Record<string, string>): void;
  get(labels?: Record<string, string>): { count: number; sum: number; buckets: Map<number, number> };
}

export interface Gauge {
  set(value: number, labels?: Record<string, string>): void;
  inc(labels?: Record<string, string>, value?: number): void;
  dec(labels?: Record<string, string>, value?: number): void;
  get(labels?: Record<string, string>): number;
}

export interface MetricsRegistry {
  counter(name: string, help: string): Counter;
  histogram(name: string, help: string, buckets?: number[]): Histogram;
  gauge(name: string, help: string): Gauge;
  serialize(): string;
  reset(): void;
}

// =============================================================================
// Default histogram buckets (in seconds)
// =============================================================================

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// =============================================================================
// Label serialization
// =============================================================================

function serializeLabels(labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return "";
  return Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
}

function labelKey(labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return "__default__";
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
}

// =============================================================================
// Counter Implementation
// =============================================================================

class CounterImpl implements Counter {
  readonly name: string;
  readonly help: string;
  private values: Map<string, number> = new Map();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labels?: Record<string, string>, value: number = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) || 0) + value);
  }

  get(labels?: Record<string, string>): number {
    return this.values.get(labelKey(labels)) || 0;
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];
    for (const [key, value] of this.values) {
      if (key === "__default__") {
        lines.push(`${this.name} ${value}`);
      } else {
        const labels = key
          .split("|")
          .map((pair) => {
            const [k, v] = pair.split("=");
            return `${k}="${v}"`;
          })
          .join(",");
        lines.push(`${this.name}{${labels}} ${value}`);
      }
    }
    return lines.join("\n");
  }

  reset(): void {
    this.values.clear();
  }
}

// =============================================================================
// Histogram Implementation
// =============================================================================

interface HistogramData {
  count: number;
  sum: number;
  buckets: Map<number, number>;
}

class HistogramImpl implements Histogram {
  readonly name: string;
  readonly help: string;
  private buckets: number[];
  private data: Map<string, HistogramData> = new Map();

  constructor(name: string, help: string, buckets?: number[]) {
    this.name = name;
    this.help = help;
    this.buckets = buckets || DEFAULT_BUCKETS;
  }

  observe(value: number, labels?: Record<string, string>): void {
    const key = labelKey(labels);
    let data = this.data.get(key);
    if (!data) {
      data = {
        count: 0,
        sum: 0,
        buckets: new Map(this.buckets.map((b) => [b, 0])),
      };
      this.data.set(key, data);
    }
    data.count++;
    data.sum += value;
    for (const bucket of this.buckets) {
      if (value <= bucket) {
        data.buckets.set(bucket, (data.buckets.get(bucket) || 0) + 1);
      }
    }
  }

  get(labels?: Record<string, string>): HistogramData {
    const data = this.data.get(labelKey(labels));
    return data || { count: 0, sum: 0, buckets: new Map() };
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];
    for (const [key, data] of this.data) {
      const labelsStr = key === "__default__" ? "" : serializeLabels(
        Object.fromEntries(key.split("|").map((p) => p.split("=")))
      );
      const comma = labelsStr ? "," : "";

      // Cumulative bucket counts
      let cumulative = 0;
      for (const bucket of this.buckets) {
        cumulative += data.buckets.get(bucket) || 0;
        const bucketLabel = `le="${bucket}"`;
        lines.push(
          labelsStr
            ? `${this.name}_bucket{${labelsStr}${comma}${bucketLabel}} ${cumulative}`
            : `${this.name}_bucket{${bucketLabel}} ${cumulative}`
        );
      }
      // +Inf bucket
      lines.push(
        labelsStr
          ? `${this.name}_bucket{${labelsStr}${comma}le="+Inf"} ${data.count}`
          : `${this.name}_bucket{le="+Inf"} ${data.count}`
      );
      lines.push(
        labelsStr
          ? `${this.name}_sum{${labelsStr}} ${data.sum}`
          : `${this.name}_sum ${data.sum}`
      );
      lines.push(
        labelsStr
          ? `${this.name}_count{${labelsStr}} ${data.count}`
          : `${this.name}_count ${data.count}`
      );
    }
    return lines.join("\n");
  }

  reset(): void {
    this.data.clear();
  }
}

// =============================================================================
// Gauge Implementation
// =============================================================================

class GaugeImpl implements Gauge {
  readonly name: string;
  readonly help: string;
  private values: Map<string, number> = new Map();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  set(value: number, labels?: Record<string, string>): void {
    this.values.set(labelKey(labels), value);
  }

  inc(labels?: Record<string, string>, value: number = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) || 0) + value);
  }

  dec(labels?: Record<string, string>, value: number = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) || 0) - value);
  }

  get(labels?: Record<string, string>): number {
    return this.values.get(labelKey(labels)) || 0;
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
    ];
    for (const [key, value] of this.values) {
      if (key === "__default__") {
        lines.push(`${this.name} ${value}`);
      } else {
        const labels = key
          .split("|")
          .map((pair) => {
            const [k, v] = pair.split("=");
            return `${k}="${v}"`;
          })
          .join(",");
        lines.push(`${this.name}{${labels}} ${value}`);
      }
    }
    return lines.join("\n");
  }

  reset(): void {
    this.values.clear();
  }
}

// =============================================================================
// Registry Implementation
// =============================================================================

class MetricsRegistryImpl implements MetricsRegistry {
  private counters: CounterImpl[] = [];
  private histograms: HistogramImpl[] = [];
  private gauges: GaugeImpl[] = [];

  counter(name: string, help: string): Counter {
    const c = new CounterImpl(name, help);
    this.counters.push(c);
    return c;
  }

  histogram(name: string, help: string, buckets?: number[]): Histogram {
    const h = new HistogramImpl(name, help, buckets);
    this.histograms.push(h);
    return h;
  }

  gauge(name: string, help: string): Gauge {
    const g = new GaugeImpl(name, help);
    this.gauges.push(g);
    return g;
  }

  serialize(): string {
    const sections: string[] = [];
    for (const c of this.counters) sections.push(c.serialize());
    for (const h of this.histograms) sections.push(h.serialize());
    for (const g of this.gauges) sections.push(g.serialize());
    return sections.filter((s) => s.trim()).join("\n\n") + "\n";
  }

  reset(): void {
    for (const c of this.counters) c.reset();
    for (const h of this.histograms) h.reset();
    for (const g of this.gauges) g.reset();
  }
}

// =============================================================================
// Playground Metrics
// =============================================================================

export interface PlaygroundMetrics {
  /** Total tool calls by tool name and status */
  toolCallsTotal: Counter;
  /** Tool call duration in seconds by tool name */
  toolDurationSeconds: Histogram;
  /** Active WebSocket connections */
  wsConnectionsActive: Gauge;
  /** Active sessions */
  sessionsActive: Gauge;
  /** Total tokens processed */
  tokensTotal: Counter;
  /** Total estimated cost in USD */
  costTotal: Counter;
  /** Indexing duration in seconds */
  indexingDurationSeconds: Histogram;
  /** Total errors by type */
  errorsTotal: Counter;
  /** WebSocket messages by direction and type */
  wsMessagesTotal: Counter;
  /** Server uptime in seconds (set by caller) */
  uptimeSeconds: Gauge;
  /** Registry for serialization */
  registry: MetricsRegistry;
}

/**
 * Create playground metrics with pre-defined counters/histograms/gauges
 */
export function createPlaygroundMetrics(): PlaygroundMetrics {
  const registry = new MetricsRegistryImpl();

  return {
    toolCallsTotal: registry.counter(
      "playground_tool_calls_total",
      "Total number of tool calls"
    ),
    toolDurationSeconds: registry.histogram(
      "playground_tool_duration_seconds",
      "Tool call duration in seconds",
      [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]
    ),
    wsConnectionsActive: registry.gauge(
      "playground_ws_connections_active",
      "Number of active WebSocket connections"
    ),
    sessionsActive: registry.gauge(
      "playground_sessions_active",
      "Number of active sessions"
    ),
    tokensTotal: registry.counter(
      "playground_tokens_total",
      "Total tokens processed"
    ),
    costTotal: registry.counter(
      "playground_cost_total_usd",
      "Total estimated cost in USD"
    ),
    indexingDurationSeconds: registry.histogram(
      "playground_indexing_duration_seconds",
      "Workspace indexing duration in seconds",
      [1, 5, 10, 30, 60, 120, 300]
    ),
    errorsTotal: registry.counter(
      "playground_errors_total",
      "Total errors by type"
    ),
    wsMessagesTotal: registry.counter(
      "playground_ws_messages_total",
      "Total WebSocket messages"
    ),
    uptimeSeconds: registry.gauge(
      "playground_uptime_seconds",
      "Server uptime in seconds"
    ),
    registry,
  };
}
