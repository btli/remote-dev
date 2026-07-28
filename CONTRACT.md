# Acceptance contract — Claude multi-account (remote-dev-n4x4.6 / .7 / .8)

Working dir: this worktree only. Branch `feat/claude-accounts-decouple`.
Never edit the main checkout at `/Users/bryanli/Projects/btli/remote-dev`.

## Goal

A user with several Claude subscriptions can add each one as a first-class
**account**, see them all in Settings, and have sessions run under a chosen
account — while every session keeps the **same shared config/context**
(skills, `CLAUDE.md`, MCP servers, settings, agents).

The shared config is the user's real `~/.claude`. Accounts are credentials
layered on top; they are NOT isolated config directories.

## Verified facts — build on these, do not re-derive

All verified live on macOS against Claude Code 2.1.220 on 2026-07-28.

1. **`CLAUDE_CODE_OAUTH_TOKEN` selects the account per-process**, independent of
   `CLAUDE_CONFIG_DIR`. Fresh empty config dir + env token gives
   `{"loggedIn": true, "authMethod": "oauth_token"}`; without it,
   `{"loggedIn": false, "authMethod": "none"}`. This is the mechanism that makes
   one shared config dir + N accounts work, with true parallelism and no
   credential swapping, locking, or restarts.

2. **`claude auth status --json` is the identity source.** Run under an
   account's env it returns exactly the display fields we persist:
   ```json
   {"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty",
    "email": "...", "orgId": "...", "orgName": "...", "subscriptionType": "max"}
   ```
   `authMethod` observed: `none` | `claude.ai` | `oauth_token`. Treat as an open
   set. Never parse credential files for identity.

3. **The Keychain service name is derived from the `CLAUDE_CONFIG_DIR`
   setting.** Unset gives service `Claude Code-credentials`; an explicit path —
   *even `$HOME/.claude` itself* — gives `Claude Code-credentials-<hash>`, a
   different and possibly empty credential namespace. Consequence: setting
   `CLAUDE_CONFIG_DIR=$HOME/.claude` is NOT a no-op. Because we always inject a
   token, the Keychain namespace must never be load-bearing. Do not depend on it.

4. **Root cause of the "Sync does nothing" bug (n4x4.8).**
   `syncAccountFromCredentials()` in `src/services/claude-login-service.ts` reads
   `<profileConfigDir>/.claude/.credentials.json`. That file does not exist —
   `find ~/.remote-dev/profiles -name .credentials.json` returns nothing —
   because credentials went to the Keychain. So `readProfileCredentials()`
   returns null, sync returns `loggedIn: false`, `onSynced` never fires, and the
   button is silently dead. Profile `a04f4587` meanwhile reports
   `{"loggedIn": true, "email": "bryan@joyful.house", "subscriptionType": "max"}`
   under its own `CLAUDE_CONFIG_DIR` — i.e. it IS logged in. The whole
   file-reading path is wrong, not merely buggy.

5. `prepareFileBasedLogin()`'s premise — that seeding an empty
   `.credentials.json` forces file-based creds on macOS — is **stale**.
   `CLAUDE_CONFIG_DIR` namespaces the Keychain natively now. Delete the hack;
   do not port it forward. It also degrades security by putting refresh tokens
   in plaintext on disk.

## Scope — IN

### n4x4.6 — decouple account from profile
- `claude_account.profileId` is currently `unique NOT NULL`. It must stop being
  the identity. Accounts become standalone rows: alias, email, orgId, orgName,
  tier/`subscriptionType`, `accountKind`, plus an **encrypted** OAuth token.
- Encrypt the token at rest using the project's existing encryption helper (the
  same one `profile_secrets_config` uses). Never log it, never return it over
  the API, never persist it in plaintext.
- Session launch injects `CLAUDE_CODE_OAUTH_TOKEN` for the selected account.
- Claude usage-limit state and fallback pools key on **account**, not profile.
  Migrate `claude_profile_pool_member` and `claude_usage_limit_state` accordingly.
- Schema is CODEGEN'd: edit `src/db/schema.def.ts` ONLY, then `bun run db:codegen`,
  then `bun run db:push` and `bun run db:generate:pg`. Never hand-edit
  `schema.sqlite.ts` / `schema.pg.ts` / `schema.ts` — a `codegen-in-sync` test
  enforces this.
- Preserve existing data: profiles that currently hold a Claude login must
  migrate to standalone accounts rather than being dropped.

### n4x4.7 — onboarding
- A single **"Add account"** action in Settings → Claude Accounts.
- It launches a real profile-bound terminal session running `claude setup-token`,
  the user completes OAuth in the browser, and remote-dev captures the resulting
  long-lived token, stores it encrypted, and reads identity via
  `claude auth status --json`. No manual "Sync" step anywhere in the flow.
- Provide a **paste-a-token fallback** for remote/PWA onboarding where no local
  browser is available.
- Accounts are listed with alias, email, org, tier, auth health, and usage.
  Re-adding a known email updates in place rather than duplicating.

### n4x4.8 — kill the file-reading login path
- Replace credential-file parsing with `claude auth status --json` executed
  under the account's env.
- Delete `prepareFileBasedLogin()` and the `.credentials.json` seeding.
- `credentialMode` must reflect reality instead of being hardcoded `"file"`, or
  be removed if it no longer carries meaning.

## Scope — OUT (do not touch)

- `src/infrastructure/external/anthropic-usage-adapter.ts` — **another agent is
  rewriting this file right now** (remote-dev-n4x4.1, switching it to
  `GET /api/oauth/usage`). Do not edit it. If you need the poller's credential
  loading changed, leave a clearly-marked TODO referencing n4x4.1 and keep your
  diff off that file.
- Model-aware selection policy (n4x4.3), flipping the poll flag default (n4x4.4),
  `ReactiveOutputDetector` changes (n4x4.5).
- The `GEMINI_HOME` / `OPENCODE_HOME` / `ANTIGRAVITY_HOME` no-op bug (remote-dev-s4uy).

## Constraints

- Clean architecture layering: `domain/` → `application/` → `infrastructure/` →
  `interface/`. Entities immutable; persistence behind repository ports.
- Server-side logging via `createLogger` only. **Never** `console.*` in server
  code. Client components may use `console.error`.
- **Never** disable a linter rule, add `@ts-ignore`, `eslint-disable`, `# noqa`,
  or similar. Fix the root cause.
- `bun` only — never `npm`/`yarn`/`pnpm`.
- Tokens and secrets never appear in logs, API responses, or test fixtures.
- Tests must not make live network calls or invoke the real `claude` binary —
  inject the seam.

## Gates — all must be green

```bash
bun run lint
bun run typecheck
bun run test:run
```

Plus: new unit tests covering account CRUD, token encrypt/decrypt round-trip,
identity parsing from `claude auth status --json` (including `loggedIn: false`
and malformed output), env injection at session launch, and the data migration.

A pre-existing failure unrelated to this change must be called out explicitly,
not silently left or silently fixed.

## Definition of done

Gates green, tests added, PR opened against `master`, and a written summary of
what changed plus anything in this contract that turned out to be wrong.
