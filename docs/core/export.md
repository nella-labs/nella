# Export Manager

The export module bundles tool calls, search results, verification data, and context into portable artifacts (JSON, CSV, HTML, Markdown, or OpenTelemetry).

## Key Exports

- `createExportManager` — create an exporter instance
- `DEFAULT_EXPORT_OPTIONS` / `DEFAULT_EXPORT_INCLUDE` — default output settings

## Quick Start

```ts
import { createExportManager } from '@usenella/core';

const exporter = createExportManager();
await exporter.export(
  {
    metadata: {
      exportedAt: new Date().toISOString(),
      format: 'markdown',
      workspaceId: 'repo-1',
      workspaceName: 'Backend API',
      version: '0.1.0',
    },
    toolCalls: [],
    searches: [],
    verifications: [],
    context: [],
    indexStats: {
      filesIndexed: 0,
      chunksCount: 0,
      totalTokens: 0,
      lastIndexed: new Date().toISOString(),
    },
    rateLimits: {},
    errors: [],
  },
  { format: 'markdown', outputPath: '/path/to/reports/nella-run' }
);
```

## Customize Output

```ts
await exporter.export(
  {
    metadata: {
      exportedAt: new Date().toISOString(),
      format: 'html',
      workspaceId: 'repo-1',
      workspaceName: 'Backend API',
      version: '0.1.0',
    },
    toolCalls: [],
    searches: [],
    verifications: [],
  },
  {
    format: 'html',
    outputPath: './reports/run-42',
    options: { template: 'detailed', includeStyles: true },
    include: { toolCalls: true, searchResults: true },
  }
);
```

## Related Docs

- [Core Modules guide](./modules.md)
