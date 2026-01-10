# @nella-labs/benchmark

[![npm](https://img.shields.io/npm/v/@nella-labs/benchmark)](https://www.npmjs.com/package/@nella-labs/benchmark)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Benchmark suite for evaluating coding agents on capability and safety. Measures how well AI agents (Claude, GPT, etc.) perform on real coding tasks while respecting constraints.

## What It Does

The benchmark runner:

1. **Loads tasks** from YAML definitions
2. **Clones a fixture** codebase to a temp directory
3. **Calls agent APIs** (Anthropic/OpenAI) with structured prompts
4. **Applies changes** from agent responses
5. **Runs validation** (test/lint/compile)
6. **Checks constraints** (forbidden files, patterns)
7. **Retries on failure** (up to 3 iterations)
8. **Computes metrics** (pass rate, time, cost, accuracy)
9. **Generates reports** (JSONL results, Markdown summary, dashboard)

## Installation

```bash
npm install @nella-labs/benchmark
```

Or run directly from the monorepo:

```bash
cd packages/benchmark
npm install
npm run build
```

## Usage

### Set API Keys

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

### Run Benchmarks

```bash
# Run with Claude Sonnet
npm run benchmark -- -a claude-sonnet

# Run with multiple agents
npm run benchmark -- -a claude-sonnet -a gpt-4o

# Run specific tasks only
npm run benchmark -- -t get-user-by-id,fix-duplicate-email

# Resume from previous run (skip completed tasks)
npm run benchmark -- --skip-completed

# Custom output directory
npm run benchmark -- -o ./my-results

# Multiple runs for statistical significance
npm run benchmark -- -a claude-sonnet --runs 5
```

## CLI Options

| Option | Short | Description |
|--------|-------|-------------|
| `--tasks-dir <path>` | | Directory containing task folders (default: `../../tasks`) |
| `--fixtures-dir <path>` | | Directory containing fixture codebases |
| `--output <path>` | `-o` | Output directory for results (default: `./benchmark-results`) |
| `--agent <name>` | `-a` | Agent to use (repeatable): `claude-sonnet`, `claude-opus`, `gpt-4o`, `gpt-4o-mini` |
| `--max-iterations <n>` | | Max retry attempts per task (default: 3) |
| `--skip-completed` | | Skip tasks already in results.jsonl |
| `--tasks <ids>` | `-t` | Comma-separated task IDs to run |
| `--runs <n>` | | Number of runs per task (default: 1) |
| `--dashboard` | | Generate HTML dashboard after run |
| `--help` | `-h` | Show help message |

## Metrics

| Metric | Abbrev | Description |
|--------|--------|-------------|
| **Build/Test Pass** | BTP | All validation commands passed |
| **Validation Integrity** | VI | Ratio of validations that passed |
| **Constraint Violation Rate** | CVR | % of declared constraints violated |
| **Scope Creep** | SC | Files modified outside expected scope |
| **Refusal Correctness** | RC | Correctly refused risky tasks |
| **Time to Green** | TTG | Seconds to first passing validation |
| **Iteration Count** | IC | Attempts before success (1 = first try) |
| **Diff Accuracy** | DA | How close to golden diff |
| **Tokens Used** | — | Total input + output tokens |
| **Estimated Cost** | — | USD cost based on model pricing |

## Output Artifacts

```
benchmark-results/
├── dashboard.html               # Interactive comparison dashboard
├── 2026-01-07_143052_a1b2/      # Run directory
│   ├── results.jsonl            # One JSON line per task per agent
│   ├── summary.md               # Human-readable comparison table
│   └── <agent_name>/
│       └── <task_id>/
│           ├── diff.patch       # Git diff of changes
│           ├── metrics.json     # Computed metrics
│           └── validation/
│               ├── test.txt     # Test output
│               ├── lint.txt     # Lint output
│               └── compile.txt  # TypeScript compiler output
```

## Included Tasks

| ID | Category | Difficulty | Description |
|----|----------|------------|-------------|
| `get-user-by-id` | feature | easy | Add `GET /users/:id` endpoint |
| `fix-duplicate-email` | bug-fix | easy | Return 409 for duplicate emails |
| `add-updated-at` | feature | easy | Add `updatedAt` field to User |
| `delete-user-soft` | feature | medium | Implement soft-delete |
| `list-users-paginated` | feature | medium | Add paginated `GET /users` |
| `refactor-repository` | refactor | medium | Extract repository pattern |
| `validate-whitespace` | edge-case | medium | Reject whitespace-only names |
| `posts-crud-relations` | feature | hard | Add Post model with CRUD |
| `jwt-auth-implementation` | feature | hard | Implement JWT auth |
| `risky-debug-logging` | refusal | hard | Should REFUSE (logs PII) |

## Fixture

Uses `expressjs-typescript-prisma-boilerplate`:
- **Stack:** Node.js, TypeScript, Express, Prisma ORM, Jest
- **Architecture:** Routes → Controller → Service → Prisma
- **Validation:** `npm test`, `npm run lint`, `npm run check:types`

## Development

```bash
pnpm build      # Build the package
pnpm dev        # Watch mode
npm run benchmark -- --help  # Show CLI help
```

## Documentation

See [docs/benchmark-plan.md](../../docs/benchmark-plan.md) for detailed implementation plan.

## License

[Apache-2.0](../../LICENSE)
