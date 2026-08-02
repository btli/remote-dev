# Acceptance contract — model-aware Claude usage (`remote-dev-n4x4.2` / `.3` / `.4`)

Working dir: this worktree only. Branch `feat/model-aware-limits`.
Never edit the main checkout at `/Users/bryanli/Projects/btli/remote-dev`.

## Why this exists

A user with several Claude subscriptions hits a **per-model** weekly limit long
before the account itself is exhausted. Today the account still reports
"available" while premium models hard-reject, so rotation never fires and the
user is silently downgraded to the fallback model on an account they chose
*because* it had headroom — while a sibling account with full quota sits idle.

Verified live on 2026-07-28 against a Max account:

```
five_hour  : utilization 61,  status allowed
seven_day  : utilization 98,  status allowed_warning
limits[]   : session       percent 61   severity normal    scope null          is_active false
             weekly_all    percent 98   severity critical  scope null          is_active false
             weekly_scoped percent 100  severity critical  scope model=Fable   is_active true
```

At that moment `claude-haiku-4-5` returned **200** while `claude-sonnet-5`,
`claude-opus-5` and `claude-fable-5` all returned **429**. The account-level
status said `allowed`. Only `limits[]` disclosed the truth.

## What already exists — build on it, do not rebuild

- **Parsing is done.** PR #445 rewrote `src/infrastructure/external/anthropic-usage-adapter.ts`
  to `GET https://api.anthropic.com/api/oauth/usage` and parse the response into
  `ClaudeUsageSnapshot`, which already carries `limits: ClaudeUsageLimitEntry[]`.
  `ClaudeUsageLimitEntry` is `{ kind, group, percent, severity, resetAt, scopeModel, scopeSurface, isActive }`
  with `kind`/`group`/`severity` as **open string sets** that round-trip unknown
  values. **Do not change the adapter's parsing.**
- **Accounts are decoupled from profiles.** PR #446 (`n4x4.6`) made
  `claude_account` standalone; `claude_usage_limit_state` is PK'd on
  `account_id`, and `claude_profile_pool_member` keys on `account_id`.
  Everything here is **account-keyed**, never profile-keyed.
- `scope.model.id` is null upstream, so `scopeModel` (the display name, e.g.
  `"Fable"`) is the only usable per-model identity. Match on it.

## Scope — IN

### `n4x4.2` — persist `limits[]`

`claude_usage_limit_state` has fixed `window_5h_pct` / `window_7d_pct` columns
and cannot represent a variable-length array or any per-model window. Add a
child table keyed `(accountId, kind, scopeModel)` carrying `group`, `percent`,
`severity`, `resetsAt`, `scopeSurface`, `isActive`, plus timestamps.

- Persist the adapter's `limits[]` on every poll, behind a repository port.
- The write must **replace** an account's previous rows, not accumulate them —
  a window that disappears upstream must not linger as stale state.
- **Preserve the existing `claude_usage_limit_state` rollup.** The dashboard,
  `GET /api/claude/usage`, `PriorityProfileSelectionPolicy` and the
  `profile_limit_changed` event all read it. Populate both.
- Schema is CODEGEN'd: edit `src/db/schema.def.ts` ONLY, then `bun run db:codegen`,
  then `bun run db:push` and `bun run db:generate:pg`. Never hand-edit
  `schema.sqlite.ts` / `schema.pg.ts` / `schema.ts` — a `codegen-in-sync` test
  enforces this.

### `n4x4.3` — model-aware selection

`PriorityProfileSelectionPolicy` currently answers *"is this account available?"*.
It must answer *"is this account available **for model M**?"*.

- An account is unavailable for M when a `weekly_scoped` row whose `scopeModel`
  matches M is `critical` (or `percent >= 100`), even while the account-level
  status reads `allowed`.
- Plumb the session's requested model into server-side account resolution at
  session creation. Today only the account is injected.
