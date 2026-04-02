---
name: process-sentry
description: Process and triage Sentry errors from production. Use this skill when the user mentions Sentry errors, production errors, error monitoring, error triage, wants to review unresolved issues, or runs /process-sentry. Covers the full lifecycle — fetching issues from the Sentry API, triaging by root cause, grouping related errors, fixing actionable bugs in worktrees, downgrading noise to warnings, resolving cleared issues, and reporting a summary.
---

# Process Sentry Errors

End-to-end workflow for triaging and resolving Sentry errors from production. Connects to the Sentry API, fetches unresolved issues, classifies them, fixes actionable bugs, and clears resolved issues.

## Prerequisites

The Sentry User PAT (read/write access) is stored in `.env.production.local`:
- `SENTRY_USER_PAT` — User auth token with `project:read`, `event:read`, `project:write` scopes
- `SENTRY_ORG` — Organization slug
- `SENTRY_PROJECT` — Project slug

The build-time `SENTRY_AUTH_TOKEN` (`sntrys_*`) does NOT have read access. Always use `SENTRY_USER_PAT`.

## Step 1: Fetch Unresolved Issues

Pull all unresolved issues sorted by frequency:

```bash
source /Users/bryanli/Projects/askcv.ai/.env.production.local && \
curl -s "https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?limit=50&query=is:unresolved&sort=freq" \
  -H "Authorization: Bearer ${SENTRY_USER_PAT}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for i, issue in enumerate(data):
    meta = issue.get('metadata', {})
    print(f'#{i+1} [{issue[\"shortId\"]}] count={issue[\"count\"]} priority={issue.get(\"priority\",\"?\")}')
    print(f'   Title: {issue[\"title\"][:120]}')
    print(f'   Culprit: {issue[\"culprit\"]}')
    print(f'   First: {issue[\"firstSeen\"][:10]} Last: {issue[\"lastSeen\"][:10]}')
    if meta.get('filename'): print(f'   File: {meta[\"filename\"]}')
    print()
"
```

If no issues are found, report that and stop.

## Step 2: Get Event Details

For each issue, fetch the latest event to get stack traces and source context:

```bash
source /Users/bryanli/Projects/askcv.ai/.env.production.local && \
curl -s "https://sentry.io/api/0/issues/<ISSUE_ID>/events/latest/" \
  -H "Authorization: Bearer ${SENTRY_USER_PAT}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(f'Tags: {json.dumps({t[\"key\"]:t[\"value\"] for t in data.get(\"tags\",[]) if t[\"key\"] in (\"url\",\"browser\",\"runtime\",\"transaction\")}, indent=2)}')
for entry in data.get('entries', []):
    if entry['type'] == 'exception':
        for val in entry['data'].get('values', []):
            print(f'Type: {val.get(\"type\")} Value: {val.get(\"value\",\"\")[:300]}')
            for frame in (val.get('stacktrace',{}).get('frames',[]))[-5:]:
                if frame.get('inApp'):
                    print(f'  -> {frame.get(\"filename\")}:{frame.get(\"lineNo\")} {frame.get(\"function\",\"\")}')
                    if frame.get('context'):
                        for ctx in frame['context']:
                            if ctx[0] == frame.get('lineNo'):
                                print(f'     {ctx[1].strip()[:120]}')
"
```

## Step 3: Triage and Classify

For each issue, read the affected source files and classify into one of these categories:

### Fixable Bug
A real code defect with a clear fix. Examples:
- Parse errors from incorrect data types
- Missing error handling (silent catches, unlogged failures)
- Variable hoisting or scoping bugs
- Hydration mismatches from non-deterministic rendering

**Action**: Proceed to fix in a worktree.

### Operational Noise
Expected failures that are captured at too high a severity level. Examples:
- WebSocket disconnections (codes 1005, 1007)
- Rate limit responses
- Network timeouts on external APIs
- Transient DB connection blips caught by error boundaries

**Action**: Downgrade from `captureException` (error) to `captureNonCritical` (warning). Or resolve in Sentry if already handled.

### Stale Client
Errors from cached old client JS after a deploy. Examples:
- `UnrecognizedActionError` — server action hashes changed
- Module not found errors for deleted files
- Type mismatches from changed API contracts

**Action**: Resolve in Sentry (self-healing after cache expires). If recurring, ensure error boundary handles gracefully.

### Dead Code
Errors from code that is no longer imported/used but remains in the codebase. Examples:
- Errors from deprecated hooks or components
- Sentry captures from unused API integrations

**Action**: Delete the dead code, resolve in Sentry.

### Ambiguous
Root cause is unclear or fix requires design decisions.

