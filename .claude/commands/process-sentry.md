---
description: "Process and triage Sentry errors from production — fetch, classify, group, fix, resolve, and report. Uses judgment to separate real bugs from operational noise."
allowed-tools: Agent, Bash, Edit, Glob, Grep, Read, Write, Skill, TaskCreate, TaskUpdate, TaskList, AskUserQuestion, WebFetch, SendMessage, EnterPlanMode, ExitPlanMode
user-invocable: true
argument-description: "Optional: 'all' to process all unresolved issues, a specific Sentry issue ID, a short ID (e.g. ASKCV-AI-2), or a priority filter (high, medium). Default: all unresolved."
---

# Process Sentry Errors: $ARGUMENTS

Read the full process-sentry skill at `.claude/skills/process-sentry.md` and follow it step by step.

This is a semi-autonomous workflow. Use AskUserQuestion for ambiguous issues; proceed autonomously for clear bugs and noise.

**Filter**: $ARGUMENTS (if empty, process all unresolved issues)

## Quick Reference

1. **Fetch** — Pull unresolved issues from Sentry API using `SENTRY_USER_PAT`
2. **Inspect** — Get latest event details (stack traces, source context) for each issue
3. **Triage** — Classify: fixable bug, operational noise, stale client, dead code, ambiguous
4. **Group** — Merge related issues by root cause into fix groups
5. **Fix** — For each group, create worktree, implement fix, typecheck, PR, merge
6. **Resolve** — Mark fixed/noise issues as resolved/ignored in Sentry API
7. **Report** — Summary table of all issues processed with actions taken

## Key Rules

- **Never resolve without fixing.** If an issue is a real bug, fix the code first.
- **Downgrade noise, don't ignore it.** Change `captureException` to `captureNonCritical` so trends remain visible.
- **Ask before ignoring.** Use AskUserQuestion to confirm before permanently ignoring any issue.
- **Group related issues.** Same root cause = one fix, not separate PRs.
- **Use worktrees.** All fixes go through the standard branch → PR → review → merge workflow.