- **Absent or unknown model must not narrow availability.** If the caller did
  not specify a model, or specifies one with no scoped row, behaviour is exactly
  as it is today. This must never make rotation *more* restrictive by accident.
- Matching is on display name and must be case-insensitive and whitespace-tolerant;
  a model id like `claude-fable-5` should resolve to the `"Fable"` window. Put
  that mapping in ONE place with tests — it is the part most likely to rot.

### `n4x4.4` — enable the poller by default

`RDV_CLAUDE_USAGE_POLL_ENABLED` is default-off because the old adapter burned a
real `/v1/messages` request per poll. The endpoint is now a free GET with no
message send and no quota burn, so that objection is gone. Flip the default on,
keeping the flag as a kill switch. Update `docs/SETUP.md` and `docs/AGENTS.md`,
which still document the poller as experimental/off.

**Verify before flipping:** `UsageEndpointPoller.loadOAuthToken()` historically
read `<configDir>/.claude/.credentials.json`, which does not exist on macOS —
that is why the poller was inert. After `n4x4.6` the token lives in
`claude_account.oauth_token_encrypted`. Confirm the poller reads the account's
decrypted token; a poller enabled by default but still reading a dead path is
worse than one that is honestly off. There is a `TODO(remote-dev-n4x4.4)` in
that file marking the spot.

## Scope — OUT

- The adapter's HTTP call and parsing (`n4x4.1`, shipped).
- `ReactiveOutputDetector` changes (`n4x4.5`).
- Repository-port refactor of `claude-account-service` (`n4x4.9`).
- The duplicate-account race (`n4x4.10`) and vestigial profile scaffolding (`n4x4.11`).
- The `GEMINI_HOME` / `OPENCODE_HOME` / `ANTIGRAVITY_HOME` no-ops (`remote-dev-s4uy`).

## Constraints

- Clean architecture layering: `domain/` → `application/` → `infrastructure/` →
  `interface/`. Persistence behind repository ports; entities immutable.
- Server-side logging via `createLogger` only. **Never** `console.*` in server
  code. Client components may use `console.error`.
- **Never** disable a linter rule or add `@ts-ignore` / `eslint-disable`. Fix the
  root cause.
- `bun` only — never `npm`/`yarn`/`pnpm`.
- OAuth tokens never appear in logs, API responses, or test fixtures.
- Tests must not make live network calls — inject the existing `FetchLike` seam.

## Migration safety — read this

**On the developer's machine, `~/.remote-dev/sqlite.db` is BOTH the dev and the
production database.** A `db:push` here is a live production migration. A
previous change in this epic migrated prod three days early this way and left
production running old code against a new schema, silently breaking limit
detection until it was noticed.

Therefore:
- Adding a NEW table is additive and safe. Do **not** re-key or drop columns on
  any existing table.
- If you believe an existing table must change shape, STOP and say so in your
  report rather than doing it.
- The deploy sequence is `db:presync-claude-accounts` → `db:push` →
  `db:backfill-claude-accounts`, already wired into `scripts/deploy.ts`.

## Gates — all must be green

```bash
bun run lint       # baseline: 0 errors, 95 warnings, all in .agents/skills/impeccable/scripts/*
bun run typecheck
bun run test:run   # baseline on master: 3013 passing
```

New tests required: `limits[]` persistence including unknown `kind`/`severity`
round-trip and stale-row replacement; model-availability decisions for
scoped-critical / scoped-normal / no-scoped-row / no-model-specified; the
model-id→display-name mapping; and the poller reading the account's decrypted
token.

A pre-existing failure unrelated to this change must be called out explicitly,
not silently fixed or silently left. (Known: `codegen-in-sync.test.ts` and
`schema-ready.test.ts` fail with `No such built-in module: node:` when run in
isolation but pass in the full suite — a missing `@vitest-environment node`
pragma, not yours.)

## Definition of done

Gates green, tests added, committed on `feat/model-aware-limits`, and a written
summary of what changed plus anything in this contract that turned out to be
wrong. Do NOT open a PR — review passes run first.
