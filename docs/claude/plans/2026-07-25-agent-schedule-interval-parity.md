# Spec: interval schedule parity for the `agentSchedules` stack

PR #443 added an `"interval"` schedule type ("every N seconds from an anchor
time") to the **sessionSchedules** stack. The parallel **agentSchedules**
stack (scheduled real agent launches — API-only, no UI) still supports only
`one-time` and `recurring`. This task brings it to parity.

The session stack is the reference implementation. Read it first and mirror
its decisions rather than inventing new ones:
- `src/lib/schedule-format.ts` — `calculateNextIntervalRun`,
  `describeIntervalSchedule` (pure, no DB; import directly).
- `src/lib/schedule-validation.ts` — `MIN_INTERVAL_SECONDS` (60),
  `MAX_INTERVAL_SECONDS` (30 days), `isValidIntervalSeconds`,
  `isValidTimezone`.
- `src/services/schedule-service.ts` — `createSchedule` / `updateSchedule`
  three-way type branch, field cleanup on type switch,
  `updateScheduleAfterExecution` re-arm, `persistNextRunAt`.
- `src/services/scheduler-orchestrator.ts` — the interval registration
  sequence (paused construct → resume → re-read `nextRun()` → immediate
  recovery when null) and the `finally` re-arm in `executeJob`.
- `src/services/schedule-service.test.ts` (`describe("interval schedules")`)
  and `src/services/scheduler-orchestrator.test.ts` (the three interval
  tests) — mirror these test patterns.

Semantics are identical to the session stack and must not be re-litigated:
intervals are absolute durations (timezone affects display only, DST never
shifts a fire), the next run is always strictly in the future, missed
occurrences are skipped rather than replayed, and a past anchor is allowed.

## Scope

There is **no UI** for agent schedules (API-only, Beta) — no React/context/
component work in this task. `crates/rdv` has no schedule commands — no CLI
work.

## 1. Schema

`src/db/schema.def.ts`, table `agentSchedules` (sql `agent_schedule`): add two
nullable columns **between `scheduledAt` and `timezone`**, exactly mirroring
`sessionSchedules`:
- `intervalSeconds` (`interval_seconds`, kind `integer`)
- `anchorAt` (`anchor_at`, kind `timestampMs`)

Then run `bun run db:codegen` (a codegen-in-sync test enforces this) and
`bun run db:generate:pg` for the new `drizzle/pg/0013_*.sql` + snapshot +
journal entry. Do NOT hand-edit `schema.sqlite.ts` / `schema.pg.ts` /
`schema.ts`. Do NOT run `bun run db:push` (the human applies it on merge).
This adds columns only, so the 82-table counts in
`src/db/__tests__/schema-parity.test.ts` and `schema-column-diff.test.ts`
stay correct.

## 2. Types — `src/types/agent-run.ts`

`AgentScheduleInput.scheduleType` is currently the inline union
`"recurring" | "one-time"`. Replace it with the shared `ScheduleType` from
`src/types/schedule.ts` (which already includes `"interval"`), and add:
- `intervalSeconds?: number | null`
- `anchorAt?: string | number | Date | null` (match `scheduledAt`'s style)

Update the doc comment accordingly. `AgentScheduleUpdate` derives from this
and needs no separate change. `AgentScheduleRow` is `$inferSelect` and picks
the columns up automatically.

## 3. Service — `src/services/agent-schedule-service.ts`

- Import `isValidIntervalSeconds` / `isValidTimezone` from
  `@/lib/schedule-validation` and `calculateNextIntervalRun` /
  `describeIntervalSchedule` from `@/lib/schedule-format`. **Re-export
  `calculateNextIntervalRun`** the way `schedule-service.ts` does, so the
  orchestrator calls it through the service module and tests can
  `vi.spyOn` it.
- `ValidatedAgentSchedule`: add `intervalSeconds: number | null` and
  `anchorAt: Date | null`.
- `validateAgentScheduleInput`: turn the two-way branch into a three-way one
  (`one-time` / `recurring` / `interval`). The interval arm requires a valid
  `intervalSeconds` (via `isValidIntervalSeconds`, error code
  `INVALID_INTERVAL_SECONDS`) and a parseable `anchorAt` (`ANCHOR_AT_REQUIRED`
  / `INVALID_ANCHOR_AT`), then sets
  `nextRunAt = calculateNextIntervalRun(anchorAt, intervalSeconds)`. Also add
  the timezone validation this function currently lacks (`isValidTimezone` →
  `INVALID_TIMEZONE`) for **all** schedule types, matching the session stack.
  Reject an unknown `scheduleType` explicitly rather than falling through.
- `createAgentSchedule`: persist the two new columns.
- `updateAgentSchedule` is the biggest divergence — today it never writes
  `scheduleType` and never clears the other type's fields. Bring it in line
  with `updateSchedule`: support switching `scheduleType`, validate the
  effective type's fields (falling back to existing row values when the patch
  omits them), recompute `nextRunAt`, and null out the fields belonging to
  the types the row is no longer. Build the update object from an explicit
  whitelist — never spread the raw client patch into the DB write (this was a
  real bug fixed in the session stack: an ISO string reaching a `timestampMs`
  column throws inside drizzle and 500s). Reset a terminal `status`
  (`completed`) to `active` when a type switch re-arms the row, mirroring the
  session behavior. Re-enabling an interval schedule should recompute
  `nextRunAt` in the service (pure computation; don't depend on the
  fire-and-forget notify bridge).
