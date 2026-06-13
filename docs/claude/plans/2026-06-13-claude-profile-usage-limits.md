# Claude Profile Management (cswap-style) — Usage Limits, Pools, Auto-Rotation

**Epic:** `remote-dev-3b3l` · **Branch:** `feat/claude-usage-limits-pool` · **Date:** 2026-06-13
**Architecture choice:** Full clean architecture · **Phase-1 scope:** includes pool rotation

## What we're building

Bring cswap (`realiti4/claude-swap`) capabilities *into* remote-dev. cswap stores
credentials for multiple Claude accounts, hot-swaps which one Claude Code sees as
logged-in, shows each account's 5h/7d usage + reset times, and rotates to the next
account when one taps out.

remote-dev profiles already provide the substrate: each profile sets its own
`CLAUDE_CONFIG_DIR=~/.remote-dev/profiles/{id}/.claude`, so **one profile ≈ one Claude
account**. What's missing — and what this epic adds:

1. **Usage-limit state** per profile (greenfield).
2. **Hybrid detection**: reactive (hook/scrollback parse of "usage limit reached / resets at …")
   + proactive (poll an unofficial Anthropic usage endpoint, behind an adapter + flag).
3. **Apply the correct profile to the correct project**: close the gap where the
   project→profile link exists but is never auto-applied at session creation; add a
   group-inherited **primary + fallback pool** with **auto-rotation** to an available profile.
4. **Both launch paths** (interactive now; automation in P2). On a running session hitting
   a limit: **default notify + 1-click relaunch**; per-project (overriding global) toggle to
   **auto-relaunch** (spawn a parallel session under an available profile — NEVER force-kill).

### Locked decisions (from product)
- **Account model = BOTH** subscription-OAuth and API-key profiles, side by side.
- **Detection = hybrid** (reactive + proactive poller; poller behind a flag, unofficial endpoint isolated behind ONE adapter).
- **Assignment = primary + fallback pool, group-inherited** (reuse `project_profile_link` + `node_preferences` inheritance).
- **Scope = both paths**; running-session default notify+1-click, configurable to auto.

## Clean-architecture layering

```
domain/value-objects/        pure, immutable, no I/O, unit-tested
  AccountKind, UsageWindow, LimitState, RotationPolicy
application/ports/           interfaces only
  UsageLimitGateway, UsageLimitStateRepository, ProfilePoolRepository, ProfileSelectionPolicy
application/use-cases/profile/   orchestration, depend only on ports + VOs, tested with fakes
  TrackUsageLimitUseCase, SelectProfileUseCase, RelaunchOnLimitUseCase
infrastructure/usage-limit/  adapters + Drizzle repos, wired in container.ts
  DrizzleUsageLimitStateRepository, DrizzleProfilePoolRepository,
  ReactiveOutputDetector, UsageEndpointPoller, CompositeUsageLimitGateway,
  PriorityProfileSelectionPolicy
infrastructure/external/     anthropic-usage-adapter (the one volatile seam)
interface/ (API routes + React)   thin callers of the use-cases via container
```

Precedent for VOs: `src/domain/value-objects/ProfileIsolation.ts` (private ctor, static
`create()`, `InvalidValueError`, `equals()`). DI root: `src/infrastructure/container.ts`.

**Judgment calls (keep clean but not ceremonial):** `RotationPolicy` ships with a single
priority-order strategy and NO user-facing strategy enum (add only on demand). The
`CompositeUsageLimitGateway` dispatches by `AccountKind` and is the only gateway wired into
the container. Reads of single-row tables may be direct Drizzle inside a repo impl; only the
write path needs the consistency guard.

---

## A. Data model (P1.1 — `remote-dev-gpam`)

All edits in `src/db/schema.def.ts` (single source of truth). After editing run:
`bun run db:codegen` → `bun run db:generate` → `bun run db:generate:pg`. Then
`bun run test:run` (codegen-in-sync test) + `bun run db:check-drift`. **Additive / nullable
or defaulted columns only** (db:push silently skips data-loss changes — see memory).

