# Spec: Interval schedules ("Every N hours, starting from…") + Schedule templates

Two features for the session-schedule subsystem (`sessionSchedules` stack). The
`agentSchedules` stack (API-only, Beta) is **out of scope** — do not modify
`agent-schedule-service.ts`, `agent-scheduler-orchestrator.ts`, or
`api/agent-schedules/**`.

## Feature 1 — Interval recurrence mode

### Problem
Recurring schedules today are cron-only. Cron cannot express "every 5 hours
starting at 09:30" — `0 */5 * * *` is midnight-anchored and fires at
00/05/10/15/20, i.e. uneven gaps and no anchor control.

### Design
Add a third schedule type, `"interval"`, alongside `"one-time"` and
`"recurring"`.

**Schema** (`src/db/schema.def.ts`, table `sessionSchedules`, sql
`session_schedule`, ~line 598): add two nullable columns following the existing
DSL conventions in that file:
- `intervalSeconds` (`interval_seconds`, kind `integer`) — the period; must be
  ≥ 60 when set.
- `anchorAt` (`anchor_at`, kind `timestampMs`) — absolute timestamp of the
  first occurrence.

After editing `schema.def.ts` you MUST run `bun run db:codegen` (a
codegen-in-sync test fails otherwise) and `bun run db:generate:pg` to produce
the PostgreSQL migration under `drizzle/pg/`. Do NOT edit `schema.sqlite.ts`,
`schema.pg.ts`, or `schema.ts` by hand. Do NOT run `bun run db:push` (it
mutates the live local DB; the human will do that on merge).

**Types** (`src/types/schedule.ts`):
- `ScheduleType = "one-time" | "recurring" | "interval"`.
- Add `intervalSeconds?: number | null` and `anchorAt?: Date | null` (match
  the existing field styles) to `SessionSchedule`, `CreateScheduleInput`,
  `UpdateScheduleInput`.

**Next-run math** (`src/services/schedule-service.ts`): add a pure exported
helper next to `calculateNextRun` (~line 70):

```ts
export function calculateNextIntervalRun(
  anchorAt: Date,
  intervalSeconds: number,
  now: Date = new Date(),
): Date
```

Semantics: if `now < anchorAt` return `anchorAt`; else return
`anchorAt + ceil((now - anchorAt) / intervalMs) * intervalMs`, and if that
lands exactly on `now`, advance one more interval (result must be strictly in
the future). Intervals are absolute durations — timezone affects only display,
never the math, and DST does not shift interval fires. Missed occurrences are
skipped, never replayed (recompute from `now`, don't fire once per missed
tick).

Wire the `"interval"` branch everywhere the code branches on `scheduleType`:
- `createSchedule` (~line 111) and `updateSchedule` (~line 349): require
  `intervalSeconds >= 60` and a valid `anchorAt`; set
  `nextRunAt = calculateNextIntervalRun(...)`. `anchorAt` in the past is
  allowed (the math skips forward).
- `updateScheduleAfterExecution` (~line 881): interval schedules re-arm like
  recurring ones (recompute `nextRunAt`, never mark completed).
- `describeCronExpression` callers / any human-readable description: for
  interval schedules produce e.g. "Every 5 hours from Jul 25, 9:30 AM"
  (use `Intl.DateTimeFormat` with the schedule timezone).

**Orchestrator** (`src/services/scheduler-orchestrator.ts`,
`registerSchedule` ~line 127): croner has no interval pattern, so reuse the
one-time machinery — register a single-fire `Cron` with a `Date` pattern equal
to the computed next run, and after `executeJob` completes for an interval
schedule, re-register the next single-fire job (self-perpetuating). On startup
registration with a stale/past `nextRunAt`, recompute from `now` via
`calculateNextIntervalRun` — do NOT route interval schedules through
`classifyOneTimeRegistration`'s fire-now/mark-missed grace logic, and do NOT
remove the job permanently after a fire the way one-time jobs are removed.
Keep the in-flight dedupe behavior. Make sure `stop()`/cleanup paths handle
the re-registered jobs (no leaked croner instances).

**API** (`src/app/api/schedules/route.ts` POST validation ~lines 44–66 and
`schedules/[id]/route.ts` PATCH): accept `scheduleType: "interval"` with
`intervalSeconds` + `anchorAt`; reject missing/invalid values with the
existing `errorResponse` style (hand-rolled checks, no zod). Keep the
scheduler-client notifications as-is.

**UI** (`src/components/schedule/CreateScheduleModal.tsx` and
`EditScheduleModal.tsx`): extend the One-time/Recurring toggle (~lines
322–343 in Create) with a third mode, label "Interval". Its panel:
- "Every N" number input + unit select (minutes/hours/days; store as
  `intervalSeconds`; enforce min 1 minute, sensible max e.g. 30 days),
  defaulting to hours.
