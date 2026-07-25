# Post-PR fixes — PR #444 (agent-schedule interval parity)

Five small items. Gates afterward: `bun run lint` (0 errors),
`bun run typecheck`, `bun run test:run`. Do not commit.

1. **L2 — close the recurring `nextRunAt` persistence parity gap**
   (`src/services/agent-scheduler-orchestrator.ts`). The session
   orchestrator (`src/services/scheduler-orchestrator.ts:403-418`) persists a
   recomputed `nextRunAt` at registration for **recurring** schedules,
   precisely because a restart can otherwise leave the stored value pointing
   into the past. The agent orchestrator only does this for the interval
   branch (~:159-174). Mirror the session behavior for recurring agent
   schedules, including its explanatory comment. Failure it fixes: server
   down 01:00-03:00 with a `0 2 * * *` schedule → croner correctly arms for
   tomorrow, but `GET /api/agent-schedules` reports a past `next_run_at`
   until the next actual fire. Add a test asserting a stale recurring
   `nextRunAt` is refreshed at registration (mirror the interval equivalent
   in `agent-scheduler-orchestrator.test.ts`).

2. **L1 — make the "paused" terminal-status reset safe under future change**
   (`src/services/agent-schedule-service.ts:405,415`). Including `"paused"`
   in the reset set is safe only because `AgentScheduleUpdate` has no
   `status` field today, so a pause can only come from the migration
   importer. Add an explanatory comment naming that invariant ("`paused` is
   import-only for agent schedules — revisit if a pause API lands, since a
   user-intended pause must survive a re-enable, cf. the session stack which
   deliberately omits it"). Do NOT add an `existing.enabled === false` guard
   — keep the behavior as-is, just document why it diverges from the session
   stack's `["completed","cancelled","missed"]`.

3. **L4 — restore the lost `completed → active` interval re-enable coverage**
   (`src/services/__tests__/agent-schedule-service.test.ts:554,570`). The fix
   commit changed the seeded status from `"completed"` to `"paused"`,
   covering the new path but dropping the old one. Convert that test to an
   `it.each` over `["completed","cancelled","missed","paused"]` so all four
   terminal statuses assert the re-enable recompute.

4. **L3 — make the internal add/update endpoints report registration truth**
   (`src/services/agent-scheduler-orchestrator.ts:355-370` +
   `src/server/terminal.ts:2698-2705`). `addJob`'s catch means
   `/internal/agent-scheduler/add` and `/update` always return
   `{success:true}` even when registration threw. Have `addJob`/`updateJob`
   return a boolean (or the endpoint surface one) so the response is
   `{ success: true, registered: <boolean> }`. Keep the catch — a failed
   registration must still be logged and must not 500 — and keep existing
   callers working (both currently `.catch()` and discard the value).

5. **I3 — correct the inaccurate "before" description in the docs.**
   `CHANGELOG.md` (Unreleased → Changed) and `docs/API.md:1693-1695` claim
   `timezone: null`/`""` previously "fell back to the default timezone" on
   PATCH. That is wrong: master's PATCH wrote the raw value, so `null`
   attempted a NULL write into a NOT NULL column (500) and `""` stored an
   empty string; the default-fallback description belongs to the **create**
   path. Reword both so the "before" is accurate for each path. The
   `cronExpression: null` half of the entry is correct — leave it.
