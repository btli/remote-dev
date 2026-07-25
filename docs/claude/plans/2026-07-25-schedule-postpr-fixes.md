# Post-PR review fixes for feat/schedule-interval-templates (PR #443)

Fix all 7 items. Gates must pass afterward: `bun run lint` (0 errors),
`bun run typecheck`, `bun run test:run`. Do not commit.

## Major

1. Document the new API surface:
   - `docs/API.md`: update the schedules section (~line 1116-1138) to cover
     `scheduleType: "interval"` with `intervalSeconds` + `anchorAt` (semantics:
     absolute-duration cadence from an anchor; missed occurrences skipped),
     and add a `/api/schedule-templates` section documenting every operation
     the routes actually expose (list, create, get, patch, delete, and the
     use/usage endpoint if present — read the route files for the exact
     surface). Update the header operation/route-group counts by actually
     counting (current header claims 312 operations across 53 route groups;
     recount the delta this PR adds: +1 route group, +N operations).
   - `docs/openapi.yaml`: extend the scheduleType enum (~line 1536) with
     `interval`, add `intervalSeconds`/`anchorAt` to the schedule request/
     response schemas (nullable, with descriptions and the 60–2592000 range),
     and add paths + schemas for `/api/schedule-templates` and
     `/api/schedule-templates/{id}` matching the implemented routes exactly.
   - `CLAUDE.md` project overview mentions "312 operations across 53 route
     groups" and "81 tables" in the subsystem map — update both to match
     (route groups +1, tables +1 → 82, operations to your recount).

## Minor

2. `src/services/scheduler-orchestrator.ts` (~307-361, interval branch of
   registerSchedule): between computing `nextIntervalRun` and constructing
   `new Cron(...)` there are awaited DB writes; if the fire instant slips
   into the past during that window, croner never fires a past Date and
   interval re-registration only happens post-fire → schedule permanently
   stalls while rendering armed. Fix: for interval schedules, after
   constructing the cron job, if `cronJob.nextRun()` is null, treat it as a
   just-missed fire — log a warn and `void this.executeJob(schedule.id,
   tmuxSessionName, "interval")` (the finally-block re-registration then
   re-arms the chain). Add an orchestrator test simulating this (register an
   interval schedule whose computed next run is already past by the time the
   Cron is built — e.g. anchor+interval landing within a few ms — and assert
   it executes and re-arms rather than stalling).

3. Template cron validation only lives in the routes; the service's
   `validateTemplateConfiguration` (src/services/schedule-template-service.ts
   ~68-87) doesn't check cron, and service validation failures throw plain
   `Error` → generic 500 via withApiAuth. Fix: (a) validate recurring
   templates' cronExpression in `validateTemplateConfiguration` (import
   `validateCronExpression` from schedule-service — both are server-side);
   (b) introduce a typed error (e.g. `ScheduleTemplateValidationError` with a
   `code`) thrown by the service validation, and have both template routes
   catch it and return `errorResponse(message, 400, code)` so internal
   callers and route callers get consistent 400-semantics. Keep the existing
   route-level checks (they produce the specific per-field messages).

4. `src/contexts/ScheduleTemplateContext.tsx` (~91) throws a fixed string on
   any non-OK response, so SaveScheduleTemplateDialog always shows "Failed to
   save schedule template" even when the server returned a specific 400
   message. Fix: parse the response body's `error` message (guard JSON parse
   failures) and throw that when present, falling back to the generic
   message. Apply the same treatment to the other mutating fetches in that
   context (update/delete) if they share the pattern.

## Nits

5. `src/components/schedule/schedule-form-shared.tsx` (~38-42 splitInterval +
   the number input): API-created intervals not divisible by a unit (e.g. 90s)
   prefill as fractional values ("1.5" minutes) in a `step=1` input, which
   browsers flag as invalid. Keep the exact value (never mutate the stored
   interval on edit-open); set the interval number input's `step` to `"any"`
   so fractional prefills are valid; server-side integer-seconds validation
   is unchanged.

6. `src/components/desktop/DesktopProviders.tsx` (~16-20): the comment claims
   mobile's NewSessionSheet "mirrors that provider stack", but NewSessionSheet
   intentionally omits ScheduleTemplateProvider (nothing there consumes it).
   Correct the comment to state that mobile mounts only Profile + Template
   providers.

7. `src/app/api/schedule-templates/[id]/route.ts`: uses `params!.id`
   non-null assertions; the schedules [id] routes use explicit
   `if (!id) return errorResponse(...)` guards. Align to the explicit-guard
   style (no non-null assertions).
