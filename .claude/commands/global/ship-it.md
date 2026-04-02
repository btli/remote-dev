---
description: "Ship it: simplify, review, commit, PR, review again, simplify again, test, update docs, merge to main, build and deploy to production."
---

# Ship It

Execute the following steps in order.

## Step 1: Code Simplifier

Run the code-simplifier agent on the changed files (unstaged diff from main) to clean up code for clarity, consistency, and maintainability while preserving all functionality.

## Step 2: Code Review (Pre-commit)

Run the code-reviewer agent on all changed files. Fix ALL issues found — even low-confidence ones. Re-run typecheck and lint after fixes.

## Step 3: Commit and Push

1. Stage all changes (implementation + simplifier improvements + review fixes)
2. Create a commit with a clear conventional commit message (e.g., `feat: <description>`, `fix: <description>`, `refactor: <description>`)
3. Push the branch to origin

## Step 4: Create Pull Request

Create a PR using `gh pr create` targeting `main`. The PR body should include:
- Summary of changes (what and why)
- Key decisions made
- Test plan

## Step 5: Post-PR Code Review

Run `/code-review:code-review` on the PR. Fix ALL issues found. Commit and push fixes.

## Step 6: Final Simplifier Pass

Run the code-simplifier agent again on all changed files. This catches any complexity introduced by review fixes. Commit and push if changes were made.

## Step 7: Run All Tests

Run the project's full test suite (e.g., `bun run test:run`, `uv run pytest`). ALL tests must pass before proceeding. Fix any failures, commit, and push.

## Step 8: Update Documentation

Check if any changes require documentation updates per the project's CLAUDE.md rules. Common triggers:

- **New feature or route** → update `docs/architecture/STRUCTURE.md`, mark progress in `docs/specs/PHASES.md`
- **Architecture decision** → add ADR entry in `docs/architecture/DECISIONS.md`
- **Schema change** → update schema JSDoc + relevant docs
- **New dependency** → update `CLAUDE.md` Tech Stack table if major
- **Convention or rule change** → update `CLAUDE.md`
- **CHANGELOG.md** → add entry under `[Unreleased]` if not already present

If no docs need updating, skip this step. Do not create documentation files that aren't needed. Commit and push if changes were made.

## Step 9: Merge to Main

Only proceed once ALL of the following are true:
- All code review issues from Step 5 are resolved
- Final simplifier pass is clean
- All tests pass
- Documentation is up to date

1. Merge the PR using `gh pr merge --merge --delete-branch`
2. Pull latest main in the main worktree if applicable

## Step 10: Deploy to Production

After merging to main, deploy following the project's deployment instructions.

1. Read `DEPLOY.md` in the project root for project-specific deploy steps
2. If `DEPLOY.md` does not exist, create one by analyzing the project:
   - Check for CI/CD config (`.github/workflows/`, `vercel.json`, `Dockerfile`, etc.)
   - Check `CLAUDE.md` and `package.json` for deploy hints
   - Ask the user how this project deploys if unclear
   - Write `DEPLOY.md` with the discovered steps
3. Execute the deploy steps from `DEPLOY.md`
4. Verify the deployment is live and correct
