# Review fixes — agent-schedule interval parity

Fix all 11 items. Gates afterward: `bun run lint` (0 errors),
`bun run typecheck`, `bun run test:run`. Do not commit.

## Major

1. **Old migration bundles can no longer be imported.**
   `src/lib/migration-bundle.ts:602-603` added `intervalSeconds:
   z.number().int().nullable()` and `anchorAt: msTimestamp.nullable()` as
   REQUIRED keys to the `BUNDLE_VERSION = 1` schema. Any bundle exported by
   an older build omits them, so `dbBundleSchema.safeParse` in
   `migration-import-service.ts` (~493-501) fails and the ENTIRE import
   (projects, profiles, secrets, files) is rejected — not just the schedule.
   Fix: make both `.nullable().optional()`, matching the established
   precedent at `migration-bundle.ts:547` (`sourceConfigDir`). Then harden
   the import site `migration-import-service.ts:1019-1021`, which currently
   does `schedule.intervalSeconds` bare and `schedule.anchorAt !== null ?
   new Date(schedule.anchorAt) : null` — with an absent key `undefined !==
   null` is true and `new Date(undefined)` is an Invalid Date writing NaN
   into a timestamp column. Use `?? null` for both. Audit the export side
   too for the same shape assumption.

## Minor

2. **Terminal-status reset misses `"paused"`**, the one stale marker agent
   rows actually carry. `agent-schedule-service.ts:404,408-415` resets only
   `"completed"`; the session original resets
   `["completed","cancelled","missed"]`. Every imported agent schedule is
   written with `status:"paused"` (`migration-import-service.ts:1023`), so
   after a migration a `PATCH {"enabled":true}` re-arms and fires the
   schedule while `status` stays `"paused"` forever. Include `"paused"`
   (plus `"cancelled"`/`"missed"` for symmetry with the session stack) in
   the terminal-status reset set.

3. **Interval pattern computation sits outside the try, and `addJob` has no
   catch.** In `agent-scheduler-orchestrator.ts` the `try` opens at ~:173,
   after the type branch, leaving `calculateNextIntervalRun` (~:144),
   `describeIntervalSchedule` (~:150) and the awaited `persistNextRunAt`
   unguarded; the session original opens its try BEFORE the branch. Move the
   `try` to cover the whole branch (mirroring `scheduler-orchestrator.ts`),
   and wrap `addJob` (~:345-355) in the same try/catch shape the session
   orchestrator uses (`scheduler-orchestrator.ts:528-543`). Failure today: a
   row with a bad timezone (import writes `timezone` unvalidated) makes
   `describeIntervalSchedule` throw a RangeError that escapes to
   `/internal/agent-scheduler/add` as a 500 instead of one logged failure.

4. **Document the two intentional API behavior changes** in `CHANGELOG.md`
   (under `[Unreleased]` → `### Changed`) and `docs/API.md`: (a) `PATCH
   {"cronExpression": null}` no longer clears the cron — an explicit null now
   falls back to the existing value; (b) `timezone: null`/`""` now returns
   400 `INVALID_TIMEZONE` instead of silently falling back to the default.
   If clearing a cron by null was a deliberate supported operation, preserve
   it instead and document that; otherwise document the new behavior.

5. **Cover the three untested type-switch directions** in
   `src/services/__tests__/agent-schedule-service.test.ts`:
   `recurring→one-time`, `one-time→interval` (this one specifically with the
   row already `status:"completed"` from a fired one-time, exercising the
   switched-to-repeating + terminal-status-reset combination), and
   `interval→recurring`. Assert the old type's fields are nulled and
   `nextRunAt` is recomputed.

6. **Restore the migration cron coverage that was replaced, and add an
   old-bundle test.** `migration-export-service.test.ts:264-269` and
   `migration-import-service.test.ts:293-303` swapped the only recurring
   agent-schedule fixture for an interval one, leaving cron export/import
   uncovered. ADD the interval fixture alongside the original recurring one
   rather than replacing it. Also add a test that
   `dbBundleSchema.safeParse` ACCEPTS a bundle whose agentSchedules entries
   omit `intervalSeconds`/`anchorAt` entirely (the item-1 regression), and
   that importing such a bundle writes nulls rather than NaN.

## Nits

7. `getStatus()` in `agent-scheduler-orchestrator.ts` (~:387-409) is dead
   code — nothing calls it. Wire it into `/internal/agent-scheduler/status`
   in `src/server/terminal.ts` (~:2710-2715) so it returns the same shape the
   session scheduler's status endpoint does; that was the intent.

8. Observability parity: add the enabled-transition info log in
   `updateAgentSchedule` (mirror `schedule-service.ts:597-604`) and a
   success log in the agent PATCH route (mirror
   `src/app/api/schedules/[id]/route.ts:107-115`). These schedules launch
   real agents, so a traceless `{enabled:false}` matters more here.

9. `markScheduleFired` (~:479-495): a malformed row (recurring with null
   cron, or interval with null anchor) falls through every arm and keeps its
   stale past `nextRunAt`. Mirror the session's
   `updateScheduleAfterExecution` and fall through to `nextRunAt = null`.

10. `agent-schedule-service.ts:492`: drop the redundant `as ScheduleStatus`
    cast — the field is already typed `ScheduleStatus`.

11. `src/services/agent-scheduler-orchestrator.test.ts`: replace the implicit
    reliance on `vi.restoreAllMocks()` with explicit `.mockRestore()` calls
    on the `calculateNextIntervalRun` / `persistNextRunAt` spies (mirroring
    `scheduler-orchestrator.test.ts:450-451`), so the hidden coupling that
    forces `launchAgentRun.mockResolvedValue` to be re-applied every
    `beforeEach` is no longer load-bearing.