### Type brands (new `src/types/claude-limits.ts`)
```ts
export type ClaudeAccountKind = "subscription" | "api_key";
export type ClaudeLimitStatus  = "available" | "limited" | "unknown";
export type UsageDetectionSource = "reactive" | "poller" | "manual";
export type ClaudeAutoRelaunchMode = "notify" | "auto" | "disabled";
```

### New table `claude_account` (1:1 with agent_profile) — Claude-specific identity + kind
Keeps Claude specifics off the provider-agnostic `agent_profile`.
```
exportName: claudeAccounts, sqlName: claude_account
  id              text PK uuid
  profileId       text notNull UNIQUE  -> agentProfiles.id cascade
  userId          text notNull         -> users.id cascade
  accountKind     text notNull typeBrand "ClaudeAccountKind" default "subscription"
  credentialMode  text  -- "file" | "keychain"; null = unknown (P2 fills it)
  emailAddress    text  -- display, from ~/.claude.json oauthAccount.emailAddress
  organizationName text -- display
  rateLimitTier   text  -- userRateLimitTier (display)
  apiKeyPrefix    text  -- first 8 chars only (full key stays in profile_secrets_config)
  createdAt, updatedAt timestampMs notNull default now
  index: [profileId], [userId]
```

### New table `claude_usage_limit_state` (per profile) — authoritative limit store
```
exportName: claudeUsageLimitStates, sqlName: claude_usage_limit_state
  profileId       text PK -> agentProfiles.id cascade
  userId          text notNull -> users.id cascade
  limitStatus     text notNull typeBrand "ClaudeLimitStatus" default "unknown"
  window5hPct     integer        -- 0-100, null if unknown
  window7dPct     integer
  resetAt5h       timestampMs    -- when the 5h window resets
  resetAt7d       timestampMs
  effectiveResetAt timestampMs   -- min(resetAt5h, resetAt7d): soonest available again
  detectionSource text typeBrand "UsageDetectionSource"
  lastCheckedAt   timestampMs
  lastPolledAt    timestampMs
  updatedAt       timestampMs notNull default now
  index: [userId, limitStatus], [userId]
```

### New tables `claude_profile_pool` + `claude_profile_pool_member`
```
claudeProfilePools / claude_profile_pool
  id text PK uuid; userId text notNull -> users.id cascade; name text notNull
  createdAt, updatedAt timestampMs notNull default now
  index [userId]
claudeProfilePoolMembers / claude_profile_pool_member
  id text PK uuid
  poolId    text notNull -> claudeProfilePools.id cascade
  profileId text notNull -> agentProfiles.id cascade
  priority  integer notNull default 0  -- lower = higher priority / earlier in rotation
  createdAt timestampMs notNull default now
  unique [poolId, profileId]; index [poolId, priority], [profileId]
```

### Column additions to existing tables
- `projectProfileLinks`: + `poolId text` -> claudeProfilePools.id `set null` (primary `profileId` stays; pool is the fallback).
- `nodePreferences`: + `claudeProfilePoolId text`, + `claudeAutoRelaunchMode text typeBrand "ClaudeAutoRelaunchMode"`. (Inherits via existing `buildAncestryChain`/`resolvePreferences` — no resolver changes; they read the whole row.)
- `userSettings`: + `claudeAutoRelaunchMode text typeBrand "ClaudeAutoRelaunchMode" default "notify"`.
- `agentSchedules`, `triggerConfigs`, `agentRuns`: + `profileId text` -> agentProfiles.id `set null`. **Schema only in P1** (cheap, avoids a 2nd migration); WIRING is P2 (`remote-dev-vk1z`).

---

## B. Domain value objects (P1.2 — `remote-dev-6ncg`)

`src/domain/value-objects/` — pure, immutable, private ctor + static factory, `equals()`,
co-located `*.test.ts`. No DB/fs/network imports.