- "Starting from" via the existing `DateTimePicker`
  (`src/components/ui/date-time-picker.tsx`), defaulting to now rounded up to
  the next 5 minutes.
- Extend `getNextRunPreview()` (~lines 250–276) with an interval branch using
  `calculateNextIntervalRun`-equivalent client-side math (it's pure; import it
  if the module is client-safe, otherwise duplicate the 5-line computation
  locally).
Match the existing form styling, state-hook patterns, and save-handler
structure exactly.

## Feature 2 — Schedule templates

Save any schedule configuration (one-time, recurring, or interval) as a named,
reusable template; create new schedules from a template. Clone the existing
session-template pattern end to end.

**Deliberate semantic:** templates never store absolute datetimes. A template
captures `scheduleType`, `cronExpression`, `intervalSeconds`, `timezone`,
retry/timeout knobs, and the command list. `scheduledAt` (one-time) and
`anchorAt` (interval) are chosen fresh each time a template is applied.

**Schema**: new table `scheduleTemplates` (sql `schedule_template`) in
`schema.def.ts`, modeled on `sessionTemplates` (~line 258): `id`, `userId`
(FK → users, cascade), `name` (notNull), `description`, `scheduleType`
(notNull, typeBrand `ScheduleType`), `cronExpression`, `intervalSeconds`,
`timezone` (notNull, same default as `sessionSchedules`), `maxRetries`,
`retryDelaySeconds`, `timeoutSeconds` (same defaults as `sessionSchedules`),
`commandsJson` (`commands_json`, text, notNull) — JSON array of
`{ command, order, delayBeforeSeconds, continueOnError }`, `usageCount`
(default 0), `lastUsedAt`, `createdAt`, `updatedAt`. Indexes: by user, and
`["userId", "usageCount"]` like `sessionTemplates`.

**Types**: new `src/types/schedule-template.ts` — `ScheduleTemplate`,
`CreateScheduleTemplateInput`, `UpdateScheduleTemplateInput`, and a
`ScheduleTemplateCommand` shape for the parsed `commandsJson`.

**Service**: new `src/services/schedule-template-service.ts` following
`template-service.ts` (CRUD scoped by userId + `recordTemplateUsage`
incrementing `usageCount`/`lastUsedAt`). Use `createLogger` — never
`console.*` in server code.

**API**: `src/app/api/schedule-templates/route.ts` (GET list, POST create)
and `schedule-templates/[id]/route.ts` (GET/PATCH/DELETE), following
`api/templates/**` exactly (`withApiAuth`, `parseJsonBody`, `errorResponse`;
enforce ownership on every [id] operation).

**Context**: new `src/contexts/ScheduleTemplateContext.tsx` following
`TemplateContext.tsx`; register the provider where `TemplateContext`'s
provider is registered (check `src/components/desktop/DesktopProviders.tsx`
and any other provider stacks that mount `TemplateProvider` — mirror all of
them).

**UI**:
- "Save as template" button in `CreateScheduleModal` and `EditScheduleModal`
  footers that snapshots the current form into a template via a small
  name/description dialog — model it on
  `src/components/session/SaveTemplateModal.tsx`.
- "Start from template" selector at the top of `CreateScheduleModal` (pattern:
  `src/components/agents/ProfileTemplateSelector.tsx`): picking a template
  prefills type, cron/interval, timezone, retry knobs, and commands; the user
  then picks the datetime/anchor if the type needs one. Call
  `recordTemplateUsage` on use (fire-and-forget).
- Template management (list/rename/delete) inside `SchedulesPanel.tsx` — keep
  it lightweight (a small section or popover listing templates with a delete
  action is enough).

## Quality gates & conventions (mandatory)

- `bun` only, never npm/yarn. Never disable lint rules (`eslint-disable`,
  `@ts-ignore`, etc.) — fix root causes.
- Structured logger (`createLogger`) for all server-side logging.
- Tests (Vitest): extend `src/services/schedule-service.test.ts` (interval
  create/update/validation/re-arm + thorough `calculateNextIntervalRun` unit
  cases: before-anchor, exactly-on-boundary, far-past anchor, missed-run
  skipping) and `src/services/scheduler-orchestrator.test.ts` (interval
  registration, re-registration after fire, stale nextRunAt on startup). Add
  `src/services/schedule-template-service.test.ts` following existing service
  test patterns. Update `src/contexts/__tests__/ScheduleContext.test.tsx`
  only if its reducer/types force it.
- Update `docs/AUTOMATION.md` (interval mode semantics + templates) and add a
  `CHANGELOG.md` entry under `## [Unreleased]` → `### Added`.
- Before finishing, ALL of these must pass: `bun run db:codegen` (then confirm
  no diff in generated files vs your def), `bun run lint`,
  `bun run typecheck`, `bun run test:run`.
- Commit the work on the current branch (`feat/schedule-interval-templates`)
  in logical commits. Do not push.
