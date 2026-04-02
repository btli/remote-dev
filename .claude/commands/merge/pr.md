---
description: Merge a single PR with quality checks
argument-hint: <PR_NUMBER> [--no-review] [--squash]
---

Merge a specific PR by number with lint, typecheck, and optional code review.

## Arguments

- `<PR_NUMBER>` - Required. The PR number to merge
- `--no-review` - Skip code review after merge
- `--squash` - Use squash merge instead of merge commit

## Workflow

### 1. Validate PR

```bash
gh pr view [PR_NUMBER] --json state,mergeable,title,author
```

**Check**:
- PR exists and is open
- PR is mergeable (no conflicts)
- Display PR title and author

### 2. Merge PR

```bash
# Standard merge
gh pr merge [PR_NUMBER] --merge --delete-branch

# Or with --squash
gh pr merge [PR_NUMBER] --squash --delete-branch
```

### 3. Pull Changes

```bash
git pull origin [CURRENT_BRANCH]
```

### 4. Run Quality Checks

**For JS/TS**:
```bash
bun run lint
bun run typecheck
bun test
```

**For Python**:
```bash
uv run ruff check --fix
uv run ruff format
uv run mypy --strict .
uv run pytest
```

**On failure**:
- Attempt auto-fix (max 3 times)
- Report errors if unable to fix

### 5. Code Review (unless --no-review)

Use `pr-review-toolkit:code-reviewer` to review the merged changes:
```bash
git diff HEAD~1..HEAD
```

### 6. Fix Issues

Apply fixes for critical/high severity issues found in review.

### 7. Report

```
## PR #[NUMBER] Merge Summary

Title: [PR_TITLE]
Author: [AUTHOR]
Merge Type: [merge/squash]

Quality Checks:
- Lint: PASSED
- TypeCheck: PASSED
- Tests: PASSED

Code Review:
- Issues Found: [COUNT]
- Issues Fixed: [COUNT]
```

## Use TodoWrite
Track: PR validation, merge, quality checks, review, fixes.

## Error Handling

- **Merge conflict**: Report and exit, suggest manual resolution
- **Quality check failure**: Attempt auto-fix, report if unable
- **PR not found**: Report error with suggestion to check PR number

## Related Commands
- `/merge` - Merge all open PRs
- `/merge:review` - Run code review separately
