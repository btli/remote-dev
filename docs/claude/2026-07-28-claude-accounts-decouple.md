# Implementation notes — remote-dev-n4x4.6 / .7 / .8

Branch `feat/claude-accounts-decouple`. Claude accounts decoupled from agent
profiles, `claude setup-token` onboarding, and the dead-Sync-button fix.

**Round 2** — fixes from the adversarial + independent cross-vendor review
passes. See [§6](#6-review-round-2-fixes).

**Round 3** — `CLAUDE_CONFIG_DIR` fixed at the source instead of stripped
downstream. See [§8](#8-round-3--profileisolation-fixed-at-the-source).

---

## 1. What changed and why

### The shape of the change

The old model was **one Claude account == one agent profile**, with
`claude_account.profile_id` `unique NOT NULL` as the identity and the account's
credentials living wherever that profile's `CLAUDE_CONFIG_DIR` pointed. That
forced a choice between "multiple accounts" and "one shared config" — the user's
own skills / `CLAUDE.md` / MCP servers / settings / agents were per-profile, so
running a second account meant running with a different (usually empty) context.

Contract fact #1 dissolves that trade-off: `CLAUDE_CODE_OAUTH_TOKEN` selects the
account **per process**, independently of `CLAUDE_CONFIG_DIR`. So the new model
is: one shared config dir, N standalone account rows, and the session's identity
is a token injected into its env at PTY spawn. No credential swapping, no
locking, no restarts, true parallelism.

Everything below follows from that.

### Schema (`src/db/schema.def.ts` → `bun run db:codegen`)

| Table | Change |
|---|---|
| `claude_account` | `profile_id` → **nullable, non-unique** (origin breadcrumb only, `ON DELETE set null`). Added `alias`, `organization_id`, `auth_method`, `auth_healthy`, `last_verified_at`, `oauth_token_encrypted`. Dropped `credential_mode`. Added `(user_id, email_address)` index for the dedupe lookup. |
| `claude_usage_limit_state` | Primary key `profile_id` → **`account_id`** (FK `claude_account`, cascade). |
| `claude_profile_pool_member` | `profile_id` → **`account_id`** (FK `claude_account`, cascade); indexes renamed to match. |
| `project_profile_link` | Added nullable `account_id` (the project's primary **account**). No DB-level FK — same `db:push` idempotency constraint already documented on `pool_id` in `schema.def.ts`. |
| `terminal_session` | Added `claude_account_id` (FK, `ON DELETE set null`) — which account's token the session launched with. |

`credential_mode` was **removed** rather than made accurate: it only ever
distinguished "file" from "keychain", and with a token always injected neither is
load-bearing (contract fact #3 — the Keychain namespace must never be relied on).
`auth_method` (verbatim from the CLI, treated as an open set) plus `auth_healthy`
carry the real signal now.

### Domain / application

- `LimitState` and `RotationPolicy` re-keyed `profileId` → `accountId`.
- `UsageLimitStateRepository`: `findByAccountId` / `findManyByAccountIds`.
- `ProfilePoolRepository.PoolEntry`: `{ accountId, priority }`.
- `ProfileSelectionPolicy` now returns a `SelectedAccount = { accountId,
  profileId | null }` instead of a bare profile id. **Both** ids matter and they
  are independent: the account decides the injected token, the origin profile
  (when the account has one) still supplies the config dir / env overlay.
- `SelectProfileUseCase` result gains `accountId`.
- `RelaunchOnLimitUseCase` takes `currentAccountId` and relaunches under an
  account; `NotificationPort.relaunch` and `SessionLauncherPort` carry
  `{ accountId, profileId | null }`.

### Infrastructure / services

- **`src/services/claude-account-service.ts` (new)** — the centre of the change.
  Account CRUD, AES-256-GCM token encryption via the existing
  `src/lib/encryption.ts` (the same helper `profile_secrets_config` uses),
  identity via `claude auth status --json`, `setup-token` capture, and
  `buildAccountEnv()` which returns the `{ CLAUDE_CODE_OAUTH_TOKEN }` fragment
  for session launch. The `claude` CLI is behind an injectable `ClaudeCliRunner`
  seam so no test ever invokes the binary or touches the network.
- **`session-service`** resolves the account (explicit pin → pinned profile's
  origin account → selection policy), injects the token into `initialEnv`, and
  records `claude_account_id` on the session row.
- **`terminal.ts`** attributes reactive limit detection to
  `session.claudeAccountId`; `POST /internal/usage-limit` takes `accountId`; the
  `profile_limit_changed` broadcast payload keys on `accountId` (event name
  unchanged for wire compatibility).
- **`usage-poll-sweep`** iterates accounts and records on `accountId`.

### Deleted

`claude-login-service.ts` (+ its test), `GET|POST /api/profiles/:id/claude-login`,
`GET|PATCH /api/profiles/:id/limit-state`, `ClaudeLoginButton.tsx`, and the
now-orphaned `ClaudeCredentials` value object (+ its test — nothing imported it;
`UsageEndpointPoller` parses the file inline).

### API

New: `GET|POST /api/claude-accounts`, `GET|PATCH|DELETE
/api/claude-accounts/:accountId`, `POST /api/claude-accounts/:accountId/verify`,
`GET|PATCH /api/claude-accounts/:accountId/limit-state`,
`POST /api/claude-accounts/setup-session`, `POST /api/claude-accounts/capture`.

Changed: `/api/claude/usage` returns `{ accounts }` (was `{ profiles }`); pool
member routes take `accountId`; `/api/profiles/select` also returns
`claudeAccountId`; `/api/profiles` also returns `claudeAccountId` per profile.

Docs updated: `docs/API.md`, `docs/openapi.yaml` (new `ClaudeAccount` /
`ClaudeAccountSaveResult` schemas), `docs/AGENTS.md`, `CHANGELOG.md`.

### Onboarding (n4x4.7)

`POST /api/claude-accounts/setup-session` creates a real shell session and types
`claude setup-token` into its tmux pane. After the browser sign-in,
`POST /api/claude-accounts/capture` reads the session scrollback, extracts the
`sk-ant-oat…` token with a pure `extractSetupToken()`, stores it encrypted, and
probes identity. `409 TOKEN_NOT_READY` while the sign-in is still in progress.
The paste-a-token fallback is `POST /api/claude-accounts { token, alias? }`.
Both dedupe on the probed email, so re-adding a known account updates in place.
There is no Sync step anywhere.

---

## 2. Gate output (verbatim)

### `bun run lint`

```
✖ 95 problems (0 errors, 95 warnings)
```

All 95 warnings are pre-existing and confined to `.agents/skills/impeccable/scripts/*`:

```
.agents/skills/impeccable/scripts/cleanup-deprecated.mjs
.agents/skills/impeccable/scripts/design-parser.mjs
.agents/skills/impeccable/scripts/detect-csp.mjs
.agents/skills/impeccable/scripts/is-generated.mjs
.agents/skills/impeccable/scripts/live-accept.mjs
.agents/skills/impeccable/scripts/live-browser.js
.agents/skills/impeccable/scripts/live-wrap.mjs
.agents/skills/impeccable/scripts/modern-screenshot.umd.js
.agents/skills/impeccable/scripts/pin.mjs
```

This matches the stated master baseline exactly. Zero warnings in files touched
by this change. No lint rule was disabled and no `@ts-ignore` / `eslint-disable`
was added anywhere.

### `bun run typecheck`

```
$ tsc --noEmit
```

Clean (no output).

### `bun run test:run`

```
 Test Files  297 passed | 1 skipped (298)
      Tests  2996 passed | 8 skipped (3004)
   Start at  08:26:13
   Duration  24.79s (transform 21.67s, setup 18.46s, import 95.88s, tests 125.18s, environment 34.18s)
```

### New tests added

| File | Covers |
|---|---|
| `src/services/claude-account-service.test.ts` (45 tests) | identity parsing incl. `loggedIn:false`, malformed/empty/non-object/wrong-type output and banner noise; `probeIdentity` env + non-zero-exit + throwing-runner; `extractSetupToken` / `looksLikeOAuthToken`; account CRUD; **token encrypt/decrypt round-trip** and the assertion that ciphertext ≠ plaintext and the token never appears in an API projection; email dedupe (update-in-place); ownership isolation on every read/write; `buildAccountEnv` incl. the undecryptable-ciphertext degradation |
| `src/services/__tests__/session-env-precedence.test.ts` (8 tests) | **env injection at session launch** — the account token is injected, beats a stale token in profile/folder env, does not beat `RDV_*`, and the account layer never injects `CLAUDE_CONFIG_DIR` (contract fact #3) |
| `src/db/__tests__/backfill-claude-accounts.test.ts` (7 tests) | **the data migration** — an account is created for every claude-capable profile that lacks one, existing accounts are never duplicated or overwritten, non-Claude profiles are ignored, project primaries get linked, and a second run is a no-op |
| `src/db/__tests__/presync-claude-accounts.test.ts` (8 tests) | **the pre-push step, against REAL temporary SQLite databases** — columns added, re-keyed tables cleared, rows backed up before deletion, indexes dropped, and above all the **idempotence gate**: once migrated it is a complete no-op that does not delete rows or drop indexes, verified across repeated runs |

Existing suites (`LimitState`, `RotationPolicy`, `TrackUsageLimitUseCase`,
`SelectProfileUseCase`, `RelaunchOnLimitUseCase`,
`PriorityProfileSelectionPolicy`, `DrizzleUsageLimitStateRepository`) were
updated to the account keying rather than deleted.

### Pre-existing failure to call out

`src/infrastructure/usage-limit/DrizzleUsageLimitStateRepository.test.ts` fails
with `Error: No such built-in module: node:` **when run in isolation**
(`bun run vitest run <that file>`). It passes inside the full `test:run`. I
confirmed this is pre-existing by stashing all my work and reproducing it on the
unmodified tree. I did not fix it — it is unrelated to this change (the file
lacks a `// @vitest-environment node` pragma, so a solo run picks up the jsdom
default). Left alone deliberately.

---

## 3. Contract items that turned out to be wrong or incomplete

**Nothing in the four verified facts contradicted what I found.** They held up.
Three contract *instructions* needed adjustment:

1. **"Migrate `claude_profile_pool_member` and `claude_usage_limit_state`
   accordingly" is not fully achievable.** Both tables' identity column changed
   from `profile_id` to `account_id`, which forces a table rebuild under SQLite
   `db:push` and a `DROP COLUMN` under the PG migration — the old values are gone
   before any backfill can read them. More fundamentally there is no mechanical
   translation: one profile could map to zero or several accounts. I made the
   loss explicit and bounded rather than pretending otherwise:
   - `claude_usage_limit_state` rows are cleared. They are ephemeral
     observations the reactive detector / poller re-derive within one 5h window,
     so the cost is one window of "unknown" status.
   - `claude_profile_pool_member` rows are cleared. **This is real user
     configuration loss** — pools survive, but their members must be re-added
     once, now as accounts. It is documented in the PG migration header, the
     backfill's module doc, and the CHANGELOG "Migration notes".
   - `claude_account` rows themselves are fully preserved (that is why
     `profile_id` was kept as a nullable breadcrumb instead of dropped).

2. **`db:push` needed a pre-step that the contract does not mention.** Running
   `bun run db:push` on the n4x4.6 schema fails twice over on a pre-existing
   SQLite DB, both times inside drizzle-kit's table-rebuild path (it must rebuild
   `claude_account` because SQLite cannot relax `NOT NULL`/`UNIQUE` in place):
   - `no such column: alias` — the rebuild's `INSERT … SELECT` selects the *new*
     column list from the *old* table.
   - `index claude_usage_limit_user_status_idx already exists` — the rebuild
     re-issues `CREATE INDEX` without dropping the originals. This is the same
     drizzle-kit idempotency bug already documented on `project_profile_link` in
     `schema.def.ts`.

   I added `bun run db:presync-claude-accounts`
   (`scripts/presync-claude-accounts-sqlite.ts`): an idempotent one-time step
   that adds the new columns with plain `ALTER TABLE ADD COLUMN`, drops the
   rebuilt tables' indexes, and clears the two re-keyed tables. With it,
   `db:push` succeeds and is idempotent on a second run ("No changes detected").
   **Order is `db:presync-claude-accounts` → `db:push` →
   `db:backfill-claude-accounts`.** All three were run against the real dev DB
   and verified (`.schema` confirms `account_id` PK / FK and the nullable
   non-unique `profile_id`; the backfill created 2 accounts and linked 1
   project).

3. **`db:generate:pg` cannot run non-interactively.** drizzle-kit prompts
   create-vs-rename for every added column and requires a TTY. I drove it through
   `expect`, answering "create column" for all nine prompts, producing
   `drizzle/pg/0014_unusual_anita_blake.sql`. I then **hand-edited that file**
   (flagged in a header comment): the generated DDL cannot run on a populated PG
   database because it adds a `NOT NULL account_id` to a non-empty table and adds
   a second `PRIMARY KEY` to `claude_usage_limit_state`. The edit prepends the
   two `DELETE FROM`s and a `DROP CONSTRAINT IF EXISTS … _pkey`, matching what
   the SQLite pre-sync does.

---

## 4. Judgment calls where the contract was ambiguous

1. **`profile_id` retained on `claude_account` rather than dropped.** The
   contract says it "must stop being the identity", which it has: nullable,
   non-unique, `ON DELETE set null`, and nothing keys off it. Keeping it as an
   *origin breadcrumb* is what makes the data migration non-destructive for
   accounts, lets a project still pinned to a primary *profile* resolve to an
   account, and lets `/api/profiles` keep serving its `limitState` shim. Every
   read of it is commented as legacy/back-compat. The alternative — dropping it —
   would have deleted every existing account row.

2. **`credentialMode` removed, not corrected.** The contract allowed either. See
   the schema table above for why removal is the honest option.

3. **The selection policy returns *both* ids.** The contract says pools become
   pools of accounts, but a session still needs a config dir and env overlay. If
   `selectForProject` returned only an `accountId`, auto-selected sessions would
   silently lose the profile env overlay they get today. Returning
   `{ accountId, profileId | null }` preserves that behaviour exactly while
   moving rotation onto accounts.

4. **`ProfilePoolRepository` / `PriorityProfileSelectionPolicy` /
   `ProfileSelectionPolicy` kept their file and interface names** even though
   their members are now account-keyed. Renaming eight files would have roughly
   doubled the reviewable diff for zero behavioural change. Every affected doc
   comment states the new semantics explicitly. Flagging it as a legitimate
   follow-up rename if a reviewer disagrees.

5. **The gateway layer (`UsageLimitGateway`, `LimitDetectionResult`) was left
   profile-keyed.** Its two adapters are `anthropic-usage-adapter.ts` (explicitly
   out of scope — PR #445) and `ReactiveOutputDetector.ts` (out of scope —
   n4x4.5). Re-keying the port would have broken both. Translation to accounts
   happens at the sweep boundary instead, and the seam is marked with a
   `TODO(remote-dev-n4x4.4)` in `usage-poll-sweep.ts` and
   `CompositeUsageLimitGateway.ts`.

6. **`UsageEndpointPoller.loadOAuthToken()` was NOT rewired**, per the task
   brief's "leave a TODO referencing n4x4.4 otherwise". My change to that file is
   **comment-only** (a `TODO(remote-dev-n4x4.4)` block on `loadOAuthToken`
   explaining that the path is a macOS no-op and pointing at
   `claude_account.oauth_token_encrypted` as the replacement), so the PR #445
   rebase should be trivial. No behavioural change to that file.

7. **`ProfileContext.getLimitState(profileId)` was kept alongside the new
   `getAccountLimitState(accountId)`.** `src/components/profiles/ProfileSelector.tsx`
   renders a "Limited — resets in Xh" badge on a *profile* in four places; the
   retained accessor resolves `profileId → claudeAccountId` (from the
   `claudeAccountId` field now on `GET /api/profiles`) and then looks up the
   account state, so semantics are correct and it picks up live WS updates.
   `markProfileAvailable` and the pool-member methods were renamed outright.

8. **Token capture reads tmux scrollback** rather than intercepting the PTY
   stream. It is the simplest seam that works with the existing session
   machinery, and the extraction itself (`extractSetupToken`) is a pure,
   unit-tested function. The paste-a-token path exists precisely so users are
   never blocked if capture misses.

9. **`claudeAccountEnv` sits in the server-resolved credential tier, next to
   `ghAccountEnv`**, i.e. above folder/profile env and below `rdvEnv`. Rationale:
   the account the user or the rotation policy selected must beat a stale
   `CLAUDE_CODE_OAUTH_TOKEN` left in folder env, but must not shadow the `RDV_*`
   callback vars. This mirrors how the GitHub token is layered. The whole merge
   was extracted into an exported pure `buildInitialEnv()` so the precedence
   contract is directly testable.

---

## 5. Open questions / pushback for review

1. **Pool membership loss is the one genuinely lossy part of this migration.**
   I chose to make it explicit and documented rather than invent a translation.
   If a reviewer wants best-effort preservation, the only defensible rule is
   "member profile → that profile's origin account, dropping members whose
   profile has no account", and it would have to run *before* `db:push` (a
   separate pre-migration script, since push destroys the column). Say the word
   and I'll add it to the pre-sync step.

2. **`db:presync-claude-accounts` is an extra deploy step.** It is idempotent and
   safe to run always, but it is not currently wired into `scripts/deploy.ts`
   next to `db:backfill-user-emails`. I left deploy wiring out because I could
   not verify the deploy path end-to-end from this worktree. It should probably
   be added before this ships to the homelab.

3. **Migrated accounts have no token.** A credential the CLI put in the macOS
   Keychain cannot be recovered, so every account created by the backfill is
   `authHealthy: false` / `hasToken: false` until the user runs "Add account"
   once per subscription. That is unavoidable, but it does mean the first launch
   after this deploys behaves as it does today (session falls back to whatever
   the shared config dir resolves to) rather than being broken — `buildAccountEnv`
   returns an empty fragment for a token-less account precisely so that stays
   true.

4. **`CONTRACT.md` is committed on the branch.** It was untracked in the worktree
   when I started. It is useful to reviewers, but say so if it should not land on
   `master`.


---

## 6. Review-round-2 fixes

All five blocking findings, both user decisions, and every non-blocking item
were addressed. Nothing was deferred except the one item ruled out of scope.

### F1 — pre-sync was destructive on re-run (BLOCKING)

Correct and serious; both reviewers were right. The column-adds were guarded but
`DELETE FROM claude_usage_limit_state`, `DELETE FROM claude_profile_pool_member`
and the index drops ran unconditionally. Wired into deploy (F6) that would have
wiped pool membership and limit state on **every deploy** and left
`claude_pool_member_pool_account_unique` dropped until the next push.

Fixed with an explicit gate: `isMigrationPending()` looks for the pre-n4x4.6
marker columns (`claude_account.credential_mode`,
`claude_usage_limit_state.profile_id`, `claude_profile_pool_member.profile_id`),
all of which `db:push` drops. Once push has run, the script returns
`{ pending: false, … }` having touched nothing. The false "re-running is a no-op"
comment is replaced by an IDEMPOTENCE section that states exactly what is gated
and why the gate is load-bearing.

To make this *testable* rather than merely asserted, the logic moved to
`src/db/presync-claude-accounts.ts` (matching the existing
`src/db/backfill-user-emails.ts` + `scripts/…` convention) with the libsql client
injected, and `src/db/__tests__/presync-claude-accounts.test.ts` exercises it
against real temporary SQLite files — including a test that seeds post-migration
pool membership and asserts three further runs leave it and the unique index
untouched.

### F2 — sessions still got a per-profile `CLAUDE_CONFIG_DIR` (BLOCKING)

The most important finding: the contract's central goal was not actually met.
`ProfileIsolation.toEnvironment()` sets `CLAUDE_CONFIG_DIR` to
`<profileDir>/.claude`, and session-service applied that overlay to an
auto-selected account's origin profile — so two accounts did **not** share one
config/context, and rotation could land back in a stale profile-specific Claude
context.

Fixed with `applySharedClaudeConfig()` in `session-service.ts`: for Claude
sessions it **deletes** `CLAUDE_CONFIG_DIR` from the profile overlay while
leaving XDG paths, `GIT_CONFIG_GLOBAL`, git identity and `GIT_SSH_COMMAND`
intact. Non-Claude overlays pass through untouched, so `CODEX_HOME` /
`OPENCODE_CONFIG_DIR` isolation is unaffected.

Per verified fact #3 it deletes rather than blanks or re-points: any explicit
value — including `$HOME/.claude` — re-namespaces the macOS Keychain, so the
variable must be genuinely absent. There is a dedicated test for that specific
distinction.

**Second-order fix the finding implied but did not name:** `ensureAgentConfig()`
installed RDV hooks into `profile.configDir`. With `CLAUDE_CONFIG_DIR` now unset,
Claude reads `~/.claude`, so those hooks would have been written somewhere the
agent never looks — silently breaking status reporting. Both the create path and
the resume path now install Claude hooks into `process.env.HOME` and keep the
per-profile dir for other providers. Resume/session discovery already defaulted
to `~/.claude` when the env var is absent (`claude-session-service.getProjectsDir`),
so that path needed no change.

The requested proof is `"two accounts launch with the SAME Claude config dir and
DIFFERENT tokens"` in `session-env-precedence.test.ts`.

### F3 — account not pinnable through the public API + unchecked ownership (BLOCKING)

Both halves were real.

`POST /api/sessions` now accepts `claudeAccountId` (runtime-typechecked). Without
it the notify-mode relaunch CTA could not work end-to-end: the alternate account
usually has `profileId: null`, so `profileId` alone cannot express the choice and
the launch fell back to auto-selection — potentially re-picking the very account
that just hit its limit.

Ownership is now enforced through **one** operation. `buildAccountEnv()` (which
returned `{}` indistinguishably for foreign / token-less / undecryptable
accounts) is replaced by `resolveAccountEnv()` returning a discriminated
`{ ok: true, accountId, env } | { ok: false, reason: "not_found" | "no_token" |
"decrypt_failed" }`. `not_found` deliberately covers both "absent" and "another
user's" so nothing leaks. Resolution moved earlier in `createSession`, before
anything records or launches, and enforces the invariant **`claudeAccountId` is
persisted only when a token was actually produced**:

- **explicit pin** → refuse to launch, `400 CLAUDE_ACCOUNT_UNAVAILABLE` with a
  reason-specific message;
- **auto-selected** → never block the launch, but drop the attribution
  (`effectiveAccountId = undefined`) and warn, so limits are never misattributed
  to an account the session did not use.

The credential is also only injected for actual agent runtimes, so the
`claude setup-token` shell session cannot inherit an unrelated account's token.

### F4 — captured token left in plaintext scrollback (BLOCKING)

Correct. After a successful encrypted save, `capture` now wipes the pane's
scrollback (new `TmuxService.clearHistory`) **and then** closes the session —
clear-history first so even a failed close leaves nothing readable. Both are
best-effort so a teardown hiccup cannot lose an already-saved account, but a
failed close logs at `error` (a live token is still exposed) and the response
carries `sessionClosed` so the UI can warn.

On "make sure scrollback persistence excludes setup-token sessions": I checked
and there is **no** automatic scrollback persistence — `recording-service` is
only ever driven by an explicit `POST /api/recordings`. So the exposure was
purely the live tmux buffer, which closing the session removes. I added a
provenance marker anyway (`CLAUDE_SETUP_SESSION_MARKER` in `typeMetadata`) so any
future persistence feature can exclude these panes.

That marker also closes a hole neither reviewer raised: `capture` previously
accepted **any** session id belonging to the caller, making it a "scrape any of
my terminals for something token-shaped" endpoint. It now returns
`400 NOT_A_SETUP_SESSION` for sessions the Add-account flow did not create.

### F5 — deletes happened before the schema change with no recovery (BLOCKING)

Fixed: `dumpRows()` writes every affected row to
`<data-dir>/migration-backups/claude-accounts-presync-<timestamp>.json`
(mode `0600`) **before** any `DELETE`, with a note explaining what was cleared
and why. Covered by a test asserting the file exists and contains the pre-delete
rows, and by one asserting no file is written when there is nothing to clear.

### F6 — wire into `scripts/deploy.ts` (USER DECISION)

Done, after F1. `db:presync-claude-accounts` runs immediately before `db:push`
(SQLite-only, alongside the existing `db:reconcile-fk-drop` pre-push step) and
**aborts the deploy on failure**, since a failure means push would crash.
`db:backfill-claude-accounts` runs after push next to the other backfills and is
best-effort, *not* deploy-gating: a missing account row degrades to pre-n4x4.6
behaviour, which is not worth failing a deploy over.

**Verification status:** I ran the full sequence against the real dev database
(pre-sync → push → backfill, then re-ran pre-sync and backfill to confirm both
are no-ops, with pool membership and account rows intact). I could **not**
exercise `scripts/deploy.ts` itself — it performs a blue/green slot swap against
a live host. The two steps it invokes are verified; their orchestration inside
`deploy.ts` is code-reviewed only.

### F7 — pool membership loss (USER DECISION)

Accepted; no preservation script written. It is now the first thing under
"Migration notes" in `CHANGELOG.md`, in a `> [!IMPORTANT]` block that states
plainly that **every pool comes out of the upgrade empty**, that pools/names/
assignments survive and only membership must be re-added, what the interim
behaviour is (primary account, no rotation), and where the pre-delete dump lives.

### F8 — working docs in the wrong place (USER DECISION)

`CONTRACT.md` removed from the branch. `IMPLEMENTATION.md` moved to
`docs/claude/2026-07-28-claude-accounts-decouple.md` per the documented
convention. Repo root is clean.

### F9–F13 (non-blocking — all fixed)

- **F9** `scanSessionScrollbackForLimit` now falls back through the session's
  `profileId` to that profile's origin account, so reactive detection is not dead
  for pre-migration sessions. The lookup is owner-scoped, so a session can never
  attribute a limit to another user's account.
- **F10** Added a `token_fingerprint` column (`sha256(token)` truncated to 128
  bits). When the identity probe learns nothing (offline / no CLI) dedupe falls
  back to "same credential ⇒ same account" instead of inserting a row per retry.
  It is non-reversible, scoped per user, and never leaves the server — asserted
  by test. This does **not** fix the concurrent-insert race for the same email;
  see the open questions below.
- **F11** `saveAccountToken` with an unowned/absent `accountId` now throws
  `AccountNotFoundError` (→ `404` from `capture`) instead of silently creating a
  new account in answer to "update X".
- **F12** `token`, `alias`, `accountId`, `sessionId`, `projectId` and
  `profileId` are runtime-typechecked on all four account routes plus
  `claudeAccountId` on `POST /api/sessions`. `{"token": 12}` now returns 400.
- **F13** Every mutation uses a shared `ownedBy(accountId, userId)` predicate, so
  the ownership check is inseparable from the write rather than living only in a
  pre-read.

### F14 — WS payload key change vs. other clients (VERIFY)

Checked `mobile/` (Flutter), `packages/mobile/` (Expo), `crates/` (the `rdv` CLI)
and `electron/`. **Zero** references to `profile_limit_changed`, to the removed
`/api/profiles/:id/limit-state`, or to the removed `claude-login` endpoints —
they are consumed only by the web client, which is updated in this branch and
ships from the same deploy. No compatibility shim is needed and no mobile change
is in scope.

One residual, called out rather than fixed: a **browser tab still running the
pre-deploy JS bundle** is technically an "old client" and would silently drop
every `profile_limit_changed` event until reloaded. That is transient and
self-healing on refresh. I left the event name unchanged rather than renaming it
to `claude_account_limit_changed`, on the grounds that a rename helps nobody who
isn't already reloading — but say the word if you'd rather the break be loud.

### Out of scope, as directed

`claude-account-service.ts` was **not** refactored behind repository ports.
Noted as a legitimate follow-up.

---

## 7. Open questions after round 2

1. **`deploy.ts` orchestration is code-reviewed only** (see F6). The individual
   steps are verified against a real database; the blue/green deploy path is not
   something I can exercise from a worktree.
2. **Concurrent `POST /api/claude-accounts` for the same email still double-
   inserts.** F10's fingerprint fixes the *retry* case, not the *race*: two
   simultaneous requests both read "no existing row" and both insert. The proper
   fix is a partial unique index on `(user_id, email_address) WHERE email_address
   IS NOT NULL`, which SQLite and PG express differently and which drizzle's
   schema-def layer here does not model. Given that adding an account is a
   deliberate, human-paced action, I judged the DB-level constraint not worth the
   dual-dialect complexity in this PR — but it is a real gap, and I'd file it as
   a follow-up rather than leave it undocumented.
3. ~~**`ProfileIsolation` still emits `CLAUDE_CONFIG_DIR`.**~~ **RESOLVED in
   round 3 — and my justification here was wrong on the facts.** See [§8](#8-round-3--profileisolation-fixed-at-the-source).


---

## 8. Round 3 — `ProfileIsolation` fixed at the source

The user overruled my round-2 pushback and was right to: stripping the variable
downstream left the isolation still *produced*, so the next caller of the value
object would silently reintroduce the bug.

### What I found about each consumer

I claimed in round 2 that resume-binding and migration export needed the
profile-scoped value. **I was wrong about both**, and I had not verified either
claim — I inferred them from the old isolation model. Enumerating every consumer:

| Consumer | Uses the VO's value? | Genuinely needs profile-scoped? |
|---|---|---|
| `agent-profile-service.getProfileEnvironment` → session PTY env | yes | **No** — this is the path n4x4.6 exists to fix |
| `application/services/EnvironmentManager` | yes | **No** — same profile-isolation layer, and it is not wired into anything (its only instantiation is its own test) |
| `lib/agent-resume/resume-binding` | reads it from session env | **No** — it captures whatever the session had; with the var gone nothing is captured, and discovery falls back to `~/.claude`, which is where Claude actually wrote |
| `lib/agent-resume/session-id-discovery` | reads it from session env | **No** — `claude-session-service.getProjectsDir(undefined)` already resolves `~/.claude/projects`. It is *more* correct without |
| `services/migration-file-service.agentSettingsDirs` | **no** — reads `process.env.CLAUDE_CONFIG_DIR`, the SERVER's own env | **No, and unaffected**. This was my clearest error: it never touched `ProfileIsolation`. With the server's own value unset it resolves `~/.claude` — exactly the shared config we now want to export |
| `app/api/agent/sessions` (resume picker) | **no — a SECOND producer**, sets `CLAUDE_CONFIG_DIR = profile.configDir` itself | **No — and it was a live bug** (see below) |

So: **no consumer genuinely needs it.** That put the fix on the simple branch —
remove the emission outright, no conditional and no flag.

I verified the resume claim empirically rather than by reading, on this machine:

```
~/.claude/projects                    → 734 project dirs
~/.remote-dev/profiles/9020dcf5…      →   0 project dirs
~/.remote-dev/profiles/a04f4587…      →   2 project dirs
```

Claude writes transcripts to the shared dir. Which surfaced a **live bug the
review had not identified**: `GET /api/agent/sessions` (the resume picker) is a
second, independent producer that set `CLAUDE_CONFIG_DIR = profile.configDir`,
so after n4x4.6 it would have scanned `<profileDir>/.claude/projects` — a
directory Claude never writes to — and returned an **empty resume picker** for
every Claude session. Fixed by excluding Claude from that block, with the reason
stated inline.

### The change

- `ProfileIsolation.toEnvironment()` no longer emits `CLAUDE_CONFIG_DIR` for any
  provider, and there is no option to re-enable it. A header section explains
  why, and an inline comment sits exactly where the emission used to be so the
  next reader does not "fix" its absence.
- `getClaudeConfigDir()` deleted. It became dead, and an unused getter returning
  a profile-scoped Claude path is the same trap one call away.
- `applySharedClaudeConfig()` and its call site deleted — dead once the source
  stopped emitting. Keeping both would have left a reader unable to tell which
  was load-bearing.
- `GET /api/agent/sessions` no longer sets it (above).

### Tests

The "two accounts, same config dir, different tokens" test now builds its
overlay from the **real `ProfileIsolation`** rather than a hand-written fixture,
so it fails if the emission ever comes back — the guarantee is enforced where it
is produced, with no downstream strip to mask a regression. The unset-vs-blank
distinction (verified fact #3) is still asserted explicitly.

Added: `ProfileIsolation` never emits the var for **any** of the six provider
values; the Claude resume path works with the var absent (`profileConfigDir:
undefined`, not `""`) while still honouring an explicit value from a
pre-n4x4.6 session's resume binding; and migration export ships the shared
`~/.claude` (settings, `CLAUDE.md`, skills) when the server's own
`CLAUDE_CONFIG_DIR` is unset — pinning that `agentSettingsDirs()` is independent
of the value object.

Updated: `EnvironmentManager`, `environment-persistence`, and `ProfileIsolation`
suites now assert absence, each with the reason inline.

### Docs

`docs/AGENTS.md` was wrong in **three** places, not one:

1. §1 provider table — "Isolation env var" for `claude` said `CLAUDE_CONFIG_DIR`;
   now "none — shared config" plus a block quote explaining the model and the
   unset-not-`$HOME/.claude` rule.
2. §2 isolation-var table — listed it among the per-provider config roots; now
   names the four that remain and states Claude's absence is deliberate.
3. §4 resume matrix — sourced Claude session ids from
   `$CLAUDE_CONFIG_DIR/.claude/projects/…`; now `~/.claude/projects/…`, noting
   the var is only honoured for pre-n4x4.6 resume bindings.

### Residual, called out

`agent-profile-service` still creates an empty `<profileDir>/.claude` when
scaffolding a profile (`mkdir` at line ~872). It is now vestigial. I left it
alone because removing it changes profile-creation behaviour, which is outside
this task — but it is dead weight and worth a follow-up.
