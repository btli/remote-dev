# Implementation — `remote-dev-n4x4.2` / `.3` / `.4`

Branch `feat/model-aware-limits`. All three issues implemented; gates green.

---

## What changed and why

### `n4x4.2` — persist `limits[]`

**`src/db/schema.def.ts`** gains `claudeUsageLimitWindows` → `claude_usage_limit_window`
(83rd table). Purely additive; no existing table was re-keyed or had a column
dropped. Generated files regenerated with `bun run db:codegen`.

Columns mirror `ClaudeUsageLimitEntry` 1:1: `kind`, `limit_group`, `percent`,
`severity`, `resets_at`, `scope_model`, `scope_surface`, `is_active`, keyed on
`account_id` + `user_id` (both cascade). `group` is reserved SQL, hence
`limit_group`.

**Two schema judgment calls, both documented in the def:**

1. **No unique index on `(account_id, kind, scope_model)`** even though the issue
   describes that as the key. `scope_model` is nullable and SQLite/PostgreSQL
   disagree on whether NULLs collide in a unique index, so the constraint would
   mean different things on the two backends. Wholesale replacement (below)
   makes duplicates unreachable anyway. Non-unique indexes on `(account_id)`,
   `(account_id, scope_model)` and `(user_id)` cover the read paths.
2. **A surrogate `id` PK** rather than a composite PK, for the same
   nullable-`scope_model` reason.

**Port** `src/application/ports/UsageLimitWindowRepository.ts` +
**impl** `src/infrastructure/usage-limit/DrizzleUsageLimitWindowRepository.ts`.
`replaceForAccount` is delete-then-insert inside **one transaction**, so a
window that vanishes upstream cannot linger and no reader sees a half-replaced
set. An account with no owner row is a no-op returning `false`, never a throw.

**`TrackUsageLimitUseCase`** takes an optional second constructor arg (the window
repo) and an optional `windows` input. Two deliberate semantics:

- Windows are written **only when the rollup write actually landed** (`wrote`),
  so windows and rollup never describe different moments.
- `windows: undefined` (source has no per-window detail — e.g. a reactive
  scrollback parse) leaves stored windows alone; `windows: []` clears them (the
  endpoint genuinely reported none). A reactive observation must not wipe richer
  data a poll recorded.
- A window-write failure is caught and logged; it never fails an observation the
  rollup already accepted.

The existing `claude_usage_limit_state` rollup is untouched and still written on
every poll.

### `n4x4.3` — model-aware selection

**`src/domain/value-objects/ClaudeModelIdentity.ts`** is the single place the
model-id ↔ display-name mapping lives, per the brief's warning that this is what
rots. Normalization: lowercase → strip `[…]` variant suffixes → collapse
separators to `-` → return the first segment that is a known family token
(`fable`/`mythos`/`opus`/`sonnet`/`haiku`), else the whole normalized string.

Three properties worth calling out:

- It matches families, **not versions**. Pinning `claude-fable-5` would rot on
  every model launch; `fable` will not. `claude-3-5-sonnet-20241022` → `sonnet`
  works because the scan is segment-wise, not suffix-wise.
- Unknown names fall back to exact normalized-string comparison rather than a
  guess, so a future `"Cowork"` scope still matches a `cowork` request and
  nothing else.
- Non-match **fails open** — `claudeModelIdentityMatches` returns `false`
  whenever either side has no identity, and the caller treats `false` as
  "available".

`requestedModelFromAgentFlags` lives here too: there is no dedicated model field
on session creation, so Claude Code's `--model` / `--model=` in the resolved
agent flags *is* the request. Last occurrence wins, matching CLI resolution.

**`PriorityProfileSelectionPolicy`** takes an optional `requestedModel` on both
`selectForProject` and `selectNextAvailable`. When a model is named, it reads the
candidates' windows and substitutes a limited `LimitState` (carrying the blocking
window's `resetsAt`, so the block expires like an account-level limit does) for
any account holding a matching scoped window that is `critical` or ≥100% and not
yet reset. Everything else flows through `RotationPolicy` unchanged, including
the never-block-a-launch best-effort fallback.

