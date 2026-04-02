---
name: verification-before-completion
description: Use when about to claim work is complete, fixed, or passing — before committing or creating PRs. Requires running verification commands and confirming output before making any success claims. Evidence before assertions, always. Adapted from obra/superpowers.
---

# Verification Before Completion

**Iron Law: NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.**

Before claiming any work is done, fixed, or passing, you MUST:

1. **Run the verification command** (typecheck, lint, test, build, curl, browser check)
2. **Read the actual output** — not a summary, the real output
3. **Only then** state the result

## Banned Language (Without Evidence)

These words are FORBIDDEN in completion claims unless you have run the command and read the output in THIS conversation turn:

| Banned Phrase | Why It's Banned |
|---|---|
| "This should work" | You haven't verified it works |
| "This should fix the issue" | You haven't confirmed the fix |
| "The tests should pass" | You haven't run the tests |
| "This looks correct" | Looking is not running |
| "I believe this resolves" | Belief is not evidence |
| "Probably fixed" | Probability is not verification |
| "Seems to work" | Seeming is not testing |
| "Based on the changes, this will" | Predictions are not results |
| "The build should succeed" | Run `bun run build` and prove it |

## Verification Commands for AskCV

| Claim | Required Verification |
|---|---|
| "Code compiles" | `bun run typecheck` — zero errors |
| "Lint passes" | `bun run lint` — zero warnings |
| "Build succeeds" | `vercel build --prod` — exit code 0 |
| "Tests pass" | `bun run test:run` — all green |
| "Deploy succeeded" | `vercel ls` — shows "Ready" status |
| "Page works" | Browser check or `curl -s -o /dev/null -w '%{http_code}'` — 200 |
| "Bug is fixed" | Reproduce the original bug steps — confirm no longer occurs |
| "Migration applied" | `psql "$DATABASE_URL" -c "SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1;"` |

## The Verification Protocol

```
1. Make the change
2. Run the verification command
3. Read the output (not just exit code — read for warnings, partial failures)
4. If it fails: fix and re-run (max 3 attempts, then escalate)
5. If it passes: state "Verified: [command] passed with [specific output]"
6. Only THEN claim completion
```

## Red Flags — You're Rationalizing

| Thought | Reality |
|---|---|
| "I just changed one line, it's fine" | One-line changes cause production outages. Verify. |
| "Typecheck passed before my change" | Your change may have broken it. Run again. |
| "This is just a style change" | Style changes can break hydration. Verify. |
| "I'll verify after committing" | No. Verify BEFORE committing. Always. |
| "The CI will catch it" | You are the first line of defense. CI is backup. |
| "It's just a documentation change" | Docs can have broken links, wrong paths. Verify they're accurate. |
| "I ran it earlier in this session" | Run it again. State changes between edits. |

## When This Skill Applies

- Before ANY commit message that claims a fix
- Before creating a PR
- Before merging a PR
- Before claiming a deploy succeeded
- Before telling the user "it's done"
- Before marking a task as completed
