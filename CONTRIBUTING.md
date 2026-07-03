# Contributing to Nella

Thanks for your interest in contributing! This document explains how to set up
the project, run the tests, and open a pull request.

## Prerequisites

- **Node.js** >= 20 (the CLI supports >= 18, but development and CI use 20)
- **pnpm** 10 (`corepack enable` will pick up the version pinned in
  `package.json` under `packageManager`)
- **Git**

This is a pnpm + workspaces monorepo. The packages live under `packages/`:

| Package | Description |
|---------|-------------|
| `@getnella/mcp` (`packages/nella`) | CLI + MCP server |
| `@usenella/core` (`packages/core`) | Core library (indexing, search, context) |
| `@usenella/api` (`packages/api`) | HTTP API server |
| `@usenella/benchmark` (`packages/benchmark`) | Benchmark harness |

## Setup

```bash
git clone https://github.com/nella-labs/nella.git
cd nella
pnpm install
pnpm -r build
```

Copy the example environment file if you need to run pieces that talk to
external services:

```bash
cp .env.example .env
# fill in only the values you need; never commit .env
```

## Running Tests

```bash
# Run every package's test suite
pnpm -r test

# CI-equivalent run (coverage, lcov output)
pnpm -r test:ci

# A single package
pnpm --filter @usenella/core test
```

Tests use Node's built-in test runner via `tsx`, with `c8` for coverage. New
code should ship with tests; CI checks coverage thresholds.

## Development Workflow

1. **Branch** off `main`:
   ```bash
   git checkout -b feat/short-description
   ```
2. **Make your change.** Keep it focused; smaller PRs review faster.
3. **Build and test locally** (`pnpm -r build && pnpm -r test`).
4. **Add a changeset** if your change is user-facing (new feature, bug fix,
   breaking change):
   ```bash
   pnpm changeset
   ```
   Commit the generated file in `.changeset/`. Docs-only or internal-only
   changes don't need one.
5. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/)
   — commitlint enforces this. Examples:
   - `feat(core): add incremental reindex`
   - `fix(cli): handle missing workspace path`
   - `docs: clarify GCP sync setup`
6. **Open a pull request** against `main` and fill out the template.

## What CI Checks

Every pull request runs `.github/workflows/ci.yml`, which:

- installs with a frozen lockfile (`pnpm install --frozen-lockfile`)
- builds all packages (`pnpm -r build`) — this also type-checks
- runs the test suites (`pnpm -r test:ci`)
- checks coverage thresholds
- flags PRs missing a changeset
- audits dependencies

Please make sure `pnpm -r build` and `pnpm -r test` pass locally before
pushing — it's the fastest way to a green PR.

## Reporting Bugs & Requesting Features

Use the GitHub issue templates. For security issues, follow
[SECURITY.md](./SECURITY.md) instead of filing a public issue.

## Code of Conduct

By participating in this project you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](./LICENSE).