**Deviation from the contract, deliberate:** the contract says match a
`weekly_scoped` row. I match **any row with a non-null `scopeModel`**, regardless
of `kind`. Reason: the adapter's own docs declare `kind` an OPEN string set that
round-trips unknown values — so hard-coding today's spelling is precisely the rot
risk the brief warns about. The structural discriminator that actually carries
the meaning is "this window is scoped to one model", i.e. `scopeModel !== null`.
Account-level rows have `scopeModel === null` and are skipped, so this is a
strict superset that can only ever fire on rows that are model-scoped *and*
exhausted. There is a test pinning this (`monthly_scoped` blocks too).

**Fail-open is tested exhaustively** — no model, `null` model, whitespace model,
different model, no stored windows, non-exhausted window, elapsed reset, and
account-level (`scopeModel: null`) window each assert the *unchanged* selection.

**Plumbing:** `ProfileSelectionPolicy` port → `SelectProfileUseCase.execute({
requestedModel })` → `session-service.ts`, which derives the model from
`mergedAgentFlags` (the flags after the profile/preferences merge, i.e. what the
session will actually run with) and logs it alongside the auto-selection.

### `n4x4.4` — poller on by default

**Verified the contract's warning was real and fixed it before flipping.** The
old `loadOAuthToken` read `<profile.configDir>/.claude/.credentials.json`, which
does not exist on macOS. The poller now resolves the **account's** encrypted
`CLAUDE_CODE_OAUTH_TOKEN` via `resolveAccountEnv` (the single ownership-scoped
account→credential operation), injected as a `AccountTokenReader` seam so tests
never import the service and no fixture holds anything token-shaped. The file
read and its `node:fs/promises` / `dynamic-fs` imports are gone.

That required making the **`UsageLimitGateway` port account-keyed**:
`fetchLimitState(target: { accountId, userId, profileId? })`, and
`LimitDetectionResult.profileId` → `.accountId` plus a new `windows[]`.
`ReactiveOutputDetector` takes no arguments and returns null, so it needed no
change (n4x4.5 remains out of scope). `CompositeUsageLimitGateway` now resolves
`accountKind` by `claude_account.id` instead of by `profile_id` — the latter has
been a nullable, non-unique breadcrumb since n4x4.6, so a standalone account
resolved to no row and two accounts from one profile were indistinguishable.

**`usage-poll-sweep.ts` dropped its `isNotNull(claudeAccounts.profileId)`
filter.** That filter silently skipped every account added via "Add account" —
which since n4x4.6 is most of them. This is arguably the single largest
behavioural win in the batch: without it, turning the flag on would still have
polled almost nothing.

**`poll-config.ts`**: default ON. Only an explicit `0`/`false`/`off`/`no`
disables, so a typo'd value fails toward the working behaviour rather than
silently switching the feature off. (The old check was `=== "1"`, which would
have made every existing `RDV_CLAUDE_USAGE_POLL_ENABLED=` line in a `.env` a
silent disable.)

**Docs updated:** `docs/SETUP.md` (env block rewritten — it described the flag as
experimental/off), `docs/AGENTS.md` (limit-detection section + a new
model-aware-rotation paragraph), `docs/API.md`, `docs/ENHANCEMENTS.md`,
`CHANGELOG.md`.

---

## Files changed

