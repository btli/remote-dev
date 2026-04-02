---
name: systematic-debugging
description: Use when encountering any bug, test failure, unexpected behavior, or production error — before proposing fixes. Enforces a 4-phase root cause investigation instead of patching symptoms. Adapted from obra/superpowers and garrytan/gstack /investigate patterns.
---

# Systematic Debugging

**Iron Law: NO FIXES WITHOUT INVESTIGATION.**

Do not propose, write, or apply a fix until you have identified the root cause through evidence. Patching symptoms creates tech debt and hides the real problem.

## Phase 1: Root Cause Investigation

Trace backward from the error to find where things first went wrong.

1. **Read the full error** — not just the message, the entire stack trace
2. **Identify the failing line** — read the source file at that line
3. **Trace the call chain backward** — who called this function? What data did they pass?
4. **Find the divergence point** — where does actual behavior diverge from expected?
5. **Check recent changes** — `git log --oneline -20 -- <affected-file>` — did a recent commit introduce this?

### Key Questions

- What is the **exact** error message?
- What is the **expected** behavior vs **actual** behavior?
- When did this **start** happening? (Always? After a deploy? After a specific commit?)
- Is it **reproducible** or intermittent?
- What **inputs** trigger it? What inputs don't?

## Phase 2: Pattern Analysis

Before fixing, check if this is a known pattern:

| Pattern | Check |
|---|---|
| Build-time crash | Is a service client (`getDb`, `getAuth`, `getStripe`) called at module scope? Move to per-request. |
| Hydration mismatch | Is `Date.now()`, `Math.random()`, or browser-only API used in SSR? Wrap in `useEffect` or `'use client'`. |
| Stale server action | Did the server action signature change after a deploy? Error boundary with reload. |
| Missing tenant filter | Is a query missing `withTenant(tenantId)`? Check ALL queries in the affected code path. |
| Race condition | Are multiple async operations modifying shared state without locks? |
| Type mismatch | Did an API contract change? Check the Drizzle schema vs the TypeScript types. |
| Env var missing | Is the var in Vercel but not in `.env.local`? Run `vercel env pull`. |

## Phase 3: Hypothesis & Testing

1. **Form a hypothesis** — "The bug is caused by X because Y"
2. **Design a test** — How would you confirm or disprove this hypothesis?
3. **Run the test** — Actually execute it. Read the output.
4. **Evaluate** — Did the evidence support or refute your hypothesis?
5. **If refuted** — Form a new hypothesis. Do NOT force-fit the evidence to your theory.

### Failed Fix Escalation

| Attempt | Action |
|---|---|
| Fix attempt 1 fails | Re-investigate. Your root cause analysis was wrong. |
| Fix attempt 2 fails | Step back further. Read more surrounding code. Check git blame. |
| Fix attempt 3 fails | **STOP.** Question the architecture. The bug may be a design flaw, not a code error. Use `AskUserQuestion` to present your findings and get guidance. |

## Phase 4: Implementation

Only after root cause is confirmed with evidence:

1. **Fix the root cause** — not the symptom
2. **Check for the same bug elsewhere** — `grep` for the same pattern in other files
3. **Verify the fix** — run typecheck, reproduce the original bug, confirm it's gone
4. **Check for regressions** — did the fix break anything else?

## Red Flags — You're Skipping Investigation

| Thought | Reality |
|---|---|
| "I know what this is, let me just fix it" | You're guessing. Investigate first. |
| "It's probably a typo" | Read the code. Confirm it's a typo. Then fix. |
| "Let me just try this..." | Trying without a hypothesis wastes time. Form a theory first. |
| "The error message is clear enough" | Error messages lie. The real bug is often 3 levels up the call chain. |
| "I'll add a null check" | Null checks hide bugs. Find out WHY it's null. |
| "Let me restart the server" | Restarts mask root causes. Investigate first. |
| "The fix is obvious" | Obvious fixes are often wrong. The obvious fix for a null pointer is a null check — but the real fix is ensuring the data is never null. |
| "I've seen this before" | Every bug is unique until proven otherwise. Investigate. |

## Scope Control

During debugging, restrict your changes to the affected module. Do NOT:
- Refactor unrelated code you happen to notice
- "Improve" error handling in files you're reading for context
- Fix lint warnings in files adjacent to the bug
- Update dependencies while investigating

Fix the bug. Only the bug. Ship it. Come back for improvements later.
