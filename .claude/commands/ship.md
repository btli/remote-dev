---
description: "Ship it: simplify, review, commit, PR, review again, test, verify, merge to master, and confirm production deploy via the auto-deploy webhook. Tailored for remote-dev."
---

# Ship It (remote-dev)

Project-specific ship workflow for `remote-dev`. Executes the full pipeline from code review through production deploy with post-deploy verification. This overrides the global `/global:ship-it`.

Production deploys are triggered automatically by a push to `master` (see `DEPLOY.md`). This command's job is to land a clean PR, merge it, and verify the resulting deploy succeeded.

## Pre-Flight: Readiness Dashboard

Before starting, display the current state:

```
╔══════════════════════════════════════════════════════╗
║                  SHIP READINESS                      ║
╠══════════════════════════════════════════════════════╣
║  Branch:     <current branch>                        ║
║  Ahead of master by: <N> commits                     ║
║  Changed files: <N>                                  ║
║  Typecheck:  [ ] Not run                             ║
║  Lint:       [ ] Not run                             ║
║  Simplifier: [ ] Not run                             ║
║  Review:     [ ] Not run                             ║
║  Tests:      [ ] Not run                             ║
║  Docs:       [ ] Not checked                         ║
╚══════════════════════════════════════════════════════╝
```

Run `git log --oneline master..HEAD` and `git diff --stat master...HEAD` to populate. Refuse to proceed if the current branch is `master` itself — this command operates on a feature branch.

## Step 1: Typecheck + Lint

```bash
bun run typecheck && bun run lint
```

Fix any errors. Do not proceed with warnings unresolved. Update the dashboard.

## Step 2: Code Review (Pre-PR)

Run the `code-reviewer` agent on all changes. **Fix ALL issues found — every severity level, not just high confidence.** Even low-confidence findings should be addressed. Commit fixes. Re-run typecheck + lint after fixes.