| File | Change |
|---|---|
| `src/db/schema.def.ts` | + `claudeUsageLimitWindows` table |
| `src/db/schema.{sqlite,pg}.ts`, `src/db/schema.ts` | codegen output (not hand-edited) |
| `drizzle/pg/0016_mute_quasimodo.sql` + snapshot/journal | PG migration (CREATE TABLE + 2 FKs + 3 indexes only) |
| `src/application/ports/UsageLimitWindowRepository.ts` | **new** port |
| `src/application/ports/UsageLimitGateway.ts` | account-keyed target; `+ windows[]` |
| `src/application/ports/ProfileSelectionPolicy.ts` | `+ requestedModel` |
| `src/application/ports/index.ts` | barrel exports |
| `src/application/use-cases/profile/TrackUsageLimitUseCase.ts` | `+ windows` persistence |
| `src/application/use-cases/profile/SelectProfileUseCase.ts` | `+ requestedModel` |
| `src/domain/value-objects/ClaudeModelIdentity.ts` | **new** + `.test.ts` |
| `src/infrastructure/usage-limit/DrizzleUsageLimitWindowRepository.ts` | **new** + `.test.ts` |
| `src/infrastructure/usage-limit/PriorityProfileSelectionPolicy.ts` | model awareness |
| `src/infrastructure/usage-limit/PriorityProfileSelectionPolicy.test.ts` | + 12 model-aware cases |
| `src/infrastructure/usage-limit/UsageEndpointPoller.ts` | account-keyed + account token |
| `src/infrastructure/usage-limit/UsageEndpointPoller.test.ts` | rewritten for the new seam |
| `src/infrastructure/usage-limit/CompositeUsageLimitGateway.ts` | resolve kind by accountId |
| `src/infrastructure/usage-limit/usage-poll-sweep.ts` | poll all accounts; pass windows |
| `src/infrastructure/usage-limit/poll-config.ts` | default ON |
| `src/infrastructure/container.ts` | wire `usageLimitWindowRepository` |
| `src/services/session-service.ts` | derive + pass `requestedModel` |
| `src/db/__tests__/schema-{parity,column-diff}.test.ts` | table count 82 → 83 |
| `docs/{SETUP,AGENTS,API,ENHANCEMENTS}.md`, `CHANGELOG.md` | docs |

---

## Gate output (verbatim)

```
$ bun run lint
✖ 95 problems (0 errors, 95 warnings)
```

All 95 warnings are in `.agents/skills/impeccable/scripts/*` — the stated
baseline. (Baseline was 95; a transient 96th was a `claudeAccounts` import I left
unused in the sweep, fixed.)

```
$ bun run typecheck
$ tsc --noEmit
```

(no output — clean)

```
$ bun run test:run
 Test Files  299 passed | 1 skipped (300)
      Tests  3052 passed | 8 skipped (3060)
   Duration  25.67s
```

Baseline was 3013 passing; +39 net new (`ClaudeModelIdentity` 16,
`DrizzleUsageLimitWindowRepository` 9, `PriorityProfileSelectionPolicy` 12,
`UsageEndpointPoller` +2 net after rewrite).

**Pre-existing failures:** none. The two failures I *did* hit —
`schema-parity.test.ts` and `schema-column-diff.test.ts` asserting 82 tables —
were caused by this change (the 83rd table) and are legitimately updated, with
the comment ledger extended rather than the number silently bumped. The contract
noted these two files fail with `No such built-in module: node:` when run in
isolation; that did not reproduce here — both pass in the full suite and I did
not add a pragma.

---

## Migration safety

- The PG migration (`drizzle/pg/0016_mute_quasimodo.sql`) is **CREATE TABLE + 2
  FKs + 3 indexes and nothing else** — verified by reading it.
- I did **not** run `bun run db:push` against `~/.remote-dev/sqlite.db`. Running
  drizzle-kit's diff engine against the live production DB risks it proposing
  changes beyond my table if the DB has drifted. Instead I applied the additive
  DDL directly with idempotent `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF
  NOT EXISTS`, hand-matched to the generated SQLite dialect (`timestampMs` →
  `integer`, `boolean` → `integer DEFAULT false`) and to the conventions of the
  sibling `claude_usage_limit_state` DDL already in that database. Verified the
  table did not previously exist and that the resulting schema matches. Zero
  chance of touching an existing table.
- No existing table was re-keyed and no column dropped.

---

## Open questions / pushback

1. **The contract's "match a `weekly_scoped` row" is too narrow.** See the
   deviation above — `kind` is documented as an open set in the very adapter the
   contract cites, so pinning to it is the rot risk the contract is trying to
   avoid. I match on `scopeModel !== null` instead. Flagging it explicitly since
   it is a knowing departure from the letter of the brief.

2. **The port-signature change was unavoidable but is wider than the contract
   implies.** The contract scopes `ReactiveOutputDetector` out (n4x4.5). I did
   not change its logic, but changing `UsageLimitGateway` from
   `(profileId, userId)` to a target object is a port-level change it nominally
   participates in. It happens to take zero arguments, so the diff there is
   literally nothing — but a reviewer should know the port moved.

