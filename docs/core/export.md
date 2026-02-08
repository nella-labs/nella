# Export

The Export module converts Nella run records, context, and analysis results into portable formats for sharing, reporting, and archival.

## Key Exports

- `createExportManager` / `ExportManager` — export data in multiple formats

## Quick Start

```ts
import { createExportManager } from '@usenella/core';

const exporter = createExportManager('/path/to/.nella');

const bundle = await exporter.export({
  format: 'json',
  include: ['runs', 'context', 'metrics'],
  outputPath: './nella-export.json',
});
```

## Supported Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| `json` | `.json` | Structured JSON export |
| `markdown` | `.md` | Human-readable markdown report |
| `csv` | `.csv` | Tabular data (metrics, runs) |
| `html` | `.html` | Standalone HTML report with charts |

## Export Options

```ts
interface ExportOptions {
  format: 'json' | 'markdown' | 'csv' | 'html';
  include: Array<'runs' | 'context' | 'metrics' | 'assumptions' | 'changes'>;
  outputPath?: string;       // Write to file (optional)
  dateRange?: {
    from: Date;
    to: Date;
  };
  workspaceId?: string;      // Filter by workspace
}
```

## Examples

### Markdown Report

```ts
const bundle = await exporter.export({
  format: 'markdown',
  include: ['runs', 'metrics'],
  outputPath: './report.md',
});
```

Output:
```markdown
# Nella Run Report
Generated: 2026-02-08

## Summary
| Metric | Value |
|--------|-------|
| Total Runs | 24 |
| Passed | 22 |
| Failed | 2 |
| Pass Rate | 91.7% |

## Failed Runs
### Run 2026-02-07_143052
- Task: fix-duplicate-email
- Violations: `no-auth-changes` constraint
...
```

### CSV Export

```ts
const bundle = await exporter.export({
  format: 'csv',
  include: ['metrics'],
  dateRange: { from: new Date('2026-01-01'), to: new Date('2026-02-01') },
});

// Returns CSV string with columns:
// runId, taskId, passed, scopeCreep, constraintViolations, validationIntegrity
```

### HTML Dashboard

```ts
const bundle = await exporter.export({
  format: 'html',
  include: ['runs', 'metrics', 'context'],
  outputPath: './dashboard.html',
});
// Opens a standalone HTML file with interactive charts
```

## Export Bundle

```ts
interface ExportBundle {
  format: string;
  content: string;          // The exported content
  size: number;             // Size in bytes
  exportedAt: Date;
  itemCount: number;        // Number of items exported
  outputPath?: string;      // File path if written to disk
}
```

## Related Docs

- [Core Modules Guide](modules.md) — All modules overview
- [Core API Reference](api-reference.md) — Full API surface
