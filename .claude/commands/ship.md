---
description: "Ship it: simplify, review, commit, PR, review again, test, verify, merge, build, deploy to production, and canary health check. AskCV-specific with vercel build --prebuilt and deploy lock."
---

# Ship It (AskCV)

Project-specific ship workflow. Executes the full pipeline from code review through production deploy with post-deploy verification. This overrides the global `/global:ship-it` for AskCV.

## Pre-Flight: Readiness Dashboard

Before starting, display the current state:

```
╔══════════════════════════════════════════════════════╗
║                  SHIP READINESS                      ║
╠══════════════════════════════════════════════════════╣
║  Branch:     <current branch>                        ║
║  Ahead of main by: <N> commits                       ║
║  Changed files: <N>                                  ║
║  Typecheck:  [ ] Not run                             ║
║  Lint:       [ ] Not run                             ║
║  Simplifier: [ ] Not run                             ║
║  Review:     [ ] Not run                             ║
║  Tests:      [ ] Not run                             ║
║  Docs:       [ ] Not checked                         ║
╚══════════════════════════════════════════════════════╝
```

Run `git log --oneline main..HEAD` and `git diff --stat main...HEAD` to populate.

## Step 1: Typecheck + Lint

```bash
bun run typecheck && bun run lint
```

Fix any errors. Do not proceed with warnings unresolved. Update the dashboard.

## Step 2: Code Review (Pre-PR)

Run the `pr-review-toolkit:code-reviewer` agent on all changes. **Fix ALL issues found — every severity level, not just high confidence.** Even low-confidence findings should be addressed. Commit fixes. Re-run typecheck + lint after fixes.

When prompting the review agent, do NOT ask it to filter by severity. Ask it to report ALL issues it finds. You fix all of them. The only exception: if a finding is a **false positive** (the reviewer misunderstood the code or the issue doesn't actually exist), you may skip it — but document why it's a false positive in the commit message or inline comment.

## Step 3: Code Simplifier

Run the code-simplifier agent on all changed files (`git diff --name-only main...HEAD`) AFTER fixing review items. This catches complexity introduced by review fixes. Commit any simplifications with `refactor: simplify <description>`.

## Step 4: Commit, Push, Create PR

1. Stage all remaining changes
2. Commit with conventional commit message (`feat:`, `fix:`, `refactor:`)
3. Push branch to origin
4. Create PR: `gh pr create --base main`
5. PR body must include: Summary, Key decisions, Test plan

## Step 5: Post-PR Review

Run `/code-review:code-review` on the PR URL. Fix ALL issues found. Commit and push.

## Step 6: Final Simplifier Pass

Run code-simplifier again. This catches complexity introduced by review fixes. Commit and push if changes.

## Step 7: Run Tests

```bash
bun run test:run 2>/dev/null || echo "No test suite configured — skip"
```

If tests exist, ALL must pass. Fix failures, commit, push.

## Step 8: Verify (Evidence Required)

**You MUST run these commands and read their output before proceeding:**

```bash
bun run typecheck   # Must show zero errors
bun run lint        # Must show zero warnings
```

Do NOT proceed to merge on faith. Run the commands. Read the output. Confirm zero errors.

## Step 9: Update Documentation

Check if any docs need updating per CLAUDE.md rules:
- New feature/route → `docs/architecture/STRUCTURE.md`, `docs/specs/PHASES.md`
- Architecture decision → `docs/architecture/DECISIONS.md`
- New component/utility → `docs/architecture/COMPONENTS.md`
- Convention change → `CLAUDE.md`

Commit and push doc updates if any.

## Step 10: Merge to Main

Confirm ALL of the following are true:
- [ ] All review issues resolved
- [ ] Final simplifier pass clean
- [ ] Tests pass (or no test suite)
- [ ] Typecheck + lint clean (verified in Step 8)
- [ ] Docs up to date

Then:
```bash
touch .merge-ready
gh pr merge --merge --delete-branch
git checkout main && git pull origin main
```

## Step 11: Deploy to Production

Follow DEPLOY.md exactly:

```bash
# 1. Check deploy lock
if [ -f .deploying ]; then
  echo "BLOCKED: Another agent is deploying."
  exit 1
fi
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > .deploying

# 2. Clean stale build artifacts
rm -rf .next .vercel/output

# 3. Build locally
vercel build --prod

# 4. Deploy prebuilt
vercel deploy --prebuilt --prod

# 5. Release lock
rm -f .deploying
```

If `vercel build` fails with Turbopack ENOENT errors, fallback to `vercel deploy --prod` (remote build).

## Step 12: Canary Health Check

After deploy, verify production is healthy:

```bash
# 1. Check deployment status
vercel ls | head -5

# 2. Check key routes respond
for route in "/" "/login" "/signup" "/pricing"; do
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' "https://askcv.ai${route}")
  echo "${route} → ${STATUS}"
done

# 3. Check for new Sentry errors (last 5 minutes)
source .env.production.local 2>/dev/null && \
curl -s "https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?limit=5&query=is:unresolved+firstSeen:-5m&sort=date" \
  -H "Authorization: Bearer ${SENTRY_USER_PAT}" 2>/dev/null | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if data:
        print(f'WARNING: {len(data)} new Sentry issues since deploy!')
        for i in data: print(f'  - [{i[\"shortId\"]}] {i[\"title\"][:80]}')
    else:
        print('No new Sentry errors. Deploy looks clean.')
except: print('Sentry check skipped (no credentials or API error)')
" 2>/dev/null || echo "Sentry check skipped"
```

### Canary Pass Criteria
- All key routes return 200
- No new Sentry errors in the 5 minutes post-deploy
- `vercel ls` shows "Ready" status

### Canary Failure
If any route returns non-200 or new Sentry errors appear:
1. Report the failure with details
2. Use `AskUserQuestion` to ask: rollback or investigate?
3. If rollback: `vercel rollback --prod`

## Ship Complete

Report final status:

```
╔══════════════════════════════════════════════════════╗
║                  SHIP COMPLETE                       ║
╠══════════════════════════════════════════════════════╣
║  PR:         #NNN (merged)                           ║
║  Deploy:     https://askcv.ai                        ║
║  Canary:     PASS / FAIL                             ║
║  Duration:   ~Nm                                     ║
╚══════════════════════════════════════════════════════╝
```
