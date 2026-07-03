# Security Policy

## Reporting a Vulnerability

We take the security of Nella seriously. If you believe you have found a
security vulnerability, please report it to us privately. **Do not open a
public GitHub issue for security vulnerabilities.**

Email **pablo@pablomanjarres.com** with:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept if possible)
- Affected version(s), package(s), and configuration
- Any suggested remediation

Please include "SECURITY" in the subject line so it is triaged quickly.

## What to Expect

- **Acknowledgement** within 3 business days.
- **Assessment** and an initial severity rating within 7 business days.
- **Fix or mitigation** timeline communicated once triaged, prioritized by
  severity. We will keep you updated as we work toward a resolution.
- **Coordinated disclosure**: we ask that you give us a reasonable window to
  ship a fix before any public disclosure. We are happy to credit you.

## Scope

In scope: the code in this repository (the Nella CLI, MCP server, and core
library). Out of scope: the hosted service infrastructure, third-party
dependencies (report those upstream), and social-engineering attacks.

## Handling Secrets

Never include real credentials, API keys, tokens, or `.env` contents in an
issue, pull request, or vulnerability report. If you discover exposed secrets
in the repository or its history, report them privately via the email above
rather than filing a public issue.