3. **`RDV_CLAUDE_USAGE_POLL_ENABLED=` (empty) now means ENABLED.** The old check
   was `=== "1"`. Anyone who has that line in a `.env.local` — including the
   example block that shipped in `docs/SETUP.md` with an empty value — flips from
   off to on. That is the intended outcome of n4x4.4, but it is a behaviour change
   triggered by an unchanged config file, not by an explicit opt-in. If you'd
   rather it required a positive value, say so and I'll invert the default check.

4. **The sweep now polls every account on every 10-minute tick, serially.** With
   the profile filter gone that is N HTTP requests per sweep where N was
   previously ~0. The calls are free and best-effort, but there is no concurrency
   cap and no per-account backoff — an account whose token is broken is retried
   every 10 minutes forever (it fails fast at `resolveAccountEnv`, before any
   HTTP). I left it serial and uncapped to keep this diff to the three issues;
   worth a follow-up issue if account counts grow.

5. **`limitedForModel` records the model block in the `"7d"` window slot.**
   `UsageWindow` only knows `5h`/`7d`/`org`, and a scoped window is a weekly one,
   so `7d` is the honest fit. It never reaches the DB (it exists only to make
   `RotationPolicy` skip the candidate), but if `UsageWindow` ever grows a
   `weekly_scoped` duration this should move to it.

6. **`requestedModel` is derived from agent flags only.** If a user sets their
   model inside Claude Code's own settings rather than via `--model`, we never
   see it and selection stays account-level (fail-open). Fixing that would mean
   reading the account's Claude config, which is out of scope here.


---

# Review round 1 — fixes

All eleven findings addressed. Gates re-run and green (see the updated block
below). One override accepted, one recommendation declined with reasons.

## G1 — the feature was a runtime no-op (fixed, and now regression-tested)

Confirmed exactly as described, and it is the most important thing in this diff.
`CompositeUsageLimitGateway.fetchLimitState` dispatched with
`adapters.find(a => a.supports(kind))`. The container registers
`[ReactiveOutputDetector, UsageEndpointPoller]`; the reactive detector's
`supports("subscription")` returns `true` unconditionally while its
`fetchLimitState()` always returns `null` (reactive observations arrive via
`/internal/usage-limit`, not by polling). So every subscription account — the
only kind the poller serves — selected the reactive stub, got null, and the
poller was never invoked.

**Fix:** dispatch now FALLS THROUGH every adapter that supports the kind until
one returns a non-null observation. I chose this over reordering or removing the
reactive adapter because it makes registration order a *preference* rather than
a *veto* — reordering would leave the same landmine for the next adapter added.

**Why no test caught it, and what now does.** Every poller test instantiates
`UsageEndpointPoller` directly; nothing exercised dispatch. Two new suites close
that gap:

- `CompositeUsageLimitGateway.test.ts` — asserts a subscription-kind fetch
  reaches a later adapter, using the REAL `ReactiveOutputDetector` so the test
  stays honest if its `supports()` ever changes. It also pins the precondition
  (reactive supports subscription AND always returns null), so the regression
  test cannot quietly stop proving anything.
- `usage-poll-integration.test.ts` — end-to-end through the container's actual
  adapter ordering with the real poller, stubbing only HTTP, DB, and the
  credential read.

**End-to-end confirmation (requested explicitly).** Verified, not assumed: with
`RDV_CLAUDE_USAGE_POLL_ENABLED=1` the composite reaches the poller, the adapter
call happens, and the result carries the `weekly_scoped` / `"Fable"` window. With
the flag `0` or unset, no request is made and the result is null. That is the
third test in `usage-poll-integration.test.ts`, so it stays verified.

Container docblock updated (G10 likewise — the stale api_key dispatch claim).

## G2 — window-repo failure failed CLOSED (fixed)

Correct and worse than it looked. `findManyByAccountIds` threw → `gatherCandidates`
→ `selectForProject` rejected → session-service caught it and "proceeded without
a profile", so the session launched with **no account and no injected token**, on
ambient credentials — and only for sessions passing `--model`, i.e. exactly the
premium sessions this feature protects. Now wrapped in try/catch returning the
empty map, matching every other early return. Tested with a repository whose
`findManyByAccountIds` throws.

