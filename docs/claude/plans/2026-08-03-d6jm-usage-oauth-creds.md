# remote-dev-d6jm — user:profile-scoped OAuth usage credentials per Claude account

**Status:** approved for implementation · **Priority:** P1 · **bd:** `remote-dev-d6jm` (claim it)
**Date:** 2026-08-03 · **Reference model:** claude-swap (github.com/realiti4/claude-swap), confirmed 2026-08-03

## 1. Problem

Settings → Claude Accounts shows "—"/Unknown for every account's 5h/7d usage bars.
Root cause (proven live 2026-08-03, after PR #452 + #455 fixed everything else):

- The usage poller (`runUsagePollSweep` → `UsageEndpointPoller` → `fetchClaudeUsage`)
  reads `GET https://api.anthropic.com/api/oauth/usage` with the account's stored
  `claude setup-token` credential.
- Anthropic returns **403 `permission_error` "OAuth token does not meet scope
  requirement user:profile"** for ALL setup-tokens. They are inference-only, by design.
- A claude.ai-login **access token** (the credential Claude Code itself stores in the
  Keychain) returns **200** with full 5h/7d windows from the same host/IP.

So proactive usage polling is **categorically impossible** with the credential class we
store. The fix — confirmed as exactly what claude-swap does — is to capture and store the
**full OAuth credential set** (access + refresh token, `user:profile` scope) per account,
and refresh it server-side.

## 2. Empirical facts (verified on this machine, 2026-08-03 — do not re-derive)

### 2.1 Credential shape (macOS Keychain, item `claudeAiOauth`)

```jsonc
// security find-generic-password -s "<service>" -a "<os-username>" -w  → JSON:
{
  "mcpOAuth": { /* unrelated, ignore */ },
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-…",   // 108 chars
    "refreshToken": "sk-ant-ort01-…",  // 108 chars
    "expiresAt": 1785793317600,        // epoch MILLISECONDS
    "scopes": ["user:file_upload", "user:inference", "user:mcp_servers",
               "user:profile", "user:sessions:claude_code"],
    "subscriptionType": "max",
    "rateLimitTier": "default_claude_…"
  }
}
```

- **Access tokens are SHORT-LIVED (hours).** The live one observed had ~2.4h remaining.
  ⇒ Access tokens can NEVER be the session-injection credential; server-side refresh is
  mandatory for polling.
- Refresh tokens are long-lived (this is claude-swap's whole operating model).
- Treat `scopes`, `subscriptionType`, `rateLimitTier` as **open sets** (store verbatim).

### 2.2 Keychain service-name derivation (VERIFIED)

- Default config dir → service **`Claude Code-credentials`**, account = OS username.
- Custom `CLAUDE_CONFIG_DIR` → service **`Claude Code-credentials-<first 8 hex of
  sha256(configDirPath)>`**, account = OS username.
  - Verified: sha256(`/Users/bryanli/.remote-dev/profiles/a04f4587-…/.claude`)[:8] =
    `174cb014` matches the live Keychain item `Claude Code-credentials-174cb014`.
  - The hash input is the literal `CLAUDE_CONFIG_DIR` path string (no trailing slash,
    no canonicalization observed). Write a unit test pinning this exact example.
- Linux / headless: credentials live at **`<CLAUDE_CONFIG_DIR>/.credentials.json`**
  (same JSON). Implement both harvest paths behind one interface; pick by
  `process.platform`.

### 2.3 OAuth refresh (documented shape — handle failure gracefully, verify live only in supervised E2E)

- Token endpoint: `POST https://console.anthropic.com/v1/oauth/token`
- Body (JSON): `{ "grant_type": "refresh_token", "refresh_token": "<sk-ant-ort01-…>",
  "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e" }` (Claude Code's public client).
- Success: `{ access_token, refresh_token?, expires_in (seconds), scope? }`. If a
  rotated `refresh_token` is returned, it MUST replace the stored one.
- Failure (`invalid_grant` / 400 / 401): the refresh token is dead → quarantine (§6).
- **NEVER refresh the user's own live Keychain credential during development or tests**
  — rotation could invalidate the user's real Claude Code login. All refresh-path tests
  use an injectable `fetch`. Live verification happens only in the final supervised E2E
  after a real capture (that credential belongs to rdv, not to the user's CLI).

### 2.4 Prior findings that still hold

- `probeTokenValidity` (empty-body `POST /v1/messages`): 401 = invalid, 429 =
  indeterminate, 400/403 = valid-and-authenticated. Unchanged.
- Anthropic anti-brute-force rate-limits repeated requests with invalid credentials
  (429 + retry-after ~3600). ⇒ Never poll usage with a credential known to lack scope.
- Sessions select their account purely via `CLAUDE_CODE_OAUTH_TOKEN` env injection
  (`resolveAccountEnv`); setup-tokens are long-lived and work for inference. Unchanged.

## 3. Design overview — dual-credential accounts

Each `claude_account` can now hold **two independent credentials**:

| Credential | Purpose | Lifetime | Source |
|---|---|---|---|
| `oauth_token_encrypted` (existing) | Session env injection (`CLAUDE_CODE_OAUTH_TOKEN`) | long-lived | `claude setup-token` (existing flow, unchanged) |
| **usage OAuth set (new)** | Usage polling only | access = hours, refresh = long | `claude /login` under a scratch `CLAUDE_CONFIG_DIR` (new flow) |

- **Sessions are completely untouched.** `resolveAccountEnv`, rotation, pools,
  attribution: no behavior change.
- **Usage polling** uses the usage credential, refreshed on demand. Accounts without a
  usage credential are **skipped** by the sweep (no doomed 403s, no brute-force limiter
  exposure) and surface as "usage unavailable — enable usage tracking" in the UI.
- Existing accounts keep working; each gets an **"Enable usage tracking"** action that
  runs the new capture flow and attaches the usage credential to the existing row.

## 4. Schema changes (`src/db/schema.def.ts` — the ONLY file to edit; then codegen)

Add to `claudeAccounts` (table `claude_account`):

```
usageOauthAccessEncrypted   usage_oauth_access_encrypted   text        // AES-256-GCM via @/lib/encryption
usageOauthRefreshEncrypted  usage_oauth_refresh_encrypted  text        // AES-256-GCM
usageOauthExpiresAt         usage_oauth_expires_at         timestampMs // access-token expiry
usageOauthScopes            usage_oauth_scopes             text        // JSON array, stored verbatim
```

Workflow (per CLAUDE.md "Database schema codegen"): edit `schema.def.ts` → `bun run
db:codegen` → `bun run db:push` (SQLite) → `bun run db:generate:pg` (PG migration in
`drizzle/pg/`). The `codegen-in-sync` test will fail if you skip codegen.

**Drift guard note:** all four columns are nullable-additive — safe for the deploy-time
`db:push` + `db:check-drift` path.

API view (`ClaudeAccountSummary` in `src/types/claude-limits.ts` +
`toAccountView`): add `usageCredential: boolean` (true iff
`usageOauthRefreshEncrypted` is non-null). Tokens themselves are NEVER projected.

## 5. Capture flow — "Enable usage tracking"

Mirrors the proven setup-token session flow (`setup-session` + `capture`), as a distinct
mode. New service module: `src/services/claude-usage-credential-service.ts`.

### 5.1 `POST /api/claude-accounts/usage-setup-session`

Body: `{ projectId: string, accountId: string }` (accountId = the account to attach to;
required — the UI always knows which row the user clicked; for brand-new accounts the
Add-account dialog calls this AFTER the setup-token capture created the row).

1. Validate ownership of `accountId` (via the owned-row pattern in
   `claude-account-service`); 404 on foreign.
2. Create a scratch config dir: `~/.remote-dev/claude-oauth/<sessionId>/` (mkdir 700).
   **Pre-seed it to skip onboarding**: write `<scratch>/.claude.json` containing at
   minimum `{"hasCompletedOnboarding": true, "theme": "dark"}` — verify empirically on
   this machine that this lands the CLI directly in the login flow (spike step §10.1);
   adjust the seed if the current CLI wants different keys. If onboarding can't be fully
   suppressed, that's acceptable — the user just answers the prompts; note it in the
   dialog copy instead of blocking.
3. Create a shell session (same shape as `setup-session/route.ts`: `autoLaunchAgent:
   false`, `initialCols: 220, initialRows: 50`) with:
   - env injection `CLAUDE_CONFIG_DIR=<scratch>` (sessions support env via the
     session-create path — follow how `resolveAccountEnv`'s env fragment is merged; if
     shell sessions have no env plumbing, prefix the sent command instead:
     `CLAUDE_CONFIG_DIR=<scratch> claude /login`).
   - `typeMetadata`: `{ rdvClaudeUsageSetupSession: true, accountId, scratchDir }`
     (new marker constant — the capture endpoint refuses sessions without it).
4. Send the login command via `TmuxService.sendKeys` (`claude /login`, or plain
   `claude` + `/login` if the CLI has no direct login arg — spike §10.1 decides; the
   command actually used goes in the response like the existing route does).
5. Response 201: `{ sessionId, command, commandSent, instructions: [...] }` including
   the no-local-browser path (the CLI prints a URL + paste-code flow which works fine
   inside the terminal tab).

### 5.2 `POST /api/claude-accounts/usage-capture`

Body: `{ sessionId: string }`.

1. Ownership + provenance checks exactly like `capture/route.ts` (marker required).
   Read `accountId` + `scratchDir` from `typeMetadata` — never from the request body.
2. **Harvest** the credential set (new `CredentialHarvester` in
   `src/infrastructure/external/claude-credential-harvester.ts`, injectable for tests):
   - macOS: `security find-generic-password -s "Claude Code-credentials-<sha256(scratchDir)[:8]>"
     -a "<os.userInfo().username>" -w` via `execFile` (never a shell string).
   - Linux: read `<scratchDir>/.credentials.json`.
   - Parse `claudeAiOauth`; tolerate absence (login not finished) → 409
     `CREDENTIALS_NOT_READY` ("finish the sign-in, then try again"), session stays open.
3. **Scope gate:** require `user:profile` ∈ scopes → else 409 `MISSING_SCOPE` (should
   not happen for claude.ai logins, but the check is what the whole feature exists for).
4. **Validation probe (burns nothing):** call the existing `fetchClaudeUsage(accessToken,
   "subscription")` — expect `outcome: "snapshot"`. A 403 here → 409 `MISSING_SCOPE`;
   rate-limited/no-data → proceed (indeterminate is not a failure; refresh path will sort
   it out) but log at warn.
5. **Identity match (safety):** run `probeIdentity`-equivalent under the scratch dir
   (`claude auth status --json` with env `CLAUDE_CONFIG_DIR=<scratch>` and the OAuth
   env vars blanked). If it yields an email and the target account has an email and they
   **differ**, reject 409 `ACCOUNT_MISMATCH` ("you signed into a different Claude
   account than this row") — do NOT silently attach. Missing/blank email on either side
   → proceed (probe is best-effort).
6. **Store** on the target row: the four new columns (tokens encrypted via
   `@/lib/encryption`), and opportunistically refresh display fields
   (`rateLimitTier`/`subscriptionType` from the credential, via the existing
   keep-fallback pattern `identityDisplayColumns`).
7. **Cleanup — this transits live credentials, be thorough (all best-effort, all logged
   loudly on failure):**
   - macOS: `security delete-generic-password -s "<derived service>" -a "<user>"`.
   - `rm -rf <scratchDir>` (guard: refuse unless the path is under
     `~/.remote-dev/claude-oauth/`).
   - `TmuxService.clearHistory` then `SessionService.closeSession` (same order and
     rationale as `capture/route.ts`).
   - Immediately trigger one poll for this account (call the sweep's single-account
     path, or simply let the response include the validation snapshot) so the UI shows
     real bars right away.
8. Response: `{ account (view, now usageCredential: true), usageValidated: boolean }`.

### 5.3 Orphan cleanup

A user can abandon the flow. On terminal-server startup (where the poll sweep is
registered), delete `~/.remote-dev/claude-oauth/*` older than 24h AND their derived
Keychain items. Small helper in the new service; log what was removed.

## 6. Refresh service — `src/infrastructure/external/anthropic-oauth-refresh.ts`

```ts
getFreshUsageAccessToken(accountId, userId): Promise<string | null>
```

- Ownership-scoped row read (reuse the `ownedBy` pattern; add a narrow accessor in
  `claude-account-service` rather than importing drizzle in infra — follow the existing
  lazy-import seam style of `UsageEndpointPoller.defaultTokenReader`).
- No usage credential → `null`.
- `usageOauthExpiresAt` more than **5 minutes** in the future → decrypt and return the
  stored access token.
- Otherwise **refresh**, single-flight per accountId (an in-module
  `Map<string, Promise>` — the sweep is a single process; do not over-engineer):
  - `POST` per §2.3 with injectable `FetchLike` (same pattern as
    `anthropic-token-validity.ts`), 10s abort timeout.
  - Success → store new access token (encrypted) + `expiresAt = now + expires_in*1000`
    + rotated refresh token if present; return the access token.
  - HTTP 400/401 (`invalid_grant` etc.) → **quarantine**: null out all four usage
    columns, `log.warn("Usage refresh token rejected; usage tracking disabled until
    re-enabled", { accountId, status })`. UI falls back to the "Enable usage tracking"
    state. Return `null`. (Do NOT touch `authHealthy` — the session credential is a
    separate, still-working credential.)
  - Network error / timeout / 5xx / 429 → transient: log at warn, return `null`,
    change nothing (the sweep's existing failure backoff handles cadence).
- Tokens never appear in any log line (match the discipline in
  `claude-account-service.ts`).

## 7. Poller + sweep integration

- `UsageEndpointPoller`: replace `defaultTokenReader` with one that calls
  `getFreshUsageAccessToken`. **No fallback to the setup-token** — an account without a
  usage credential returns `null` (skip), because a setup-token poll is a guaranteed 403
  plus brute-force-limiter exposure. Update the module docblock (its "reads the
  account's own OAuth token" story changes; also delete the now-wrong "~1 request/hour
  per-token quota" claim — that was the anti-brute-force limiter on invalid creds).
- `usage-poll-sweep.ts`: add a `noCredential` count to the sweep summary log so the
  operator can see skipped accounts.
- `anthropic-usage-adapter.ts`: add a discriminated `{ outcome: "forbidden" }` for 403
  (currently folded into generic non-200 warn). The poller maps it to `null`;
  belt-and-suspenders in case a scope regresses later. Keep the 429 path exactly as
  PR #452 built it.

## 8. UI (`src/components/claude-limits/`)

Minimal, but honest (overlaps bd `remote-dev-5afq` — implement just these, note the
rest stays in 5afq):

- `ClaudeAccountRow`: when `authHealthy && !usageCredential`, the usage cells show
  "Usage tracking off" with an **Enable usage tracking** action (instead of "Unknown").
  When `usageCredential`, keep current bars/Unknown behavior.
- New dialog (or a mode of `AddAccountDialog`) driving the usage flow: open terminal
  session link, Finish button → `usage-capture`, with per-error-code messages
  (`CREDENTIALS_NOT_READY` → keep waiting; `ACCOUNT_MISMATCH`, `MISSING_SCOPE` →
  actionable text). Follow the existing AddAccountDialog capture/polling patterns.
- `AddAccountDialog`: after a successful setup-token capture, offer step 2 — "Enable
  usage tracking now?" (calls the same flow with the fresh accountId). Skippable.
- Client components may use `console.error` (logger is server-only).

## 9. Cross-cutting integration points (check each, they bite)

1. **server-to-server migration** (`project_server_to_server_migration`, PR #413): the
   DB bundle re-encrypts secrets under the destination `AUTH_SECRET`. Find where
   `oauth_token_encrypted` is re-encrypted (migration bundle service) and add the two
   new encrypted columns to that list. If claude_account is excluded from migration,
   note that and skip.
2. **Deploy backfill** (`src/db/backfill-claude-accounts.ts`): touches only token-less
   account creation — verify no interaction; new columns default NULL.
3. **openapi.yaml + docs/API.md**: two new endpoints + updated account view.
4. **docs/AGENTS.md**: extend the Claude usage-limit section with the dual-credential
   model and the user:profile finding.
5. **CHANGELOG.md** `[Unreleased]`: Added (usage tracking via per-account OAuth
   credentials + Enable-usage-tracking flow), Changed (poller skips accounts without
   usage credentials), Fixed (usage bars can now actually populate).
6. **`docs/SETUP.md`**: `RDV_CLAUDE_USAGE_POLL_ENABLED` docs mention the credential
   requirement.

## 10. Implementation order

1. **Spike (30 min, on this machine, no browser needed):** create a scratch
   `CLAUDE_CONFIG_DIR`, seed `.claude.json`, run `claude` non-interactively enough to
   confirm (a) which login command/arg form to send (`claude /login` vs `claude login`
   vs interactive `/login`), (b) whether the onboarding seed works, (c) exact
   credentials-file path on the Linux side per CLI docs/source. Record findings as code
   comments. **Do NOT complete a real login and do NOT touch the user's real Keychain
   items beyond read-only metadata.**
2. Schema + codegen + view changes + tests.
3. Harvester + refresh service + tests (fetch/exec fully injected).
4. Routes + service + cleanup + tests (model on the existing
   `capture`/`setup-session` routes and their `route.test.ts`).
5. Poller/sweep/adapter changes + tests.
6. UI.
7. Docs + changelog.
8. Gates: `bun run typecheck && bun run lint && bun run test:run && bun run build`.

## 11. Non-goals

- Changing the session credential class (setup-tokens stay).
- api_key accounts (no usage endpoint exists for them).
- Auto-migrating existing accounts (they get the Enable button, nothing automatic).
- The broader 5afq UI overhaul (on-demand poll button etc.) — file-splitting note in bd.
- Building our own PKCE authorize flow — `claude /login` under a scratch config dir IS
  the OAuth flow, with Anthropic's own client doing the dance (cswap-equivalent).

## 12. Acceptance

- Unit: harvester derivation (pin the §2.2 vector), credential parse, refresh
  single-flight/rotation/quarantine, both routes (ownership, marker, scope gate,
  mismatch, cleanup), poller skip, adapter 403. All existing tests green.
- Supervised E2E (with the user, after ship): Enable usage tracking on one account →
  bars show real percentages within one sweep; kill the access token expiry (set
  `usage_oauth_expires_at` to the past in the DB) → next sweep refreshes and still
  populates; sessions unaffected throughout.
