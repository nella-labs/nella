# CI/CD Integration

Run Nella in your CI/CD pipeline to automatically validate AI-generated code changes before they're merged.

## GitHub Actions

### Basic Validation

```yaml
name: Validate Agent Changes
on:
  pull_request:
    branches: [main]

jobs:
  nella-validate:
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
        run: npm install -g @getnella/latest

      - name: Validate changes
        run: nella run -t ./tasks/my-task.yaml -r . -c changes.json --json > result.json

      - name: Check results
        run: |
          PASSED=$(cat result.json | jq '.passed')
          if [ "$PASSED" != "true" ]; then
            echo "❌ Validation failed"
            cat result.json | jq '.constraints'
            exit 1
          fi
          echo "✅ Validation passed"

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: nella-results
          path: result.json
```

### Safety Gate

Add a safety check before the agent even starts:

```yaml
  nella-safety:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g @getnella/latest
      - name: Pre-flight safety check
        run: nella check -t ./tasks/my-task.yaml -r . --json > safety.json
      - name: Verify safe to proceed
        run: |
          SHOULD_REFUSE=$(cat safety.json | jq '.shouldRefuse')
          if [ "$SHOULD_REFUSE" = "true" ]; then
            echo "🛑 Task refused: $(cat safety.json | jq -r '.reason')"
            exit 1
          fi
```

### Batch Validation (Multiple Tasks)

```yaml
  nella-batch:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        task: [add-endpoint, fix-pagination, refactor-auth]
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g @getnella/latest
      - name: Validate ${{ matrix.task }}
        run: nella run -t ./tasks/${{ matrix.task }}.yaml -r . -c changes/${{ matrix.task }}.json --json
```

## GitLab CI

```yaml
validate-agent:
  image: node:20
  stage: test
  script:
    - npm ci
    - npm install -g @getnella/latest
    - nella run -t ./tasks/$TASK_ID -r . -c changes.json --json > result.json
    - |
      PASSED=$(cat result.json | jq '.passed')
      if [ "$PASSED" != "true" ]; then
        echo "Validation failed"
        exit 1
      fi
  artifacts:
    paths:
      - result.json
    when: always
```

## Docker

Run Nella in a container for consistent environments:

```dockerfile
FROM node:20-alpine
RUN npm install -g @getnella/latest
WORKDIR /workspace
ENTRYPOINT ["nella"]
```

```bash
# Build
docker build -t nella .

# Run validation
docker run -v $(pwd):/workspace nella run -t tasks/my-task.yaml -r /workspace -c changes.json

# Run safety check
docker run -v $(pwd):/workspace nella check -t tasks/my-task.yaml -r /workspace
```

## Exit Codes

Nella's CLI uses standard exit codes for CI integration:

| Code | Meaning |
|------|---------|
| `0` | Validation passed |
| `1` | Validation failed (constraints violated, tests failed, etc.) |
| `2` | Task refused (dangerous patterns detected) |

## JSON Output Schema

When using `--json`, the output follows this structure:

```typescript
{
  passed: boolean;
  runId: string;
  metrics: {
    buildTestPass: 0 | 1;
    validationIntegrity: number;
    constraintViolationRate: number;
    scopeCreep: number;
    timeToGreen: number;
  };
  constraints: Array<{
    id: string;
    passed: boolean;
    violations: string[];
  }>;
  scope: {
    expectedFiles: string[];
    actualFiles: string[];
    unexpectedFiles: string[];
    creepRatio: number;
  };
  validation?: {
    test?: { passed: boolean; output: string };
    lint?: { passed: boolean; output: string };
    compile?: { passed: boolean; output: string };
  };
}
```

## Best Practices

1. **Run safety checks first** — `nella check` is fast and catches dangerous tasks before expensive validation runs
2. **Use `--json` for machine parsing** — Human-readable output is nice for local use, but JSON is reliable in CI
3. **Upload artifacts** — Always save results as artifacts for debugging failed pipelines
4. **Set timeouts** — Validation commands (tests, linting) can hang. Use `timeout_seconds` in the task YAML
5. **Cache `node_modules`** — Nella's validation runs tests in a cloned workspace. Cache dependencies to speed up CI

## Related Docs

- [CLI Commands](../cli/commands.md) — Full command reference
- [Task Authoring](./task-authoring.md) — Write task definitions
- [Configuration Reference](../core/configuration.md) — All configuration options