## G3 — stale/null-reset rows could block forever (fixed)

Three changes:

- A blocking row must carry a **valid, future** `resetsAt`. Exhausted-with-null-
  reset is now non-blocking (it would otherwise make `isAvailableNow` treat the
  account as permanently unavailable for that model).
- Added `observed_at` to the table and surfaced it through the port.
- Rows older than `MAX_WINDOW_AGE_MS` (1 hour = 6 sweep intervals) are ignored.
  A row with no `observedAt` is treated as stale.

Six intervals tolerates transient endpoint failures without letting a row that
can only be cleared by a *successful* poll (revoked token, decrypt failure, kill
switch) pin an account off a model.

## G4 — identity could fail CLOSED (fixed with an explicit registry)

`normalizeClaudeModelIdentity` is replaced by `resolveClaudeModelFamily`, which
answers **only** from the exported `KNOWN_FAMILIES` registry and returns `null`
for anything else. A null identity never matches, so an unrecognized model is
never compared against a scoped row.

The `vendor-sonnet-proxy` case needed one extra rule: the mid-string family scan
now requires a `claude-` prefix. So `claude-3-5-sonnet-20241022` still resolves
to `sonnet` while `vendor-sonnet-proxy` and `my-opus-clone` resolve to nothing.
Bare display names and aliases (`"Fable"`, `opus`) match as whole strings.

The accepted cost: a genuinely new family is invisible until added to the
registry. That is the right trade — failing open is today's behaviour, failing
closed is a wrong rotation or an account pinned off a model. The policy logs
`unrecognized requested model` at debug so new families surface in practice.

## G5 — restricted to `weekly_scoped` (override accepted)

Accepted, and on reflection your reasoning is better than mine. My argument was
about *rot*; yours is about *authorization*, and authorization wins. Treating an
unknown future kind as blocking means upstream can silently change this server's
account selection by shipping a new row type — a `daily_scoped` or
`surface_scoped` quota is a different policy being applied to a weekly rotation
decision, which nobody here agreed to. Rot is visible and fixable; an
unauthorized semantic change is neither.

Only `weekly_scoped` blocks (matched case-insensitively, trimmed). Other
exhausted model-scoped kinds are logged at debug and ignored, so we learn about
new kinds without acting on them. The `monthly_scoped` test now asserts it does
**not** block.

Also in this area:
- **`isActive` is no longer ignored.** A blocking row must be flagged active by
  the endpoint. In the live capture the exhausted Fable window carried
  `is_active: true`, so this matches observed reality, and the failure direction
  is under-blocking — the safe one. Exhausted-but-inactive rows are logged.
- **The window slot is no longer hardcoded.** `durationForWindow` maps the row's
  own `group` (`weekly` → `7d`, `session` → `5h`, unknown → `org`).

## G6 — divergence and concurrency (fixed; one deliberate partial)

**Concurrency — fully fixed.** Added a unique index on the logical key. Since
`scope_model` is nullable and SQLite/PostgreSQL disagree on NULL collision in a
unique index, the index keys on a new NOT NULL `scope_model_key` column holding
`scope_model ?? ""` — one portable index for both backends. Plus an `observed_at`
staleness guard read *inside* the replace transaction, so a slow response
finishing last cannot overwrite newer data, and de-duplication on the logical key
before insert so a malformed upstream body cannot fail the whole write.

**Divergence — fixed by ordering, not by a transaction.** I did not make the two
writes a single transaction, and want to be explicit rather than imply otherwise.
They live in separate repositories over a module-level `db`; a genuine cross-repo
unit of work means either leaking a `tx` handle into both ports (a layering smell
this contract cares about) or introducing a unit-of-work port — both larger than
this diff should be.

What I did instead achieves the stated goal: **windows are written first, and a
failure returns `wrote: false` without touching the rollup.** The dangerous state
you named — a fresh rollup saying "available" beside stale windows still saying a
model is critical — is now unreachable, because the rollup is never written when
the window write fails. The residual is the inverse (fresh windows, stale
rollup), which is strictly safer: windows only add blocking for one *named*
model, the G3 reset and staleness checks bound how long that can matter, and the
next poll self-heals it. Flagging it so you can override again if you want the
full unit-of-work.

