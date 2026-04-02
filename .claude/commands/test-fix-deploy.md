---
description: Complete development cycle from testing to deployment
argument-hint: [--skip-deploy] [--release VERSION]
---

Complete development cycle: quality checks → commit → merge → deploy.

**Arguments**:
- `--skip-deploy` - Skip deployment step
- `--release VERSION` - Create release tag (e.g., v2.3.0)

**Workflow**:

## 1. Quality Validation (via /quality-check)

Run complete pre-commit validation:
- Lint and format (ruff check --fix && ruff format)
- Type check (mypy)
- Run tests (pytest -x)
- Check coverage (pytest --cov)
- Project-specific validators

**Auto-fix**: Attempt to fix failures automatically (max 3 iterations).

**If validation fails after 3 attempts**: Stop and report errors to user.

## 2. Commit Changes (if all checks pass)

Use the `/git:cm` workflow to commit changes:
- Review all modified files
- Generate conventional commit message
- Stage and commit changes
- **DO NOT push** (handled in next step)

## 3. Merge to Main

**Safety checks**:
- Verify current branch is not main
- Verify no uncommitted changes
- Confirm main branch exists

**Actions**:
```bash
git checkout main
git pull origin main
git merge [current-branch] --no-ff
```

## 4. Delete Feature Branch

After successful merge:
```bash
git branch -d [feature-branch]
```

## 5. Create Release Tag (if --release flag provided)

**Format**: v{major}.{minor}.{patch}

**Actions**:
```bash
git tag -a [version] -m "Release [version]"
git push origin [version]
```

## 6. Push to Remote

```bash
git push origin main
```

## 7. Monitor CI/CD Pipeline (if applicable)

**Check for**:
- GitHub Actions workflows
- Docker builds
- HACS validation (for HA projects)

**Monitor**:
- Use `gh run list` to check recent workflow runs
- Report status (success/failure/in-progress)
- Wait for completion if builds are running

## 8. Deploy to Production (if --skip-deploy not set)

**Auto-detect deployment method**:
- Docker Compose: `docker-compose pull && docker-compose up -d`
- SSH deployment: Deploy to configured server
- Other: Report deployment instructions

**Only deploy if**:
- All CI/CD checks passed
- No deployment failures detected

## 9. Validate Deployment

**Checks**:
- Service is running
- No critical errors in logs
- Health check passes (if applicable)

## 10. Generate Report

**Summary includes**:
- ✅ Quality checks status
- 📝 Commit hash and message
- 🔀 Merge status
- 🏷️ Release tag (if created)
- 🚀 Deployment status
- ⚠️ Any warnings or issues
- 📊 Test coverage percentage

**Use TodoWrite**: Track progress through all 10 steps.

**Autonomous Execution**: Continue automatically through all steps without confirmation prompts.

**Error Recovery**: If any step fails, attempt automatic recovery (max 3 iterations). Stop and report if unable to recover.

**Safety Features**:
- Confirm before destructive operations
- Verify no uncommitted secrets
- Check current branch before merge
- Backup current state before deployment

**Usage Examples**:
```
User: /test-fix-deploy
User: /test-fix-deploy --skip-deploy
User: /test-fix-deploy --release v2.3.0
User: /test-fix-deploy --release v2.3.0 --skip-deploy
```
