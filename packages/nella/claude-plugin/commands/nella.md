---
description: Run nella MCP tools — validate, check constraints, run tests, or get session context
argument-hint: [validate|check|run|context|refactor|test|assumptions|risks|deps|history] [args]
allowed-tools: [mcp__nella__nella_run, mcp__nella__nella_validate, mcp__nella__nella_check, mcp__nella__nella_check_prerequisites, mcp__nella__nella_get_context, mcp__nella__nella_detect_risks, mcp__nella__nella_should_refuse, mcp__nella__nella_add_assumption, mcp__nella__nella_check_assumptions, mcp__nella__nella_get_file_history, mcp__nella__nella_check_dependencies, mcp__nella__nella_record_change, mcp__nella__nella_refactor, mcp__nella__nella_test, Read, Glob, Grep, Bash]
---

# /nella

The user invoked `/nella` with arguments: $ARGUMENTS

## Instructions

Use nella MCP tools based on the arguments:

- **no args** or **context**: Call `nella_get_context` to show session state, recent changes, and assumptions.
- **validate**: Call `nella_validate` with the appropriate test/lint/compile commands for this project.
- **check**: Call `nella_check` to verify constraints on recent changes.
- **run**: Call `nella_run` for full task validation (constraints + tests + metrics).
- **refactor `<code>`**: Call `nella_refactor` on the provided code.
- **test `<code>`**: Call `nella_test` to generate a test skeleton for the provided code.
- **assumptions**: Call `nella_check_assumptions` to review all tracked assumptions.
- **risks `<text>`**: Call `nella_detect_risks` on the provided text or code.
- **prerequisites**: Call `nella_check_prerequisites` to verify project setup.
- **deps**: Call `nella_check_dependencies` to check for dependency changes.
- **history `<file>`**: Call `nella_get_file_history` for the specified file path.

If no arguments are given, default to `nella_get_context`.

Summarize results clearly after running the tool(s).