**Action**: Use `AskUserQuestion` to present analysis and recommendation to the user.

## Step 4: Group Related Issues

Many Sentry issues share a root cause. Group them before fixing:
- Same source file + same error type = one fix
- Same WebSocket close code from different paths = one severity change
- Same stale-client pattern across routes = one error boundary fix

Present a summary table:

```
| Group | Issues | Root Cause | Action | Fix Location |
|-------|--------|-----------|--------|-------------|
| A     | AI-2   | Stale server action | Error boundary reload | error-page.tsx |
| B     | AI-E,G | Tool response parse | Stringify response | use-gemini-live.ts |
```

## Step 5: Fix in Worktrees

For each fix group, create a worktree and implement. Follow project conventions:

1. Create branch: `fix/<descriptive-name>`
2. Read affected source files first
3. Apply the fix following the error handling patterns:
   - Server files: use `captureNonCritical` from `@/lib/logger`
   - Client files: use `captureNonCritical` from `@/lib/capture`
   - Fire-and-forget promises: `.catch((err) => captureNonCritical("...", err))`
   - Downgrade noise: replace `Sentry.captureException` with `captureNonCritical`
4. Run `bun run typecheck`
5. Commit with `fix:` prefix
6. Push, create PR, merge

For parallel fixes (no file overlap), dispatch multiple worktree agents simultaneously.

## Step 6: Resolve Issues in Sentry

After fixes are merged, resolve the corresponding Sentry issues:

```bash
source /Users/bryanli/Projects/askcv.ai/.env.production.local && \
curl -s -X PUT "https://sentry.io/api/0/issues/<ISSUE_ID>/" \
  -H "Authorization: Bearer ${SENTRY_USER_PAT}" \
  -H "Content-Type: application/json" \
  -d '{"status": "resolved"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'{d.get(\"shortId\",\"?\")} -> {d.get(\"status\",\"?\")}')"
```

For noise that should be ignored permanently:

```bash
curl -s -X PUT "https://sentry.io/api/0/issues/<ISSUE_ID>/" \
  -H "Authorization: Bearer ${SENTRY_USER_PAT}" \
  -H "Content-Type: application/json" \
  -d '{"status": "ignored", "statusDetails": {"ignoreCount": 0}}'
```

## Step 7: Report Summary

Present a final summary:

```
## Sentry Triage Summary — YYYY-MM-DD

| # | Issue | Count | Category | Action Taken |
|---|-------|-------|----------|-------------|
| 1 | ASKCV-AI-XX | N | fixable_bug | Fixed in PR #NNN |
| 2 | ASKCV-AI-YY | N | noise | Downgraded to warning |
| 3 | ASKCV-AI-ZZ | N | stale_client | Resolved (self-healing) |

**Total**: X issues triaged, Y fixed, Z resolved, W ignored
```

## Red Flags — You're Rationalizing

| Thought | Reality |
|---|---|
| "This error is just noise, I'll resolve it without reading the code" | Every error deserves investigation. Noise today can mask a real bug tomorrow. |
| "The count is low, it's not worth fixing" | Low-count errors are often the hardest to reproduce later. Fix them now while you have the stack trace. |
| "I'll add a try/catch to suppress this" | Suppressing errors hides bugs. Fix the root cause or downgrade to `captureNonCritical` with context. |
| "This is a stale client error, just resolve it" | Confirm it's stale by checking the deploy timeline. If the error persists 24h after deploy, it's not stale. |
| "I know what this is without reading the event details" | Read the event. Stack traces contain context you can't guess from the title alone. |
| "I'll batch-resolve all these similar errors" | Group first, then resolve. Similar titles can have different root causes. |
| "The fix is obvious — just add a null check" | Null checks hide bugs. Find out WHY the value is null. |

## Error Handling Patterns Reference

The project uses a structured error handling hierarchy:

| Level | Function | Import | When |
|-------|----------|--------|------|
| Error (alerts) | `logger.error()` | `@/lib/logger` | Application bugs, unexpected failures |
| Warning (visible, no alert) | `captureNonCritical()` | `@/lib/logger` (server) or `@/lib/capture` (client) | Analytics writes, notification failures, operational noise |
| User error (NOT sent to Sentry) | `throw new ValidationError()` | `@/lib/utils/errors` | Input validation, 404s, gating |

Server actions use `authedAction()` wrapper which automatically catches and logs errors via `handleActionError()`.

Fire-and-forget promises must NEVER use empty `.catch(() => {})`. Always use:
```typescript
.catch((err) => captureNonCritical("Description of what failed", err))
```
