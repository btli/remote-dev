---
description: Merge all outstanding PRs with quality checks and code review
argument-hint: [--no-review] [--branch BRANCH]
---

Merge all outstanding PRs, run lint and type checks after each merge, perform comprehensive code review, and fix any identified issues.

## Arguments

- `--no-review` - Skip the comprehensive code review step
- `--branch BRANCH` - Target branch for merges (default: current branch, typically main/master)

## Workflow

### 1. Pre-Flight Checks

**Verify environment**:
```bash
# Check gh CLI is available and authenticated
gh auth status

# Check current branch and ensure clean working directory
git status
```

**If issues detected**:
- Uncommitted changes: Stash or warn user
- Not on target branch: Checkout target branch or use --branch flag
- gh CLI not authenticated: Prompt user to run `gh auth login`

### 2. List Outstanding PRs

```bash
gh pr list --state open --json number,title,headRefName,author,mergeable
```

**Display summary**:
- PR number and title
- Author
- Source branch
- Mergeable status (check for conflicts)

**If no open PRs**: Report "No open PRs to merge" and exit.

### 3. Merge PRs Sequentially

For each mergeable PR:

**Step 3a. Merge the PR**:
```bash
gh pr merge [PR_NUMBER] --merge --delete-branch
```

**Step 3b. Pull latest changes**:
```bash
git pull origin [TARGET_BRANCH]
```

**Step 3c. Run lint and type checks**:

Detect project type and run appropriate checks:

**For JavaScript/TypeScript (bun)**:
```bash
bun run lint
bun run typecheck
```

**For Python (uv)**:
```bash
uv run ruff check --fix
uv run ruff format
uv run mypy --strict .
```

**If checks fail**:
- Attempt auto-fix (ruff check --fix, bun run lint --fix)
- Re-run checks
- If still failing after 3 attempts: Stop and report errors, skip remaining PRs

**Step 3d. Continue to next PR** if all checks pass

### 4. Post-Merge Summary

After all PRs merged, display:
- Total PRs merged
- Any PRs skipped (conflicts, failed checks)
- Current branch status

### 5. Comprehensive Code Review (unless --no-review)

**Use the code-reviewer subagent** to perform thorough review:

Launch the `pr-review-toolkit:code-reviewer` agent with:
- Focus on recently merged changes
- Check for: bugs, logic errors, security vulnerabilities, code quality issues
- Verify adherence to project conventions

**Review scope**:
```bash
# Get diff of all changes from merges
git diff HEAD~[NUMBER_OF_MERGED_PRS]..HEAD
```

### 6. Fix Identified Issues

For each issue found in code review:

**Step 6a. Categorize by severity**:
- Critical: Security vulnerabilities, data loss risks
- High: Logic errors, bugs that affect functionality
- Medium: Code quality, maintainability issues
- Low: Style, minor improvements

**Step 6b. Implement fixes**:
- Fix critical and high severity issues automatically
- For medium/low: Create TODO or issue tracker entry
- Use TodoWrite to track fix progress

**Step 6c. Run quality checks after fixes**:
```bash
# For TS/JS
bun run lint && bun run typecheck && bun test

# For Python
uv run ruff check --fix && uv run ruff format && uv run mypy --strict . && uv run pytest
```

**Step 6d. Commit fixes** (if any):
- Stage fixed files
- Create commit: `fix: address code review issues from PR merges`
- Do NOT push automatically (user should review)

### 7. Final Report

**Generate summary**:
```
## Merge Summary

### PRs Merged
- #123: Feature A (merged successfully)
- #124: Bug fix B (merged successfully)
- #125: Refactor C (skipped - merge conflict)

### Quality Checks
- Lint: PASSED
- TypeCheck: PASSED
- Tests: PASSED

### Code Review Findings
- Critical: 0
- High: 2 (fixed)
- Medium: 3 (logged as TODOs)
- Low: 5 (noted)

### Commits Created
- abc1234: fix: address code review issues from PR merges

### Next Steps
- Review fix commit: git show abc1234
- Push when ready: git push origin [BRANCH]
- Resolve conflict in PR #125 manually
```

## Use TodoWrite

Track progress through:
1. Pre-flight checks
2. Each PR merge (with lint/typecheck status)
3. Code review progress
4. Issue fixes

## Autonomous Execution

**Continue automatically** without confirmation prompts for:
- Merging PRs that pass checks
- Running lint/typecheck
- Applying auto-fixes
- Fixing critical/high severity issues

**Ask for confirmation on**:
- PRs with merge conflicts
- Tests failing after fixes
- Pushing commits to remote
- Destructive operations

## Error Recovery

**Max 3 attempts** for each:
- Lint/typecheck failures (with auto-fix)
- Test failures
- Code review fixes

**On persistent failure**: Stop, report errors, allow user to intervene.

## Related Commands

- `/merge:pr [PR_NUMBER]` - Merge a single PR
- `/merge:review` - Run only the code review step
- `/merge:all` - Alias for /merge with verbose output
- `/quality-check` - Run quality checks without merging

## Integration

Works with:
- `/git:cm` - For committing fixes
- `/git:cleanup` - Clean up merged branches
- `/quality-check` - Quality validation
