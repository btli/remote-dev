---
description: Complete feature branch workflow
argument-hint: "FEATURE_DESCRIPTION" [--base BRANCH]
---

## Variables

FEATURE_DESCRIPTION: $1 (required) - Brief description of the feature
BASE_BRANCH: $2 (defaults to `main`) - Base branch for feature

## Complete Feature Branch Workflow

Automate the entire feature development lifecycle from branch creation through PR.

**Usage**:
```
User: /git:feature "Add quick charge support"
User: /git:feature "Fix battery voltage scaling" --base develop
```

## Workflow

### 1. Create Feature Branch

**Auto-generate branch name**:
- Convert description to kebab-case
- Format: `feature/description-kebab-case`
- Remove special characters
- Lowercase all letters

**Example**: "Add Quick Charge Support" → `feature/add-quick-charge-support`

**Actions**:
```bash
git checkout [BASE_BRANCH]
git pull origin [BASE_BRANCH]
git checkout -b [feature-branch-name]
```

### 2. Implement Feature

**Using TodoWrite**:
- Track implementation progress
- Break down into logical steps
- Mark checkpoints as completed

**Auto-commit checkpoints** (optional):
- Create checkpoint commits during implementation
- Use descriptive messages
- Allows rollback if needed

### 3. Run Quality Checks

Use `/quality-check` workflow:
- Run all linting, type checking, tests
- Auto-fix failures (max 3 iterations)
- Only proceed if all checks pass

### 4. Create Commit

Use `/git:cm` workflow:
- Review all changes
- Generate conventional commit message
- Follow project commit conventions
- **DO NOT** include AI attribution signatures

**Commit message format**:
```
type(scope): brief description

- Detailed change 1
- Detailed change 2
- Detailed change 3
```

### 5. Push to Remote

**Create upstream branch**:
```bash
git push -u origin [feature-branch-name]
```

### 6. Create Pull Request

Use `gh pr create` command:

**Auto-generate PR description**:
```markdown
## Summary
- Key change 1
- Key change 2
- Key change 3

## Test Plan
- [x] Unit tests pass
- [x] Integration tests pass
- [x] Manual testing completed
- [x] Code coverage >95%

## Type of Change
- [ ] Bug fix
- [x] New feature
- [ ] Breaking change
- [ ] Documentation update

## Quality Checks
- ✅ Linting passed
- ✅ Type checking passed
- ✅ All tests passed
- ✅ Coverage: XX%
```

**Include**:
- Test coverage statistics
- Link related issues (auto-detect from branch/commit messages)
- Screenshots for UI changes (if applicable)
- Breaking changes warning (if applicable)

**Actions**:
```bash
gh pr create --title "[type]: [description]" --body "[auto-generated]"
```

### 7. Generate Report

**Summary includes**:
- ✅ Branch created: [branch-name]
- 📝 Commits: [count] commits
- 🧪 Tests: All passed
- 📊 Coverage: XX%
- 🔗 PR URL: [url]
- ⚠️ Any warnings

## Special Handling

### Multi-file Changes

If changes span multiple concerns, split into multiple commits:
- Group related changes together
- Separate new files from modifications
- Use clear commit messages for each group

### Breaking Changes

If breaking changes detected:
- Add `BREAKING CHANGE:` to commit message footer
- Include migration guide in PR description
- Suggest version bump (major version)

### Issue Linking

Auto-detect issue references:
- Scan commit messages for issue numbers
- Add "Fixes #123" or "Closes #123" to PR description
- Link related issues in PR body

## Safety Features

**Pre-flight checks**:
- Verify BASE_BRANCH exists
- Check for uncommitted changes
- Confirm not already on a feature branch
- Verify clean working directory

**Error handling**:
- If branch exists, offer to switch or create new name
- If BASE_BRANCH outdated, pull latest first
- If quality checks fail, don't create PR

## Autonomous Execution

**Continue automatically** through all steps without confirmation prompts.

**Use TodoWrite** to show progress:
- Branch creation
- Implementation checkpoints
- Quality checks
- Commit creation
- PR creation

**Only ask for confirmation on**:
- Feature implementation details (if unclear)
- Breaking changes impact
- Complex merge conflicts

## Integration with Other Commands

**Leverages**:
- `/quality-check` - Pre-commit validation
- `/git:cm` - Conventional commits
- `gh pr create` - PR creation

**Complements**:
- `/test-fix-deploy` - After PR is merged
- `/git:cleanup` - After feature completion
