---
description: Run comprehensive code review and fix identified issues
argument-hint: [--scope SCOPE] [--fix-level LEVEL]
---

Perform comprehensive code review on recent changes and fix identified issues.

This is the code review and fix portion of the merge workflow, useful when you want to review changes without merging.

## Arguments

- `--scope SCOPE` - Review scope: `recent` (last commit), `staged`, `unstaged`, `branch` (vs main), `all` (default: `unstaged`)
- `--fix-level LEVEL` - Auto-fix level: `critical`, `high`, `medium`, `all` (default: `high`)

## Workflow

### 1. Determine Review Scope

**Based on --scope flag**:

```bash
# recent: Last commit
git diff HEAD~1..HEAD

# staged: Staged changes
git diff --cached

# unstaged: Unstaged changes (default)
git diff

# branch: All changes vs main branch
git diff main...HEAD

# all: All uncommitted changes
git diff HEAD
```

### 2. Launch Code Review Subagent

Use `pr-review-toolkit:code-reviewer` agent to analyze changes:

**Focus areas**:
- Bugs and logic errors
- Security vulnerabilities
- Code quality issues
- Project convention adherence
- Type safety
- Error handling

**Agent prompt**:
"Review the following code changes for bugs, security issues, and code quality problems. Focus on high-confidence issues that truly matter. Provide specific file paths and line numbers."

### 3. Categorize Findings

Group issues by severity:

**Critical** (always fix):
- Security vulnerabilities (injection, XSS, etc.)
- Data loss risks
- Authentication/authorization issues
- Hardcoded secrets

**High** (fix by default):
- Logic errors affecting functionality
- Null/undefined handling issues
- Missing error handling for likely failures
- Race conditions

**Medium** (fix if --fix-level medium or all):
- Code quality issues
- Maintainability concerns
- Missing validation
- Performance issues

**Low** (log only):
- Style suggestions
- Minor optimizations
- Documentation gaps

### 4. Implement Fixes

Based on --fix-level:

**For each issue to fix**:
1. Read the affected file
2. Apply the fix
3. Verify fix doesn't break functionality
4. Track with TodoWrite

**Fix commit** (if changes made):
```bash
git add [fixed_files]
git commit -m "fix: address code review findings

- [list of fixes applied]"
```

### 5. Run Quality Checks

After applying fixes:

```bash
# JS/TS
bun run lint && bun run typecheck && bun test

# Python
uv run ruff check --fix && uv run ruff format && uv run mypy --strict . && uv run pytest
```

### 6. Generate Report

```
## Code Review Report

### Scope: [SCOPE]
Files reviewed: [COUNT]
Lines analyzed: [COUNT]

### Findings by Severity

#### Critical (0)
(none)

#### High (2) - Fixed
1. [file:line] Missing null check in API response handler
2. [file:line] SQL injection vulnerability in query builder

#### Medium (3) - Logged
1. [file:line] Consider adding retry logic for network calls
2. [file:line] Magic number should be a named constant
3. [file:line] Function exceeds recommended complexity

#### Low (5) - Noted
1. [file:line] Consider extracting helper function
...

### Fixes Applied
- abc1234: fix: address code review findings

### Quality Check Results
- Lint: PASSED
- TypeCheck: PASSED
- Tests: PASSED

### Recommended Next Steps
- Review medium severity issues for future sprints
- Consider adding tests for fixed areas
```

## Use TodoWrite

Track:
1. Scope determination
2. Code review analysis
3. Each fix applied
4. Quality checks
5. Report generation

## Autonomous Execution

**Auto-fix** critical and high severity issues without confirmation.

**Ask for confirmation**:
- Before fixing medium/low issues
- If fixes might change behavior significantly
- Before committing if many files changed

## Error Recovery

**Max 3 attempts** for:
- Each individual fix
- Quality check failures

**On failure**: Log error, skip to next issue, continue workflow.

## Related Commands

- `/merge` - Full merge workflow including review
- `/quality-check` - Run lint/typecheck/tests only
- `/git:cm` - Commit changes after review