- **AccountKind.ts** — `"subscription" | "api_key"`; `windowSemantics()` → `"rolling_5h_7d" | "rate_credits"`.
- **UsageWindow.ts** — `create(duration: "5h"|"7d"|"org", utilizationPct 0-100, resetAt: Date|null)`; `isExhausted()`, `msUntilReset(now)`.
- **LimitState.ts** — `{ profileId, isLimited, windows: UsageWindow[], source, limitedSince, lastCheckedAt }`; `static available(...)`, `static limited(...)`; `earliestResetAt(now): Date|null`; `isAvailableNow(now): boolean` (a limited profile is available again only once `earliestResetAt <= now`).
- **RotationPolicy.ts** — `select(candidates: {profileId, priority, limitState}[], now): string|null` → first `isAvailableNow` by ascending priority; null if all limited. Single strategy; no public enum.

Tests: boundary (pct 0/100, reset exactly now), all-limited, earliest-of-two-windows, immutability.

---

## C. Application ports + use-cases (P1.3 — `remote-dev-i1za`)

### Ports (`src/application/ports/`)
```ts
// UsageLimitGateway.ts
export interface LimitDetectionResult {
  profileId: string; isLimited: boolean;
  resetAt5h: Date|null; resetAt7d: Date|null;
  window5hPct: number|null; window7dPct: number|null;
  source: UsageDetectionSource;
}
export interface UsageLimitGateway {
  supports(kind: ClaudeAccountKind): boolean;
  fetchLimitState(profileId: string, userId: string): Promise<LimitDetectionResult|null>;
}

// UsageLimitStateRepository.ts
export interface UsageLimitStateRepository {
  findByProfileId(profileId: string): Promise<LimitState|null>;
  findManyByProfileIds(ids: string[]): Promise<Map<string, LimitState>>;
  upsert(state: LimitState, opts?: { onlyIfNewer?: Date }): Promise<void>;
  listForUser(userId: string): Promise<LimitState[]>;
}

// ProfilePoolRepository.ts
export interface PoolEntry { profileId: string; priority: number; }
export interface ProfilePoolRepository {
  membersOfPool(poolId: string): Promise<PoolEntry[]>;
  poolsForUser(userId: string): Promise<{ id: string; name: string }[]>;
  createPool(userId: string, name: string): Promise<string>;
  renamePool(poolId: string, name: string): Promise<void>;
  deletePool(poolId: string): Promise<void>;
  addMember(poolId: string, profileId: string, priority: number): Promise<void>;
  removeMember(poolId: string, profileId: string): Promise<void>;
  setPriority(poolId: string, profileId: string, priority: number): Promise<void>;
}

// ProfileSelectionPolicy.ts
export interface ProfileSelectionPolicy {
  selectForProject(projectId: string, userId: string, now: Date): Promise<string|null>;       // primary→pool; null = none configured
  selectNextAvailable(currentProfileId: string, projectId: string, userId: string, now: Date): Promise<string|null>;
}
export class ProfileAllLimitedError extends Error { constructor(readonly projectId: string, readonly earliestResetAt: Date|null){ super("All pool profiles limited"); } }
```

