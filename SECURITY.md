# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Nella, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **security@usenella.com**

Include the following details:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

| Action                     | SLA           |
| -------------------------- | ------------- |
| Acknowledge receipt        | 48 hours      |
| Initial assessment         | 5 business days |
| Fix for critical issues    | 7 business days |
| Fix for non-critical issues| 30 days       |
| Public disclosure          | After fix is released |

## Security Measures

Nella implements the following security practices:

### Authentication & Authorization
- API key authentication with SHA-256 hashing (keys are never stored in plaintext)
- Scope-based access control (RBAC)
- Key expiration and revocation support
- Rate limiting per API key

### Infrastructure
- All dependencies monitored via Dependabot
- CodeQL static analysis on every PR and weekly
- Secret scanning via TruffleHog
- npm audit on every CI run

### Code Quality
- TypeScript strict mode
- Zod schema validation on all API inputs
- Helmet.js security headers
- CORS configured with explicit allowed origins

### Data
- No user data persisted beyond workspace metadata
- API keys hashed with SHA-256 before storage
- Request logging excludes sensitive headers

## Dependencies

We actively monitor and update dependencies:
- Dependabot runs weekly for minor/patch updates
- Major version updates are reviewed manually
- `pnpm audit` is part of the CI pipeline

## Disclosure Policy

We follow coordinated disclosure. Once a vulnerability is confirmed and fixed:
1. A security advisory will be published on GitHub
2. Affected versions will be clearly documented
3. Users will be notified to upgrade
