# Review fixes for feat/schedule-interval-templates

Fix ALL items below. Keep changes minimal and consistent with existing
conventions (structured logger, errorResponse style, no lint suppressions).
After fixing, `bun run lint`, `bun run typecheck`, and `bun run test:run`
must all pass. Do not commit.

## Major

1. `src/services/schedule-service.ts` (~553, `updateSchedule`): `updateData = {...updates}`
   spreads the raw client payload into the DB write, so cross-type PATCHes
   persist junk or crash. Confirmed: `PATCH {"anchorAt": "<ISO string>"}` on a
   recurring schedule passes the route and then drizzle throws
   `value.getTime is not a function` (ISO string hitting a timestampMs
   column) → 500; `{"intervalSeconds":300}` on a recurring schedule silently
   persists junk; `{"cronExpression":"..."}` on an interval schedule persists
   a stale cron. Fix: build `updateData` from an explicit whitelist of
   sanitized fields; type-specific fields (`cronExpression`, `scheduledAt`,
   `intervalSeconds`, `anchorAt`) must only ever be written from the values
   computed by the type branch (or nulled when not applicable to the row's
   effective type) — never copied raw from `updates`.

2. Timezone is never validated for interval (and one-time) schedules:
   `POST {scheduleType:"interval", timezone:"Mars/Olympus"}` returns 201, then
   registration throws inside `Intl.DateTimeFormat`/`new Cron` and is
   swallowed → schedule renders armed forever but never fires. Add a
   `isValidTimezone(tz)` helper (try `Intl.DateTimeFormat(undefined, {timeZone: tz})`
   catch → false) and validate timezone for ALL schedule types in
   `createSchedule`/`updateSchedule`, in `api/schedules` POST + PATCH route
   validation, and in the schedule-template routes/service.

## Minor

3. No server-side upper bound on `intervalSeconds`. Enforce the UI's cap
   (30 days = 2_592_000 s) in the service and both API routes; error code
   `INVALID_INTERVAL_SECONDS`, message mentioning the 1 minute–30 days range.

4. `scheduler-orchestrator.ts`: concurrent `registerSchedule` calls for the
   same schedule id can interleave (`removeJobInternal` → awaits → `new Cron`
   → `jobs.set`) so the second `jobs.set` overwrites the first entry without
   stopping its Cron (leaked live job). Fix minimally: just before
   `this.jobs.set(schedule.id, ...)`, if an entry already exists for that id,
   `stop()` its cronJob first.

5. `updateSchedule` interval branch validates/rewrites interval fields on
   EVERY update, so a corrupt interval row (null anchor) can't even be
   disabled or renamed (`PATCH {enabled:false}` throws). Gate the interval
   validation/recompute on the same style of condition the recurring branch
   uses: only when `updates.intervalSeconds !== undefined || updates.anchorAt
   !== undefined || updates.scheduleType !== undefined` (see also item 11 for
   the re-enable case).

6. Converting a completed one-time schedule to interval/recurring leaves
   `status:"completed"` on an armed schedule that then fires while labeled
   Completed. When a type switch to recurring/interval computes a fresh
   `nextRunAt`, reset a terminal `status` (`completed`/`cancelled`/`missed`)
   to `"active"` (and `enabled` handling consistent with the existing
   one-time re-arm logic).

7. `api/schedules/[id]/route.ts` PATCH is stricter than the service: it 400s
   on `{scheduleType:"interval"}` unless BOTH `intervalSeconds` and
   `anchorAt` are present, but the service correctly falls back to existing
   row values. Relax the route to format-validate only the fields actually
   provided (when present: integer + range check intervalSeconds, parseable
   date anchorAt) and let the service enforce requiredness against the
   existing row (its ScheduleServiceError already maps to a 4xx in this
   route — verify and keep that mapping).

8. Schedule-template input validation: `maxRetries`, `retryDelaySeconds`,
   `timeoutSeconds`, `timezone`, and per-command `order`/`delayBeforeSeconds`/
   `continueOnError` are unvalidated in `api/schedule-templates` POST/PATCH.
   Validate: numerics are non-negative integers with sane caps (mirror the
   schedule routes if they have caps, else maxRetries ≤ 10,
   retryDelaySeconds ≤ 3600, timeoutSeconds ≤ 86400), timezone via
   `isValidTimezone`, commands array entries must be objects with string
   `command`; normalize/derive `order` from array position. Also harden
   `parseCommands` in `schedule-template-service.ts` to filter out
   malformed entries (keep only entries with a string `command`), defaulting
   the optional fields.

9. `SchedulesPanel.tsx` (~509): template deletion is one-click permanent.
   Add an AlertDialog confirmation matching the existing schedule-deletion
   dialog in the same file.

10. `NewSessionSheet.tsx`: `ScheduleTemplateProvider` wraps `NewSessionWizard`
    but nothing in the wizard consumes it. Remove the provider and restore
    the previous comment wording (mentioning only ProfileContext +
    TemplateContext).

11. Re-enabling an interval schedule with a bare `{enabled:true}` never
    recomputes `nextRunAt` in the service (depends on the fire-and-forget
    terminal-server notification). Since the interval computation is pure,
    when an update re-enables an interval schedule also recompute
    `nextRunAt = calculateNextIntervalRun(anchor, interval)`.

12. `CreateScheduleModal.tsx`: `recordUsage(template.id)` fires when a
    template is APPLIED to the form even if the user cancels. Track the
    applied template id in state and call `recordUsage` only after
    `createSchedule` succeeds in the save handler.

## Nits

13. Interval label formatting is duplicated 3× (`describeIntervalSchedule`
    in schedule-service.ts, `formatInterval` in SchedulesPanel.tsx and
    TaskSidebar.tsx) and renders fractional counts for API-created values
    not divisible by a unit ("Every 1.0166666666666667 minutes"). Extract
    ONE shared client-safe helper (e.g. in `src/types/schedule.ts` or a new
    small `src/lib/` module — must not import server-only code) that picks
    the largest evenly-dividing unit or falls back to a rounded compound/
    decimal-free label, and use it from all three sites.

14. `persistNextRunAt` docstring still says "for a recurring schedule" —
    update to cover interval.

15. `scheduler-orchestrator.ts` `getStatus()`: include the schedule type,
    and when `cronJob.nextRun()` is null (single-fire consumed, between
    fire and re-register) fall back to the schedule's stored `nextRunAt`
    instead of reporting "never".

16. `CreateScheduleModal.tsx` save handler: the `else if (anchorDateTime)`
    branch silently closes the modal without creating anything if the guard
    is falsy. Restructure so the interval branch is a plain `else` that
    throws/sets an error if `anchorDateTime` is missing (unreachable
    post-validation, but must not silently drop).

17. Applying an interval template clears the anchor to `undefined`; default
    it to `nextFiveMinuteBoundary()` instead so the form is immediately
    valid while the user can still adjust it.

18. Add missing tests: (a) PATCH type-switch matrix through the service —
    cross-type junk payloads from item 1 (anchorAt on recurring,
    intervalSeconds on recurring, cronExpression on interval) must be
    rejected or nulled, never persisted raw; (b) invalid timezone rejected
    for all three types (create + update); (c) intervalSeconds upper-bound
    rejection; (d) template numeric/command validation rejections;
    (e) corrupt interval row can still be disabled (item 5); (f) re-enable
    recomputes interval nextRunAt (item 11); (g) shared interval-label
    helper formatting incl. non-divisible seconds; (h) type-switch from
    completed one-time resets status (item 6).