- `markScheduleFired`: add the interval arm — recompute
  `nextRunAt = calculateNextIntervalRun(anchorAt, intervalSeconds, now)` and
  leave the row enabled/active (only `one-time` completes).
- Add a `persistNextRunAt(scheduleId, nextRunAt)` equivalent (mirror
  `schedule-service.ts`) for the orchestrator to call during interval
  registration.

## 4. Orchestrator — `src/services/agent-scheduler-orchestrator.ts`

Mirror the session orchestrator's interval handling. `registerSchedule` is
currently synchronous and must become `async` with an optional
`completedIntervalFireAt` parameter (callers updated accordingly).

- Interval branch: bail with a logged error if `anchorAt`/`intervalSeconds`
  are missing; compute the next fire from
  `max(now, completedIntervalFireAt)`; use the resulting `Date` as the croner
  pattern; persist `nextRunAt` when it differs from the stored value.
- Construct the Cron with `paused: schedule.scheduleType === "interval"`,
  then after storing the job call `resume()` and re-read `nextRun()`. If
  `nextRun()` is null the fire crossed into the past during registration —
  `stop()` the job, log a warn, and recover through the normal execution path
  (`void this.executeJob(...)`), whose `finally` re-arms the chain. Copy the
  session implementation's comments explaining why each step exists; do not
  simplify the sequence away.
- `executeJob`: thread the schedule type through (replacing the implicit
  one-time handling), and in `finally` re-register interval schedules by
  re-reading the row — only if still enabled, still interval, and the
  orchestrator is still running; otherwise remove the job.
- While here, adopt the session orchestrator's safety guards that this file
  lacks and that interval re-registration makes load-bearing: an `isRunning`
  check on entry and again immediately before `new Cron`, and stopping any
  existing job for the same id before overwriting the `jobs` map entry
  (otherwise a leaked live croner instance). Also add the in-flight
  `executing` dedupe if it is cheap to mirror; skip it if it would require
  restructuring beyond the above.
- Status reporting: fall back to the stored `nextRunAt` when
  `cronJob.nextRun()` is null (a consumed one-shot reports null).

## 5. API routes

`src/app/api/agent-schedules/route.ts` (POST) and `[id]/route.ts` (PATCH)
currently delegate all timing validation to the service. Add the same
route-level pre-checks the session routes use, so callers get specific 400s
instead of relying solely on service errors: valid `scheduleType` (one of the
three), `isValidTimezone`, and for interval `isValidIntervalSeconds` +
parseable `anchorAt`. Follow the session routes' error codes exactly
(`INVALID_SCHEDULE_TYPE`, `INVALID_TIMEZONE`, `INVALID_INTERVAL_SECONDS`,
`ANCHOR_AT_REQUIRED`, `INVALID_ANCHOR_AT`). On PATCH, only validate fields
actually present (explicit nulls are allowed where the session PATCH route
allows them) — the route must not be stricter than the service.

## 6. Migration bundle (data fidelity)

Interval agent schedules must survive export/import instead of migrating as
broken cron rows:
- `src/lib/migration-bundle.ts` — `BundleAgentSchedule` type + its zod schema:
  add `intervalSeconds` and `anchorAt`, and widen the `scheduleType` field if
  it is constrained.
- `src/services/migration-export-service.ts` — emit the two new fields
  (`anchorAt` through the same ms-or-null helper used for `scheduledAt`).
- `src/services/migration-import-service.ts` — re-insert them (keeping the
  existing `enabled:false, status:"paused", nextRunAt:null` import posture).
- Update the migration test fixtures if the bundle shape change breaks them.

## 7. Tests

- `src/services/__tests__/agent-schedule-service.test.ts` — add interval
  cases mirroring `schedule-service.test.ts`'s interval describe block:
  valid create computes the anchor-aligned `nextRunAt`; past anchor skips
  forward; `INVALID_INTERVAL_SECONDS` at 59 and 2_592_001; missing/invalid
  anchor; invalid timezone rejected for all three types; type switches clear
  the other types' fields; a cross-type patch (e.g. `anchorAt` sent to a
  recurring row) never persists raw junk; `markScheduleFired` re-arms an
  interval row without completing it; re-enabling recomputes `nextRunAt`.
- **New** `src/services/agent-scheduler-orchestrator.test.ts` (none exists
  today) — mirror `scheduler-orchestrator.test.ts`'s three interval tests:
  stale `nextRunAt` recomputed at startup without one-time catch-up
  semantics; an interval registers as a single fire and re-registers itself
  afterward (assert exactly one job and one launch); and a fire that passes
  during registration is executed and re-armed rather than stalling. Follow
  that file's existing mocking approach (including the hoisted logger mock if
  you need to assert on `log.warn`).

## 8. Docs

- `docs/openapi.yaml` — `AgentScheduleInput` (~3022-3043): widen the
  `scheduleType` enum to include `interval` and add `intervalSeconds` /
  `anchorAt` with descriptions and the 60–2592000 range, matching the wording
  already used for `CreateScheduleInput`.
- `docs/API.md` (~1673-1688) — document the new fields on the agent-schedule
  endpoints.
- `docs/AUTOMATION.md` (§1 and the table row describing agent schedules) —
  note interval support so it no longer reads as cron/one-time only.
- `CHANGELOG.md` — entry under `## [Unreleased]` → `### Added`.

## Quality gates (mandatory)

`bun` only; never disable a lint rule; structured `createLogger` for all
server-side logging; no `console.*` in server code. Before finishing, all of
these must pass: `bun run db:codegen` (no drift), `bun run lint` (0 errors),
`bun run typecheck`, `bun run test:run`. Do not commit — leave the changes in
the working tree.
