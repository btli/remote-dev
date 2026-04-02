---
description: Stage all files and create a commit.
---

Stage and commit all code in the current branch with conventional commit messages.

## Workflow

### 1. Review All Modified Files

**Check for**:
- All modified, added, and deleted files
- File diffs to understand changes
- Sensitive files that should NOT be committed

**Security Check**:
**DO NOT** commit confidential information:
- .env files
- API keys, tokens, credentials
- Database credentials
- Private keys
- Secrets or passwords

**If detected**: Warn user and exclude from commit.

### 2. Generate Conventional Commit Message

**Format**:
```
type(scope): brief description (max 70 chars)

- Detailed change 1
- Detailed change 2
- Detailed change 3
```

**Commit Types** (follow conventional commits):
- `feat` - New feature
- `fix` - Bug fix
- `perf` - Performance improvement
- `refactor` - Code refactoring
- `docs` - Documentation only
- `style` - Code style changes (formatting, etc.)
- `test` - Adding or updating tests
- `build` - Build system changes
- `ci` - CI/CD changes
- `chore` - Maintenance tasks

**Special Rules for .claude/ directory**:
- Markdown file changes in `.claude/` → use `perf:` (not `docs:`)
- New files in `.claude/` → use `feat:` (not `docs:` or `perf:`)

**Scope** (optional but recommended):
- Component, module, or area affected
- Examples: `(api)`, `(ui)`, `(auth)`, `(tests)`

**Title Requirements**:
- Maximum 70 characters
- Imperative mood ("add" not "added")
- No period at the end
- Clear and descriptive

**Body Requirements**:
- Summarized list of key changes
- Use bullet points (-)
- Focus on what and why, not how
- Include breaking changes if any

**NEVER include AI attribution**:
- NO "🤖 Generated with [Claude Code]"
- NO "Co-Authored-By: Claude <noreply@anthropic.com>"
- NO AI tool attribution or signatures
- Create clean, professional commit messages

### 3. Split Commits if Needed

**Split into separate commits when**:
- New files AND file changes together
- Changes span multiple concerns
- Different commit types mixed

**Example**:
- Commit 1: `feat: add new authentication module`
- Commit 2: `fix: correct validation in existing module`

### 4. Stage and Commit Changes

**Actions**:
```bash
git add [files]
git commit -m "commit_message"
```

**Process**:
- Stage relevant files for each commit
- Create commit with generated message
- Verify commit successful

### 5. Verify Commit Success

**Display**:
- ✅ Commit hash
- 📝 Commit message
- 📊 Files changed
- ➕ Insertions count
- ➖ Deletions count

**Example Output**:
```
✅ Commit created successfully
📝 feat(auth): add OAuth2 authentication support
🔖 Commit: abc1234
📊 5 files changed, 234 insertions(+), 12 deletions(-)
```

## Important Notes

**DO NOT push to remote repository** - This command only commits locally.

Use `/git:cp` to commit and push, or push manually after review.

## Auto-Fix Features

**Automatically fix common issues**:
- Trim whitespace in commit messages
- Ensure proper line breaks in commit body
- Add missing scope if obvious from files
- Correct common type mistakes

## Use TodoWrite

For multi-file commits, track:
- File review progress
- Commit creation for each group
- Verification steps

## Autonomous Execution

**Continue automatically** without confirmation prompts.

**Only ask for confirmation on**:
- Sensitive files detected
- Large commits (>50 files)
- Breaking changes detected

## Integration with Other Commands

**Used by**:
- `/git:feature` - Feature development workflow
- `/test-fix-deploy` - Complete deployment cycle

**Complements**:
- `/git:cp` - Commit and push
- `/git:pr` - Create pull request after commit