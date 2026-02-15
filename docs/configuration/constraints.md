# Constraints

Define boundaries and rules for AI-generated changes.

Constraints define what the AI agent cannot do. They help prevent accidental modifications to critical files and ensure code quality standards are maintained.

## Constraint Structure

Each constraint has the following properties:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier for the constraint |
| `description` | `string` | Yes | Human-readable description of the constraint |
| `rule` | `string` | No | The rule statement (for documentation) |
| `filesNotToModify` | `string[]` | No | Glob patterns for files that should not be modified |
| `forbiddenPatterns` | `string[]` | No | Regex patterns that should not appear in the diff |

## filesNotToModify

Use glob patterns to protect files from modification:

```typescript
{
  id: 'protect-migrations',
  description: 'Do not modify migration files',
  filesNotToModify: [
    '**/migrations/**',
    '**/seeds/**',
  ],
}
```

### Common Patterns

| Pattern | Matches |
|---------|---------|
| `*.json` | All JSON files in root |
| `**/*.json` | All JSON files anywhere |
| `src/**/*.ts` | All TypeScript files in src |
| `!src/test/**` | Exclude test directory |
| `config/**` | All files in config directory |

> **Tip:** Nella uses standard glob patterns. Use `**` for any directory depth and `*` for any file name.

## forbiddenPatterns

Use regex patterns to detect unwanted code in diffs:

```typescript
{
  id: 'no-secrets',
  description: 'No hardcoded secrets in code',
  forbiddenPatterns: [
    // Hardcoded passwords
    'password\\s*=\\s*["\'][^"\']+["\']',

    // API keys
    'api[_-]?key\\s*=\\s*["\'][^"\']+["\']',

    // AWS credentials
    'AKIA[0-9A-Z]{16}',

    // Private keys
    '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
  ],
}
```

### Pattern Examples

| Pattern | Detects |
|---------|---------|
| `console\\.log\\(` | console.log statements |
| `debugger` | Debugger statements |
| `TODO:?\\s*HACK` | TODO HACK comments |
| `\\beval\\s*\\(` | eval() calls |
| `innerHTML\\s*=` | innerHTML assignments |

> **Warning:** Remember to escape special regex characters in your patterns. In JavaScript strings, use double backslashes (`\\`).

## Common Constraint Sets

### Security Constraints

```typescript
const securityConstraints = [
  {
    id: 'no-hardcoded-secrets',
    description: 'No hardcoded secrets',
    forbiddenPatterns: [
      'password\\s*[:=]\\s*["\'][^"\']{8,}["\']',
      'secret\\s*[:=]\\s*["\'][^"\']+["\']',
      'api[_-]?key\\s*[:=]\\s*["\'][^"\']+["\']',
    ],
  },
  {
    id: 'no-eval',
    description: 'No eval() or Function() calls',
    forbiddenPatterns: [
      '\\beval\\s*\\(',
      'new\\s+Function\\s*\\(',
    ],
  },
  {
    id: 'no-innerhtml',
    description: 'No innerHTML assignments (XSS risk)',
    forbiddenPatterns: [
      '\\.innerHTML\\s*=',
      '\\.outerHTML\\s*=',
    ],
  },
];
```

### Code Quality Constraints

```typescript
const qualityConstraints = [
  {
    id: 'no-console-log',
    description: 'No console.log in production code',
    forbiddenPatterns: ['console\\.log\\('],
  },
  {
    id: 'no-debugger',
    description: 'No debugger statements',
    forbiddenPatterns: ['\\bdebugger\\b'],
  },
  {
    id: 'no-any-type',
    description: 'No any type annotations',
    forbiddenPatterns: [':\\s*any\\b', 'as\\s+any\\b'],
  },
];
```

### File Protection Constraints

```typescript
const fileConstraints = [
  {
    id: 'protect-config',
    description: 'Do not modify root configuration',
    filesNotToModify: [
      'package.json',
      'package-lock.json',
      'pnpm-lock.yaml',
      'tsconfig.json',
      '.env*',
    ],
  },
  {
    id: 'protect-migrations',
    description: 'Do not modify existing migrations',
    filesNotToModify: [
      '**/migrations/*.sql',
      '**/migrations/*.ts',
    ],
  },
  {
    id: 'protect-ci',
    description: 'Do not modify CI/CD configuration',
    filesNotToModify: [
      '.github/**',
      '.gitlab-ci.yml',
      'Dockerfile',
    ],
  },
];
```

## Constraint Violations

When a constraint is violated, Nella returns detailed information:

```
## Constraint Check Results

❌ 2 constraint(s) violated

### Violations
- **no-console-log**: Found console.log( at line 45
- **protect-config**: Modified protected file: package.json

### Passed Constraints
- ✅ **no-secrets**: No sensitive patterns detected
- ✅ **no-eval**: No eval patterns found
```

## Next Steps

- See [Validation](./validation.md) for verification commands
- See [Configuration Overview](./overview.md) for the full picture
