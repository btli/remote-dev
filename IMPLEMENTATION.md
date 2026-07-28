# Implementation notes — remote-dev-n4x4.6 / .7 / .8

Branch `feat/claude-accounts-decouple`. Implements `CONTRACT.md` in full.

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
 Test Files  296 passed | 1 skipped (297)
      Tests  2976 passed | 8 skipped (2984)
   Start at  08:02:58
   Duration  23.33s (transform 26.03s, setup 17.21s, import 83.00s, tests 119.72s, environment 33.95s)
```

(Baseline before this change was 297 files / 2992 tests. The deltas are: −2 files
from deleting `claude-login-service.test.ts` and `ClaudeCredentials.test.ts`,
+3 new files, so net +1 file — reported as 297 including the skipped one; and
−16 net tests, the 60 new ones minus the 76 deleted with those two suites.)

### New tests added

| File | Covers |
|---|---|
| `src/services/claude-account-service.test.ts` (45 tests) | identity parsing incl. `loggedIn:false`, malformed/empty/non-object/wrong-type output and banner noise; `probeIdentity` env + non-zero-exit + throwing-runner; `extractSetupToken` / `looksLikeOAuthToken`; account CRUD; **token encrypt/decrypt round-trip** and the assertion that ciphertext ≠ plaintext and the token never appears in an API projection; email dedupe (update-in-place); ownership isolation on every read/write; `buildAccountEnv` incl. the undecryptable-ciphertext degradation |
| `src/services/__tests__/session-env-precedence.test.ts` (8 tests) | **env injection at session launch** — the account token is injected, beats a stale token in profile/folder env, does not beat `RDV_*`, and the account layer never injects `CLAUDE_CONFIG_DIR` (contract fact #3) |
| `src/db/__tests__/backfill-claude-accounts.test.ts` (7 tests) | **the data migration** — an account is created for every claude-capable profile that lacks one, existing accounts are never duplicated or overwritten, non-Claude profiles are ignored, project primaries get linked, and a second run is a no-op |

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