When prompting the review agent, do NOT ask it to filter by severity. Ask it to report ALL issues it finds. You fix all of them. The only exception: if a finding is a **false positive** (the reviewer misunderstood the code or the issue doesn't actually exist), you may skip it — but document why it's a false positive in the commit message or inline comment.

## Step 3: Code Simplifier

Run the `code-simplifier` agent on all changed files (`git diff --name-only master...HEAD`) AFTER fixing review items. This catches complexity introduced by review fixes. Commit any simplifications with `refactor: simplify <description>`.

## Step 4: Commit, Push, Create PR

1. Stage all remaining changes
2. Commit with conventional commit message (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`)
3. Push branch to origin
4. Create PR: `gh pr create --base master --repo btli/remote-dev`
5. PR body must include: Summary, Key decisions, Test plan

## Step 5: Post-PR Review

Run `/code-review:code-review` on the PR URL. Fix ALL issues found. Commit and push.

## Step 6: Final Simplifier Pass

Run code-simplifier again. This catches complexity introduced by review fixes. Commit and push if changes.

## Step 7: Run Tests

```bash
bun run test:run
```

ALL tests must pass. Fix failures, commit, push. If no test suite is configured for the changed area, note it explicitly.

## Step 8: Verify (Evidence Required)

**You MUST run these commands and read their output before proceeding:**

```bash
bun run typecheck   # Must show zero errors
bun run lint        # Must show zero warnings
bun run build       # Must succeed (catches Turbopack/Next.js build errors before master)
```

Do NOT proceed to merge on faith. Run the commands. Read the output. Confirm zero errors. Failing the build *after* merging to master will trigger a broken auto-deploy.

## Step 9: Update Documentation & Changelog

Check if any of these need updating:

- New feature, route, table, or service → `CLAUDE.md` (Architecture / API Routes / Database tables sections), `docs/ARCHITECTURE.md`, `docs/API.md`
- New API endpoint → `docs/openapi.yaml`
- Schema change → `src/db/schema.ts` doc comments + relevant docs
- New env var → `docs/SETUP.md` and the `.env` example
- Convention or rule change → `CLAUDE.md`
- **CHANGELOG.md** — add an entry under `[Unreleased]` with the appropriate section (Added / Changed / Deprecated / Removed / Fixed / Security). This is mandatory per `CLAUDE.md`.

Commit and push doc updates if any.

## Step 10: Sync Beads & Close Issues

For any beads issues this PR closes:

```bash
bd close <id> --reason="Shipped in PR #NNN"
bd dolt push
```

If the PR introduces follow-up work, file it now with `bd create` so it isn't lost.

## Step 11: Merge to Master

Confirm ALL of the following are true:
- [ ] All review issues resolved
- [ ] Final simplifier pass clean
- [ ] Tests pass
- [ ] Typecheck + lint + build clean (verified in Step 8)
- [ ] Docs and CHANGELOG up to date
- [ ] Beads issues closed / followups filed

Then:
```bash
gh pr merge --merge --delete-branch --repo btli/remote-dev
git checkout master && git pull origin master
```

Pushing to master triggers `.github/workflows/deploy.yml` automatically — no manual deploy command needed for the standard path.

## Step 12: Verify Auto-Deploy

Follow `DEPLOY.md` § "Verifying a deploy".

```bash
# 1. Watch the deploy workflow
gh run list --repo btli/remote-dev --workflow "Deploy to Production" --limit 5

# 2. Wait for the most recent run on master to complete
gh run watch --repo btli/remote-dev $(gh run list --repo btli/remote-dev --workflow "Deploy to Production" --limit 1 --json databaseId --jq '.[0].databaseId')

# 3. Check current deploy state
bun run deploy:status
```

Expected webhook response in the workflow log: **HTTP 202** ("Deploy triggered successfully").

- **HTTP 409** → another deploy is in progress; wait and recheck.
- **HTTP 401/403** → `DEPLOY_WEBHOOK_SECRET` or Cloudflare Access creds are stale. Stop and report.
- **HTTP 502** → deploy target is offline. Stop and report. Do not retry blindly.
- **Anything else** → fail. Report and stop.

If the auto-deploy didn't fire (e.g. workflow disabled), fall back to:
```bash
gh workflow run "Deploy to Production" --repo btli/remote-dev
# or, with local creds:
bun run deploy
```

## Step 13: Canary Health Check

After the deploy run completes, verify production is healthy:

```bash
# 1. Hit key routes (target host from DEPLOY.md is dev.bryanli.net)
HOST="${RDV_PROD_HOST:-https://dev.bryanli.net}"
for route in "/" "/login" "/api/health"; do
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' "${HOST}${route}")
  echo "${route} → ${STATUS}"
done

# 2. Confirm version / commit hash if the app exposes one
curl -s "${HOST}/api/health" 2>/dev/null | head -c 500
```

### Canary Pass Criteria
- `/` and `/login` return 200 (or 302 to login for `/`)
- `/api/health` returns 200 if it exists, otherwise skip
- Deploy workflow run shows green
- App reports the new commit (compare against `git rev-parse HEAD` on master)

### Canary Failure
If any required route fails or the workflow run is red:
1. Report the failure with the workflow run URL and the failing curl output
2. Use `AskUserQuestion` to ask: rollback or investigate?
3. If rollback:
   ```bash
   bun run deploy:rollback
   ```
4. If investigate, do NOT keep retrying — diagnose first (host up? webhook secret valid? build error in workflow log?).

## Ship Complete

Report final status:

```
╔══════════════════════════════════════════════════════╗
║                  SHIP COMPLETE                       ║
╠══════════════════════════════════════════════════════╣
║  PR:         #NNN (merged to master)                 ║
║  Workflow:   <gh run URL>                            ║
║  Deploy:     https://dev.bryanli.net                 ║
║  Canary:     PASS / FAIL                             ║
║  Beads:      <closed ids>                            ║
║  Duration:   ~Nm                                     ║
╚══════════════════════════════════════════════════════╝
```
