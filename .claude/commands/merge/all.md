---
description: Full merge workflow with verbose output
argument-hint: [--branch BRANCH]
---

Full merge workflow: merge all open PRs, lint, typecheck, code review, and fix issues.

This is the verbose version of `/merge` with detailed progress output.

## Workflow

Execute `/merge` workflow with enhanced logging:

### 1. Environment Check
- Display git status, current branch, remote info
- List all open PRs with detailed metadata
- Show project configuration (package.json/pyproject.toml)

### 2. PR Merging (verbose)
For each PR:
- Show full PR description and diff summary
- Display merge command being executed
- Show complete lint/typecheck output
- Log all auto-fix attempts

### 3. Code Review (detailed)
- Use `pr-review-toolkit:code-reviewer` subagent
- Display all findings with code snippets
- Show fix proposals before applying

### 4. Comprehensive Report
- Full diff of all merged changes
- Complete list of all issues found/fixed
- Detailed test results
- Branch comparison with remote

## Use TodoWrite
Track all steps with verbose status updates.

## Autonomous Execution
Same rules as `/merge` - continue automatically for non-destructive operations.

## Related Commands
- `/merge` - Standard merge workflow
- `/merge:pr` - Merge single PR
- `/merge:review` - Code review only
