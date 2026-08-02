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
