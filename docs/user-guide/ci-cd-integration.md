# CI/CD Integration

Run Nella in your CI/CD pipeline to index your codebase and keep search indexes up to date.

## GitHub Actions

### Index on Push

```yaml
name: Index Codebase
on:
  push:
    branches: [main]

jobs:
  nella-index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Install Nella
        run: npm install -g @getnella/mcp

      - name: Index codebase
        run: nella index
```

## Docker

Run Nella in a container for consistent environments:

```dockerfile
FROM node:20-alpine
RUN npm install -g @getnella/mcp
WORKDIR /workspace
ENTRYPOINT ["nella"]
```

```bash
# Build
docker build -t nella .

# Run indexing
docker run -v $(pwd):/workspace nella index
```

## Best Practices

1. **Use `--json` for machine parsing** — Human-readable output is nice for local use, but JSON is reliable in CI
2. **Upload artifacts** — Always save results as artifacts for debugging failed pipelines
3. **Cache `node_modules`** — Cache dependencies to speed up CI

## Related Docs

- [Task Authoring](./task-authoring.md) — Write task definitions
- [Configuration Reference](../core/configuration.md) — All configuration options