### Use-cases (`src/application/use-cases/profile/`) — tested with in-memory fakes
- **TrackUsageLimitUseCase** — input `{ profileId, userId, source, isLimited?, resetAt5h?, resetAt7d?, window5hPct?, window7dPct? }`; builds a `LimitState`, upserts (write-guard: stale source must not clobber a fresher one), returns the new state.
- **SelectProfileUseCase** — `{ projectId, userId, explicitProfileId? }` → `{ profileId, wasAutoSelected }`. Explicit wins. Else `policy.selectForProject`. If a pool is configured but all limited → bubble `ProfileAllLimitedError`. If nothing configured → return `null` profile (caller proceeds with no profile = today's behavior).
- **RelaunchOnLimitUseCase** — `{ sessionId, userId, projectId, currentProfileId }` → resolve mode (project override → global default), select next available, then:
  - `disabled` → log + return; `notify` → create notification with a `relaunch` CTA (meta carries `{ projectId, profileId, agentProvider }` for `POST /api/sessions`); `auto` → create a NEW session under the alternate profile via a `SessionLauncherPort`, leave the old session running.
  - Ports `NotificationPort` + `SessionLauncherPort` keep this unit-testable.

---

## D. Infrastructure (P1.4 — `remote-dev-tc53`)

`src/infrastructure/usage-limit/`:
- **DrizzleUsageLimitStateRepository** — maps `claude_usage_limit_state` ↔ `LimitState`. `upsert.onlyIfNewer` compares `lastCheckedAt`.
- **DrizzleProfilePoolRepository** — `claude_profile_pool(_member)`.
- **PriorityProfileSelectionPolicy** — `selectForProject`: read `project_profile_link` (primary `profileId` + `poolId`); also resolve `nodePreferences.claudeProfilePoolId` via the existing preference chain (project→group). Load limit states, run `RotationPolicy.select`. `selectNextAvailable`: exclude `currentProfileId`. Tested with fake repos.
- **ReactiveOutputDetector** implements `UsageLimitGateway` (`supports("subscription")`). `static parse(output): { isLimited; resetAt: Date|null }` — pure, tested against real Claude limit strings ("Claude usage limit reached", "resets at …", `anthropic-ratelimit-unified-5h-reset` if present). Liberal substring match; reset optional.
- **UsageEndpointPoller** implements `UsageLimitGateway`. Gated by `process.env.RDV_CLAUDE_USAGE_POLL_ENABLED === "1"` (DEFAULT OFF). Delegates the HTTP call to `infrastructure/external/anthropic-usage-adapter.ts::fetchClaudeUsage(token)` → snapshot|null. Reads the profile's OAuth token from its `.claude/.credentials.json` (or `profile_secrets_config` for api_key). Best-effort: any failure → return null, never throw.
- **CompositeUsageLimitGateway** — holds the adapters; dispatches by the profile's `AccountKind`.
- **container.ts** — export singletons: repos, gateway, `profileSelectionPolicy`, the three use-cases. Follow existing container grouping.

`src/infrastructure/external/anthropic-usage-adapter.ts` — the ONE volatile seam. Stub-safe:
returns null until the real endpoint is implemented in P2 (`remote-dev-6bos`).

---

## E. Integration (P1.5 — `remote-dev-goo9`)

- **`src/services/session-service.ts` `createSessionWithDedupFlag`** — after preference resolution, before plugin dispatch: when `!input.profileId && mergedAgentProvider === "claude" && input.projectId`, call `SelectProfileUseCase`; set `input.profileId` from the result (catch `NoProfileConfigured` → proceed w/o profile; log `ProfileAllLimited`). This is the only behavior change to the create path — it populates the already-plumbed field. Also inject `RDV_PROFILE_ID` into `rdvEnv` when a profile is active.
- **`src/server/terminal.ts`** —
  - New internal handler `POST /internal/usage-limit` (localhost-guarded like `/internal/agent-status`): body `{ sessionId, resetAt5h?, resetAt7d?, window5hPct?, window7dPct? }`; resolve `profileId`+`userId`+`projectId` from the session row; call `TrackUsageLimitUseCase`; broadcast WS `profile_limit_changed`; fire-and-forget `RelaunchOnLimitUseCase`.
  - Register the poller sweep is done in `index.ts` (below), not here.
- **`src/services/agent-profile-service.ts` `installAgentHooks`** — add a `Stop` (or dedicated) hook entry running `rdv hook detect-limit` with a **curl fallback first** (Rust binary lags on instances): the fallback `tmux capture-pane`s recent lines, greps the limit phrase, and POSTs `/internal/usage-limit`. Preserve the existing RDV-hook dedupe markers.
- **`crates/rdv/src/commands/hook.rs`** — add `HookCommand::DetectLimit`: capture last ~80 scrollback lines, regex the limit phrase + reset time, POST `/internal/usage-limit` with `RDV_SESSION_ID`. Exit 0 always (must not block Claude).
- **`src/server/index.ts`** — register `claudeUsagePoller` sweep (e.g. `setInterval` 10m) alongside the existing orchestrators; the poller no-ops unless `RDV_CLAUDE_USAGE_POLL_ENABLED=1`.

---

## F. API routes (P1.6 — `remote-dev-wb0q`)

Under `src/app/api/` (use `withAuth`/`withApiAuth`; verify ownership):
- `GET /api/profiles` — include `limitState` + `accountKind` (left-join).
- `GET|PATCH /api/profiles/[id]/limit-state` — read; PATCH `{ status: "available" }` = manual override.
- `GET|POST /api/claude-pools`, `GET|PUT|DELETE /api/claude-pools/[poolId]`, `GET|POST|DELETE /api/claude-pools/[poolId]/members`, `GET /api/claude-pools/[poolId]/status`.
- `GET /api/profiles/select?projectId=` — returns the recommended profileId for a project (calls `SelectProfileUseCase`), for wizard pre-fill.
- `GET /api/claude/usage` — dashboard payload: all Claude profiles + states + reset countdowns + pool membership.

---

## G. UI (P1.7 — `remote-dev-0yix`)

- **`src/contexts/ProfileContext.tsx`** — add `limitStates: Map<profileId, LimitState>`, `pools`, pool CRUD, `getRecommendedProfile(projectId)`; subscribe to WS `profile_limit_changed`.
- **Claude Accounts dashboard** (`src/components/claude-limits/ClaudeAccountsDashboard.tsx`) — cswap-style table: profile, kind, 5h%, 7d%, reset countdown, status badge, pool; "mark available" action. Reachable from Settings (new tab).
- **PoolAssignmentPanel** — in project/group preferences: primary profile + fallback pool picker + auto-relaunch radio (`notify|auto|disabled`, inherits global default).
- **NewSessionWizard** — pre-fill `selectedProfileId` from `/api/profiles/select`; show a "Limited — resets in Xh" badge in `ProfileSelector` for limited profiles.

---

## Build waves (each: implement → quality gates → commit to branch; reviewed between waves)
- **Wave A** = P1.1 + P1.2 (schema + domain). Gates: `db:codegen`, both `db:generate`, `test:run` (codegen-in-sync + VO tests), `typecheck`.
- **Wave B** = P1.3 + P1.4 (ports/use-cases + infra/container). Gates: `test:run`, `typecheck`, `lint`.
- **Wave C** = P1.5 + P1.6 (integration + API). Gates: `typecheck`, `lint`, `test:run`; `cargo build`/`cargo test` for the rdv crate.
- **Wave D** = P1.7 (UI). Gates: `lint`, `typecheck`, `bun run build` smoke.

## Conventions & gotchas (NON-NEGOTIABLE)
- Server logging via `createLogger` — never `console.*` (client React may use `console.error`).
- Schema: edit `schema.def.ts` only; run codegen + BOTH migration sets; keep `db:check-drift` green; additive/nullable columns only.
- Env precedence in session-service is fixed: `claudeDefaults < pluginEnv < profileEnv < proxyEnv < modelProxyEnv < folderEnv < … < rdvEnv`. `RDV_PROFILE_ID` rides `rdvEnv`.
- rdv hooks: **curl fallback first**, rdv CLI preferred (binary lags on instances).
- Poller: `RDV_CLAUDE_USAGE_POLL_ENABLED` default OFF; the unofficial endpoint lives ONLY in `anthropic-usage-adapter.ts`.
- Running-session limit: **never force-kill**; auto-relaunch spawns a parallel session.
- All work on branch `feat/claude-usage-limits-pool` in the worktree; never edit the main checkout.

## Phase 2 (tracked, not in this slice)
`remote-dev-6bos` real usage endpoint · `remote-dev-6nu9` macOS per-profile OAuth login (file creds) + refresh · `remote-dev-vk1z` automation profileId wiring · `remote-dev-1kt5` auto-relaunch UI + api_key limit semantics.

### macOS keychain note (P2)
macOS stores the primary Claude OAuth token in the Keychain (singular), so per-profile OAuth
needs file-based `.credentials.json`. Flow: run `claude` (login) inside the profile's
`CLAUDE_CONFIG_DIR`; it writes file creds there; capture email/tier. Linux instances are
already file-based. P1 does not depend on this — profiles created/logged-in already isolate.
