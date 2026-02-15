# nella_should_refuse

Determine if a task should be refused based on risk patterns and prerequisites.

The `nella_should_refuse` tool evaluates whether a task should be refused based on risk patterns, missing prerequisites, and dangerous operation indicators.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | `string` | Yes | Task identifier |
| `prompt` | `string` | Yes | The task prompt to evaluate |
| `skipPrerequisites` | `boolean` | No | Skip prerequisite checks (default: false) |

## Example

```typescript
nella_should_refuse({
  taskId: 'task-001',
  prompt: 'Delete all user data from the production database',
});
```

## Response

### Safe to Proceed

```
## Refusal Check Results

✅ **SAFE TO PROCEED**

### Analysis
- No risk patterns detected
- All prerequisites met
- Confidence: 0.00

The task appears safe to execute.
```

### Should Refuse

```
## Refusal Check Results

🚫 **SHOULD REFUSE**

### Reason
Risk patterns detected in prompt

### Matched Patterns
- `delete.*user.*data`
- `production`

### Confidence
0.60 (60%)

### Recommendation
This request contains patterns associated with security risks.
Consider declining or requesting clarification.
```

## Confidence Scoring

The confidence score indicates how strongly Nella recommends refusal:

| Score | Recommendation |
|-------|---------------|
| 0.00 – 0.49 | Safe to proceed |
| 0.50 – 0.69 | Consider refusing |
| 0.70 – 0.89 | Likely should refuse |
| 0.90 – 1.00 | Strongly recommend refusing |

### Calculation

```
confidence = min(risk_patterns * 0.3, 0.9) + prerequisite_penalty
```

- Each detected risk pattern adds 0.3 to confidence (max 0.9)
- Missing prerequisites add 0.5 to confidence
- Final score is capped at 1.0

## Use Cases

### Pre-task Screening

Check tasks before starting work:

```typescript
const result = await nella_should_refuse({
  taskId: 'user-request-123',
  prompt: userRequest,
});

if (result.shouldRefuse) {
  respondWithClarificationRequest();
} else {
  executeTask();
}
```

### Automated Filtering

Filter tasks in an automated pipeline:

```typescript
async function processTask(task: Task) {
  const check = await nella_should_refuse({
    taskId: task.id,
    prompt: task.description,
    skipPrerequisites: true,
  });

  if (check.shouldRefuse && check.confidence > 0.7) {
    logSkippedTask(task, check.reason);
    return;
  }

  if (check.shouldRefuse) {
    queueForReview(task, check.reason);
    return;
  }

  executeTask(task);
}
```

> **Note:** When `skipPrerequisites` is false (default), Nella verifies that the workspace has required files like `package.json` and installed dependencies.

## Related Tools

- [`nella_detect_risks`](./nella-detect-risks.md) — Analyze content for specific risk patterns
- [`nella_run`](./nella-run.md) — Complete workflow including refusal check
- [`nella_check_prerequisites`](./nella-check-prerequisites.md) — Check prerequisites separately
