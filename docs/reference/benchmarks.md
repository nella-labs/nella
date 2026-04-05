# Benchmarks

Nella is tested across three areas: prompt injection defense, codebase search quality, and context tracking accuracy.

## Prompt Injection Defense

Nella reduces prompt injection attack success rate to **4.4%**, compared to 26.7% without protection.

| Metric | With Nella | Without Protection |
|--------|-----------|-------------------|
| Attack Success Rate | 4.4% | 26.7% |
| Detection Rate | 95.6% | — |

Tested against 750 injection samples across multiple attack categories including instruction override, role manipulation, and data exfiltration attempts.

## Codebase Search

| Metric | Result |
|--------|--------|
| Overall Recall | 86.2% |
| Mean Reciprocal Rank | 0.85 |
| Median Latency | 1.3ms |

**Recall by query type:**

| Query Type | Recall |
|------------|--------|
| Function Lookup | 100% |
| Concept Search | 89% |
| Bug Description | 85% |
| Cross-File | 62% |

## Context Tracking

| Metric | Result |
|--------|--------|
| Assumption Accuracy | 100% |
| Invalidation Detection | 100% |
| False Positive Rate | 0% |

Tested across 30 scenarios including file changes, dependency updates, schema modifications, and configuration changes.

## Methodology

Benchmarks use the Nella benchmark suite with controlled test scenarios. Results are reproducible using the open-source benchmark package.