## G7 — poller is opt-in (user decision, implemented)

Inverted: enabled only on an explicit `1`/`true`/`on`/`yes`; unset, empty, or
unrecognized means OFF. A typo now fails safe rather than silently enabling
outbound traffic.

`docs/SETUP.md`'s bare `RDV_CLAUDE_USAGE_POLL_ENABLED=` line is gone — replaced
with a commented-out `# RDV_CLAUDE_USAGE_POLL_ENABLED=1` and a block explaining
both what it does and why it is opt-in. `docs/AGENTS.md`, `docs/API.md`,
`docs/ENHANCEMENTS.md` and `CHANGELOG.md` updated to match. `poll-config.test.ts`
pins every case including the empty-string one that motivated the change.

## G8 — sweep pacing (user decision, implemented)

- **Bounded concurrency**: at most 4 accounts in flight, via N workers draining a
  shared cursor.
- **Per-account exponential backoff**: 10m → 20m → 40m … capped at 6h. Triggered
  by both a thrown error and a null result (a null is what a revoked token or a
  decrypt failure produces). Any success clears it. Entries for deleted accounts
  are pruned each sweep so the map cannot leak.

State is in-memory deliberately: it is a pacing hint, and a restart erring toward
"try again" is the right failure mode. `resetUsagePollBackoff()` is exported for
tests and for callers that want the next sweep to retry everything.

## G9 — startup log (fixed)

`src/server/index.ts` now calls `isUsagePollEnabled()` instead of re-deriving
`=== "1"`, so the startup log cannot contradict actual behaviour. Two stale
comments in that file updated too.

## G11 — `opusplan` / `default` (considered, declined with reasons)

Declined, and encoded as an explicit `NON_FAMILY_ALIASES` list rather than left
as an accident. Neither names a single family: `opusplan` plans on Opus and
executes on Sonnet, and `default` means "let the CLI decide". Mapping either to
one family would block an account for Opus when the actual work runs on Sonnet —
narrowing availability on a guess, which is the one thing this feature must never
do. They resolve to `null` (fail open) and are tested.

## Note on the false positive

Acknowledged, no action taken — the generated schema files are committed
(`src/db/schema.{sqlite,pg}.ts`, `src/db/schema.ts`) and the `codegen-in-sync`
test passes.

## Schema changes since round 1

`claude_usage_limit_window` gained `scope_model_key` (NOT NULL, default `""`) and
`observed_at`, plus the unique index. The PG migration was regenerated as a
single `drizzle/pg/0016_narrow_nuke.sql` rather than stacking a second migration
on an unmerged branch — still CREATE TABLE + 2 FKs + 4 indexes and nothing else.
SQLite was updated with additive `ALTER TABLE ... ADD COLUMN` + `CREATE UNIQUE
INDEX IF NOT EXISTS`; the table was empty (0 rows), so no backfill was needed and
no existing table was touched.

## Gate output after the fixes (verbatim)

```
$ bun run lint
✖ 95 problems (0 errors, 95 warnings)
```

All 95 in `.agents/skills/impeccable/scripts/*` — the stated baseline.

```
$ bun run typecheck
$ tsc --noEmit
```

(no output — clean)

```
$ bun run test:run
 Test Files  303 passed | 1 skipped (304)
      Tests  3096 passed | 8 skipped (3104)
```

3013 baseline → 3096 (+83). New since round 1: `CompositeUsageLimitGateway`
(8, incl. the G1 regression test), `usage-poll-integration` (3, the end-to-end
check), `usage-poll-sweep` (8, pacing), `poll-config` (5, flag semantics),
`TrackUsageLimitUseCase` (+5, window persistence and write ordering), plus new
cases across the policy, repository, and identity suites.

**Pre-existing failure, now confirmed:** `DrizzleUsageLimitStateRepository.test.ts`
fails in isolation with `No such built-in module: node:` — it lacks the
`@vitest-environment node` pragma its siblings carry. It passes in the full
suite. It is not mine and I have not touched it; the contract predicted this for
two other files, and this is the file it actually affects.
